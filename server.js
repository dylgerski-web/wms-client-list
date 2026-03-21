require("dotenv").config();
const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const { randomUUID } = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.use(express.json());
app.use(express.static(__dirname));

const statusOptions = new Set(["Not Started", "In Progress", "Blocked", "On Hold", "Completed"]);

function buildDbConfig() {
  const uri = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (uri) {
    try {
      const url = new URL(uri);
      return {
        host: url.hostname,
        port: url.port || 3306,
        user: url.username,
        password: url.password,
        database: url.pathname.substring(1),
      };
    } catch (error) {
      console.error("Failed to parse MySQL URL:", error.message);
    }
  }

  const host = process.env.MYSQLHOST || process.env.MYSQL_HOST || process.env.DB_HOST;
  const port = Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || process.env.DB_PORT || 3306);
  const user = process.env.MYSQLUSER || process.env.MYSQL_USER || process.env.DB_USER;
  const password = process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "";
  const database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.DB_NAME;

  if (host && user && database) {
    return { host, port, user, password, database };
  }

  throw new Error(
    "Missing MySQL configuration. Set MYSQL_URL (or MYSQL_PUBLIC_URL / DATABASE_URL) or set MYSQLHOST, MYSQLUSER, MYSQLPASSWORD, and MYSQLDATABASE."
  );
}

const pool = mysql.createPool({
  ...buildDbConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        contact VARCHAR(255) NOT NULL,
        integration_type VARCHAR(255) NOT NULL,
        priority VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS client_parts (
        id VARCHAR(36) PRIMARY KEY,
        client_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL,
        notes LONGTEXT,
        position INT NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        CONSTRAINT fk_parts_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS client_steps (
        id VARCHAR(36) PRIMARY KEY,
        client_id VARCHAR(36) NOT NULL,
        title VARCHAR(255) NOT NULL,
        done TINYINT(1) NOT NULL DEFAULT 0,
        position INT NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        CONSTRAINT fk_steps_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Add notes column to client_parts if it doesn't exist
    try {
      await conn.query(`
        ALTER TABLE client_parts ADD COLUMN notes LONGTEXT
      `);
    } catch (error) {
      // Column might already exist, that's fine
      if (!error.message.includes('Duplicate column')) {
        throw error;
      }
    }
  } finally {
    conn.release();
  }
}

function toIso(dt) {
  return new Date(dt).toISOString();
}

function mapClients(rows, partRows, stepRows) {
  const partMap = new Map();
  const stepMap = new Map();

  for (const row of partRows) {
    if (!partMap.has(row.client_id)) {
      partMap.set(row.client_id, []);
    }
    partMap.get(row.client_id).push({
      id: row.id,
      name: row.name,
      status: row.status,
      notes: row.notes || "",
      position: row.position,
    });
  }

  for (const row of stepRows) {
    if (!stepMap.has(row.client_id)) {
      stepMap.set(row.client_id, []);
    }
    stepMap.get(row.client_id).push({
      id: row.id,
      title: row.title,
      done: Boolean(row.done),
    });
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    integrationType: row.integration_type,
    priority: row.priority,
    status: row.status,
    parts: partMap.get(row.id) || [],
    steps: stepMap.get(row.id) || [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

function validStatus(value) {
  return statusOptions.has(value);
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/clients", async (req, res) => {
  const [clients] = await pool.query("SELECT * FROM clients ORDER BY created_at DESC");
  const [parts] = await pool.query("SELECT * FROM client_parts ORDER BY position ASC, created_at ASC");
  const [steps] = await pool.query("SELECT * FROM client_steps ORDER BY position ASC, created_at ASC");
  res.json(mapClients(clients, parts, steps));
});

app.post("/api/clients", async (req, res) => {
  const { name, contact, integrationType, priority, status, parts, steps } = req.body || {};
  if (!name || !contact || !integrationType || !priority) {
    return res.status(400).json({ error: "Missing required client fields." });
  }
  if (!Array.isArray(parts) || !parts.length || !Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ error: "Client requires at least one part and one step." });
  }

  const clientStatus = validStatus(status) ? status : "Not Started";
  const now = new Date();
  const clientId = randomUUID();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO clients (id, name, contact, integration_type, priority, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, name, contact, integrationType, priority, clientStatus, now, now]
    );

    for (let i = 0; i < parts.length; i += 1) {
      const partName = String(parts[i]).trim();
      if (!partName) {
        continue;
      }
      await conn.query(
        `INSERT INTO client_parts (id, client_id, name, status, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), clientId, partName, "Not Started", i, now, now]
      );
    }

    for (let i = 0; i < steps.length; i += 1) {
      const stepTitle = String(steps[i]).trim();
      if (!stepTitle) {
        continue;
      }
      await conn.query(
        `INSERT INTO client_steps (id, client_id, title, done, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), clientId, stepTitle, 0, i, now, now]
      );
    }

    await conn.commit();
    res.status(201).json({ id: clientId });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

app.patch("/api/clients/:clientId/status", async (req, res) => {
  const { status } = req.body || {};
  if (!validStatus(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const now = new Date();
  await pool.query("UPDATE clients SET status = ?, updated_at = ? WHERE id = ?", [status, now, req.params.clientId]);
  res.json({ ok: true });
});

app.patch("/api/clients/:clientId/parts/:partId", async (req, res) => {
  const { status } = req.body || {};
  if (!validStatus(status)) {
    return res.status(400).json({ error: "Invalid part status." });
  }

  const now = new Date();
  await pool.query("UPDATE client_parts SET status = ?, updated_at = ? WHERE id = ? AND client_id = ?", [
    status,
    now,
    req.params.partId,
    req.params.clientId,
  ]);
  await pool.query("UPDATE clients SET updated_at = ? WHERE id = ?", [now, req.params.clientId]);
  res.json({ ok: true });
});

app.patch("/api/clients/:clientId/parts/:partId/notes", async (req, res) => {
  const { notes } = req.body || {};
  const now = new Date();
  await pool.query("UPDATE client_parts SET notes = ?, updated_at = ? WHERE id = ? AND client_id = ?", [
    notes || "",
    now,
    req.params.partId,
    req.params.clientId,
  ]);
  await pool.query("UPDATE clients SET updated_at = ? WHERE id = ?", [now, req.params.clientId]);
  res.json({ ok: true });
});

app.patch("/api/clients/:clientId/parts/:partId/position", async (req, res) => {
  const { position } = req.body || {};
  if (position === null || position === undefined) {
    return res.status(400).json({ error: "Position is required." });
  }

  const now = new Date();
  await pool.query("UPDATE client_parts SET position = ?, updated_at = ? WHERE id = ? AND client_id = ?", [
    position,
    now,
    req.params.partId,
    req.params.clientId,
  ]);
  await pool.query("UPDATE clients SET updated_at = ? WHERE id = ?", [now, req.params.clientId]);
  res.json({ ok: true });
});

app.patch("/api/clients/:clientId/steps/:stepId", async (req, res) => {
  const done = req.body?.done ? 1 : 0;
  const now = new Date();
  await pool.query("UPDATE client_steps SET done = ?, updated_at = ? WHERE id = ? AND client_id = ?", [
    done,
    now,
    req.params.stepId,
    req.params.clientId,
  ]);
  await pool.query("UPDATE clients SET updated_at = ? WHERE id = ?", [now, req.params.clientId]);
  res.json({ ok: true });
});

app.post("/api/clients/:clientId/parts", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Part name is required." });
  }

  const now = new Date();
  const [rows] = await pool.query("SELECT COALESCE(MAX(position), -1) AS max_pos FROM client_parts WHERE client_id = ?", [
    req.params.clientId,
  ]);
  const nextPos = Number(rows[0]?.max_pos || -1) + 1;

  await pool.query(
    "INSERT INTO client_parts (id, client_id, name, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), req.params.clientId, name, "Not Started", nextPos, now, now]
  );
  await pool.query("UPDATE clients SET updated_at = ? WHERE id = ?", [now, req.params.clientId]);
  res.status(201).json({ ok: true });
});

app.post("/api/clients/:clientId/steps", async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) {
    return res.status(400).json({ error: "Step title is required." });
  }

  const now = new Date();
  const [rows] = await pool.query("SELECT COALESCE(MAX(position), -1) AS max_pos FROM client_steps WHERE client_id = ?", [
    req.params.clientId,
  ]);
  const nextPos = Number(rows[0]?.max_pos || -1) + 1;

  await pool.query(
    "INSERT INTO client_steps (id, client_id, title, done, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), req.params.clientId, title, 0, nextPos, now, now]
  );
  await pool.query("UPDATE clients SET updated_at = ? WHERE id = ?", [now, req.params.clientId]);
  res.status(201).json({ ok: true });
});

app.post("/api/demo", async (req, res) => {
  const now = new Date();
  const demo = [
    {
      name: "Nova Freight",
      contact: "Ivy Torres",
      integrationType: "WMS + EDI",
      priority: "High",
      status: "In Progress",
      parts: [
        { name: "Contract", status: "Completed" },
        { name: "API Credentials", status: "In Progress" },
        { name: "Data Mapping", status: "Not Started" },
      ],
      steps: [
        { title: "Kickoff", done: true },
        { title: "Access Provisioning", done: true },
        { title: "Endpoint Testing", done: false },
        { title: "Go-Live", done: false },
      ],
    },
    {
      name: "Titan Retail",
      contact: "Lena Park",
      integrationType: "WMS + API",
      priority: "Critical",
      status: "Blocked",
      parts: [
        { name: "Security Review", status: "Blocked" },
        { name: "Sandbox", status: "Completed" },
      ],
      steps: [
        { title: "Requirements", done: true },
        { title: "Credential Exchange", done: false },
        { title: "Validation", done: false },
      ],
    },
  ];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const item of demo) {
      const clientId = randomUUID();
      await conn.query(
        `INSERT INTO clients (id, name, contact, integration_type, priority, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [clientId, item.name, item.contact, item.integrationType, item.priority, item.status, now, now]
      );

      for (let i = 0; i < item.parts.length; i += 1) {
        await conn.query(
          `INSERT INTO client_parts (id, client_id, name, status, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), clientId, item.parts[i].name, item.parts[i].status, i, now, now]
        );
      }

      for (let i = 0; i < item.steps.length; i += 1) {
        await conn.query(
          `INSERT INTO client_steps (id, client_id, title, done, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), clientId, item.steps[i].title, item.steps[i].done ? 1 : 0, i, now, now]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

app.delete("/api/clients", async (req, res) => {
  await pool.query("DELETE FROM clients");
  res.json({ ok: true });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.sendFile(path.join(__dirname, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed while connecting to MySQL.");
    console.error(error);
    process.exit(1);
  }
})();
