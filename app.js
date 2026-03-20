const STORAGE_KEY = "neon-integration-grid-v1";

const state = {
  clients: [],
  selectedClientId: null,
  search: "",
  statusFilter: "all",
};

const el = {
  clientForm: document.getElementById("client-form"),
  clientsList: document.getElementById("clients-list"),
  clientCardTemplate: document.getElementById("client-card-template"),
  detailPanel: document.getElementById("detail-panel"),
  searchInput: document.getElementById("search-input"),
  statusFilter: document.getElementById("status-filter"),
  clearData: document.getElementById("clear-data"),
  seedDemo: document.getElementById("seed-demo"),
  clientCount: document.getElementById("client-count"),
  kpiTotal: document.getElementById("kpi-total"),
  kpiProgress: document.getElementById("kpi-progress"),
  kpiBlocked: document.getElementById("kpi-blocked"),
  kpiCompleted: document.getElementById("kpi-completed"),
};

init();

function init() {
  loadState();
  bindEvents();
  render();
}

function bindEvents() {
  el.clientForm.addEventListener("submit", handleCreateClient);

  el.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });

  el.statusFilter.addEventListener("change", (event) => {
    state.statusFilter = event.target.value;
    render();
  });

  el.clearData.addEventListener("click", () => {
    if (!confirm("Delete all clients and progress data?")) {
      return;
    }

    state.clients = [];
    state.selectedClientId = null;
    persistState();
    render();
  });

  el.seedDemo.addEventListener("click", seedDemoData);
}

function handleCreateClient(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  const client = {
    id: crypto.randomUUID(),
    name: toCleanString(formData.get("name")),
    contact: toCleanString(formData.get("contact")),
    integrationType: toCleanString(formData.get("integrationType")),
    priority: toCleanString(formData.get("priority")),
    status: "Not Started",
    parts: parseCsvItems(formData.get("parts")).map((name) => ({
      id: crypto.randomUUID(),
      name,
      status: "Not Started",
    })),
    steps: parseCsvItems(formData.get("steps")).map((title) => ({
      id: crypto.randomUUID(),
      title,
      done: false,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!client.name || client.parts.length === 0 || client.steps.length === 0) {
    alert("Please provide client name, at least one part, and at least one step.");
    return;
  }

  state.clients.unshift(client);
  state.selectedClientId = client.id;
  event.currentTarget.reset();
  persistState();
  render();
}

function parseCsvItems(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCleanString(value) {
  return String(value || "").trim();
}

function getStage(client) {
  const currentStep = client.steps.find((step) => !step.done);
  if (!currentStep) {
    return "Completed";
  }
  return currentStep.title;
}

function getProgress(client) {
  if (!client.steps.length) {
    return 0;
  }
  const completed = client.steps.filter((step) => step.done).length;
  return Math.round((completed / client.steps.length) * 100);
}

function getSelectedClient() {
  return state.clients.find((client) => client.id === state.selectedClientId) || null;
}

function getVisibleClients() {
  const bySearch = state.clients.filter((client) => {
    if (!state.search) {
      return true;
    }

    const haystack = [client.name, client.contact, client.integrationType].join(" ").toLowerCase();
    return haystack.includes(state.search);
  });

  if (state.statusFilter === "all") {
    return bySearch;
  }

  return bySearch.filter((client) => client.status === state.statusFilter);
}

function render() {
  renderKpis();
  renderClientCards();
  renderDetail();
}

function renderKpis() {
  const total = state.clients.length;
  const inProgress = state.clients.filter((c) => c.status === "In Progress").length;
  const blocked = state.clients.filter((c) => c.status === "Blocked").length;
  const completed = state.clients.filter((c) => c.status === "Completed").length;

  el.kpiTotal.textContent = String(total);
  el.kpiProgress.textContent = String(inProgress);
  el.kpiBlocked.textContent = String(blocked);
  el.kpiCompleted.textContent = String(completed);
}

function renderClientCards() {
  const clients = getVisibleClients();
  el.clientCount.textContent = `${clients.length} clients shown`;
  el.clientsList.innerHTML = "";

  if (!clients.length) {
    el.clientsList.innerHTML = "<p>No clients match the current filters.</p>";
    return;
  }

  for (const client of clients) {
    const node = el.clientCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".client-name").textContent = client.name;
    node.querySelector(".client-meta").textContent = `${client.integrationType} | ${client.priority}`;
    node.querySelector(".status-pill").textContent = client.status;

    const progress = getProgress(client);
    node.querySelector(".progress-fill").style.width = `${progress}%`;
    node.querySelector(".progress-text").textContent = `${progress}% complete`;
    node.querySelector(".stage-line").textContent = `Current Stage: ${getStage(client)}`;

    if (client.id === state.selectedClientId) {
      node.classList.add("active");
    }

    node.addEventListener("click", () => {
      state.selectedClientId = client.id;
      render();
    });

    el.clientsList.appendChild(node);
  }
}

function renderDetail() {
  const client = getSelectedClient();
  if (!client) {
    el.detailPanel.innerHTML = `
      <h2>Client Detail</h2>
      <p class="detail-empty">Select a client to inspect and update parts/steps.</p>
    `;
    return;
  }

  const partsMarkup = client.parts
    .map(
      (part) => `
      <div class="list-item" data-part-id="${part.id}">
        <div>
          <strong>${escapeHtml(part.name)}</strong>
          <br />
          <small>Status: ${escapeHtml(part.status)}</small>
        </div>
        <select class="slim part-status-select" data-part-id="${part.id}">
          ${statusOptions(part.status)}
        </select>
      </div>
    `
    )
    .join("");

  const stepsMarkup = client.steps
    .map(
      (step) => `
      <div class="list-item" data-step-id="${step.id}">
        <label>
          <input type="checkbox" class="step-toggle" data-step-id="${step.id}" ${step.done ? "checked" : ""} />
          ${escapeHtml(step.title)}
        </label>
        <small>${step.done ? "Done" : "Pending"}</small>
      </div>
    `
    )
    .join("");

  el.detailPanel.innerHTML = `
    <h2>Client Detail</h2>
    <div class="detail-title">
      <div>
        <h3>${escapeHtml(client.name)}</h3>
        <p>${escapeHtml(client.contact)} | ${escapeHtml(client.integrationType)}</p>
      </div>
      <div>
        <label>
          Overall Status
          <select id="overall-status" class="slim">
            ${statusOptions(client.status)}
          </select>
        </label>
      </div>
    </div>

    <div class="detail-grid">
      <section class="block">
        <h3>Integration Parts</h3>
        <div class="list">${partsMarkup || "<p>No parts yet.</p>"}</div>
        <form id="add-part-form" class="inline-form">
          <input type="text" name="part" placeholder="Add part" required />
          <button class="ghost-btn" type="submit">Add</button>
        </form>
      </section>

      <section class="block">
        <h3>Integration Steps</h3>
        <div class="list">${stepsMarkup || "<p>No steps yet.</p>"}</div>
        <form id="add-step-form" class="inline-form">
          <input type="text" name="step" placeholder="Add step" required />
          <button class="ghost-btn" type="submit">Add</button>
        </form>
      </section>
    </div>
  `;

  wireDetailInteractions(client.id);
}

function wireDetailInteractions(clientId) {
  const overall = document.getElementById("overall-status");
  overall?.addEventListener("change", (event) => {
    updateClient(clientId, (client) => {
      client.status = event.target.value;
    });
  });

  document.querySelectorAll(".part-status-select").forEach((select) => {
    select.addEventListener("change", (event) => {
      const partId = event.target.dataset.partId;
      updateClient(clientId, (client) => {
        const part = client.parts.find((item) => item.id === partId);
        if (!part) {
          return;
        }
        part.status = event.target.value;
      });
    });
  });

  document.querySelectorAll(".step-toggle").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const stepId = event.target.dataset.stepId;
      updateClient(clientId, (client) => {
        const step = client.steps.find((item) => item.id === stepId);
        if (!step) {
          return;
        }
        step.done = event.target.checked;

        const progress = getProgress(client);
        if (progress === 0) {
          client.status = "Not Started";
        } else if (progress === 100) {
          client.status = "Completed";
        } else if (client.status === "Not Started" || client.status === "Completed") {
          client.status = "In Progress";
        }
      });
    });
  });

  document.getElementById("add-part-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const partName = toCleanString(formData.get("part"));
    if (!partName) {
      return;
    }

    updateClient(clientId, (client) => {
      client.parts.push({
        id: crypto.randomUUID(),
        name: partName,
        status: "Not Started",
      });
    });
  });

  document.getElementById("add-step-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const stepTitle = toCleanString(formData.get("step"));
    if (!stepTitle) {
      return;
    }

    updateClient(clientId, (client) => {
      client.steps.push({
        id: crypto.randomUUID(),
        title: stepTitle,
        done: false,
      });
      if (client.status === "Completed") {
        client.status = "In Progress";
      }
    });
  });
}

function statusOptions(selected) {
  const statuses = ["Not Started", "In Progress", "Blocked", "On Hold", "Completed"];
  return statuses
    .map((status) => `<option value="${status}" ${status === selected ? "selected" : ""}>${status}</option>`)
    .join("");
}

function updateClient(clientId, updater) {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) {
    return;
  }

  updater(client);
  client.updatedAt = new Date().toISOString();
  persistState();
  render();
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.clients));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }

    state.clients = parsed;
  } catch {
    state.clients = [];
  }
}

function seedDemoData() {
  if (state.clients.length && !confirm("Demo data will be added to current data. Continue?")) {
    return;
  }

  const demo = [
    {
      id: crypto.randomUUID(),
      name: "Nova Freight",
      contact: "Ivy Torres",
      integrationType: "WMS + EDI",
      priority: "High",
      status: "In Progress",
      parts: [
        { id: crypto.randomUUID(), name: "Contract", status: "Completed" },
        { id: crypto.randomUUID(), name: "API Credentials", status: "In Progress" },
        { id: crypto.randomUUID(), name: "Data Mapping", status: "Not Started" },
      ],
      steps: [
        { id: crypto.randomUUID(), title: "Kickoff", done: true },
        { id: crypto.randomUUID(), title: "Access Provisioning", done: true },
        { id: crypto.randomUUID(), title: "Endpoint Testing", done: false },
        { id: crypto.randomUUID(), title: "Go-Live", done: false },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "Titan Retail",
      contact: "Lena Park",
      integrationType: "WMS + API",
      priority: "Critical",
      status: "Blocked",
      parts: [
        { id: crypto.randomUUID(), name: "Security Review", status: "Blocked" },
        { id: crypto.randomUUID(), name: "Sandbox", status: "Completed" },
      ],
      steps: [
        { id: crypto.randomUUID(), title: "Requirements", done: true },
        { id: crypto.randomUUID(), title: "Credential Exchange", done: false },
        { id: crypto.randomUUID(), title: "Validation", done: false },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  state.clients = [...demo, ...state.clients];
  state.selectedClientId = demo[0].id;
  persistState();
  render();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
