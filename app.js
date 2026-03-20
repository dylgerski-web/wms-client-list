const API_BASE = "/api";

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

async function init() {
  bindEvents();
  await refreshClients();
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

  el.clearData.addEventListener("click", async () => {
    if (!confirm("Delete all clients and progress data?")) {
      return;
    }

    try {
      await api("/clients", { method: "DELETE" });
      state.clients = [];
      state.selectedClientId = null;
      render();
    } catch (error) {
      reportError(error);
    }
  });

  el.seedDemo.addEventListener("click", seedDemoData);
}

async function handleCreateClient(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  const payload = {
    name: toCleanString(formData.get("name")),
    contact: toCleanString(formData.get("contact")),
    integrationType: toCleanString(formData.get("integrationType")),
    priority: toCleanString(formData.get("priority")),
    parts: parseCsvItems(formData.get("parts")),
    steps: parseCsvItems(formData.get("steps")),
  };

  if (!payload.name || payload.parts.length === 0 || payload.steps.length === 0) {
    alert("Please provide client name, at least one part, and at least one step.");
    return;
  }

  try {
    const created = await api("/clients", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.selectedClientId = created.id;
    event.currentTarget.reset();
    await refreshClients();
    render();
  } catch (error) {
    reportError(error);
  }
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

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return null;
}

function reportError(error) {
  console.error(error);
  alert("Unable to sync with server. Check backend/API connection.");
}

async function refreshClients() {
  state.clients = await api("/clients");
  if (!state.clients.some((client) => client.id === state.selectedClientId)) {
    state.selectedClientId = state.clients[0]?.id || null;
  }
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
  overall?.addEventListener("change", async (event) => {
    try {
      await api(`/clients/${clientId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: event.target.value }),
      });
      await refreshClients();
      render();
    } catch (error) {
      reportError(error);
    }
  });

  document.querySelectorAll(".part-status-select").forEach((select) => {
    select.addEventListener("change", async (event) => {
      const partId = event.target.dataset.partId;
      try {
        await api(`/clients/${clientId}/parts/${partId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: event.target.value }),
        });
        await refreshClients();
        render();
      } catch (error) {
        reportError(error);
      }
    });
  });

  document.querySelectorAll(".step-toggle").forEach((checkbox) => {
    checkbox.addEventListener("change", async (event) => {
      const stepId = event.target.dataset.stepId;
      const selected = getSelectedClient();
      if (!selected) {
        return;
      }

      const simulated = {
        ...selected,
        steps: selected.steps.map((step) =>
          step.id === stepId
            ? {
                ...step,
                done: event.target.checked,
              }
            : step
        ),
      };

      let nextStatus = selected.status;
      const progress = getProgress(simulated);
      if (progress === 0) {
        nextStatus = "Not Started";
      } else if (progress === 100) {
        nextStatus = "Completed";
      } else if (selected.status === "Not Started" || selected.status === "Completed") {
        nextStatus = "In Progress";
      }

      try {
        await api(`/clients/${clientId}/steps/${stepId}`, {
          method: "PATCH",
          body: JSON.stringify({ done: event.target.checked }),
        });

        if (nextStatus !== selected.status) {
          await api(`/clients/${clientId}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: nextStatus }),
          });
        }

        await refreshClients();
        render();
      } catch (error) {
        reportError(error);
      }
    });
  });

  document.getElementById("add-part-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const partName = toCleanString(formData.get("part"));
    if (!partName) {
      return;
    }

    try {
      await api(`/clients/${clientId}/parts`, {
        method: "POST",
        body: JSON.stringify({ name: partName }),
      });
      await refreshClients();
      render();
    } catch (error) {
      reportError(error);
    }
  });

  document.getElementById("add-step-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const stepTitle = toCleanString(formData.get("step"));
    if (!stepTitle) {
      return;
    }

    try {
      await api(`/clients/${clientId}/steps`, {
        method: "POST",
        body: JSON.stringify({ title: stepTitle }),
      });
      const refreshed = state.clients.find((client) => client.id === clientId);
      if (refreshed?.status === "Completed") {
        await api(`/clients/${clientId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "In Progress" }),
        });
      }
      await refreshClients();
      render();
    } catch (error) {
      reportError(error);
    }
  });
}

function statusOptions(selected) {
  const statuses = ["Not Started", "In Progress", "Blocked", "On Hold", "Completed"];
  return statuses
    .map((status) => `<option value="${status}" ${status === selected ? "selected" : ""}>${status}</option>`)
    .join("");
}

async function seedDemoData() {
  if (state.clients.length && !confirm("Demo data will be added to current data. Continue?")) {
    return;
  }
  try {
    await api("/demo", { method: "POST" });
    await refreshClients();
    render();
  } catch (error) {
    reportError(error);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
