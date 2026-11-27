const STYLESHEETS_KEY = "stylesheets";
const DOMAIN_RULES_KEY = "domainRules";
const DRAFT_KEY = "draftCss";
const MAX_CSS_BYTES = 256 * 1024;

let stylesheets = [];
let domainRules = {};
let selectedId = null;

const list = document.querySelector("#stylesheet-list");
const search = document.querySelector("#stylesheet-search");
const nameInput = document.querySelector("#stylesheet-name");
const editor = document.querySelector("#stylesheet-editor");
const detail = document.querySelector("#stylesheet-detail");
const empty = document.querySelector("#stylesheet-empty");
const status = document.querySelector("#dashboard-status");
const appliedDomainList = document.querySelector("#applied-domain-list");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b10e1e" : "#686868";
}

function uniqueId(prefix) {
  if (typeof crypto?.randomUUID === "function")
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function assertCss(css) {
  if (!css.trim()) throw new Error("Enter some CSS before saving.");
  if (new Blob([css]).size > MAX_CSS_BYTES)
    throw new Error("CSS must be 256 KB or smaller.");
  if (typeof CSSStyleSheet !== "function")
    throw new Error("CSS validation is unavailable.");
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(css);
  } catch {
    throw new Error("The stylesheet could not be parsed.");
  }
  function inspect(rules) {
    for (const rule of rules) {
      if (rule.type === 3) throw new Error("@import is not allowed.");
      if (/(?:^|[^a-z-])url\s*\(/i.test(rule.cssText || "")) {
        throw new Error("External resource URLs are not allowed.");
      }
      if (/(?:-webkit-)?image-set\s*\(/i.test(rule.cssText || "")) {
        throw new Error("image-set() resources are not allowed.");
      }
      if (rule.cssRules) inspect(rule.cssRules);
    }
  }
  inspect(sheet.cssRules);
  return css;
}

async function load() {
  const data = await chrome.storage.local.get([
    STYLESHEETS_KEY,
    DOMAIN_RULES_KEY,
  ]);
  stylesheets = Array.isArray(data[STYLESHEETS_KEY])
    ? data[STYLESHEETS_KEY]
    : [];
  domainRules =
    data[DOMAIN_RULES_KEY] && typeof data[DOMAIN_RULES_KEY] === "object"
      ? data[DOMAIN_RULES_KEY]
      : {};
  renderList();
  renderDomains();
  if (stylesheets.length) selectStylesheet(stylesheets[0].id);
}

function stylesheetDomains(stylesheetId) {
  return Object.entries(domainRules)
    .filter(([, rule]) => rule.stylesheetId === stylesheetId)
    .map(([hostname]) => hostname);
}

function renderList() {
  const query = search.value.trim().toLowerCase();
  list.replaceChildren();
  const filtered = stylesheets
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .filter((item) => item.name.toLowerCase().includes(query));

  if (!filtered.length) {
    const emptyItem = document.createElement("p");
    emptyItem.textContent = "No stylesheets found.";
    list.append(emptyItem);
    return;
  }

  filtered.forEach((stylesheet) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `list-item${stylesheet.id === selectedId ? " active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = stylesheet.name;
    const meta = document.createElement("small");
    const domains = stylesheetDomains(stylesheet.id);
    meta.textContent = `${stylesheet.source === "uploaded" ? "Uploaded" : "Editor"} · ${domains.length} domain${domains.length === 1 ? "" : "s"}`;
    button.append(title, meta);
    button.addEventListener("click", () => selectStylesheet(stylesheet.id));
    list.append(button);
  });
}

function selectStylesheet(id) {
  const stylesheet = stylesheets.find((item) => item.id === id);
  if (!stylesheet) return;
  selectedId = id;
  empty.hidden = true;
  detail.hidden = false;
  nameInput.value = stylesheet.name;
  editor.value = stylesheet.css;
  setStatus("");
  renderAppliedDomains();
  renderList();
}

function renderAppliedDomains() {
  appliedDomainList.replaceChildren();
  const domains = stylesheetDomains(selectedId);
  if (!domains.length) {
    const text = document.createElement("p");
    text.textContent = "This stylesheet is not applied to any domain.";
    appliedDomainList.append(text);
    return;
  }

  domains.forEach((hostname) => {
    const row = document.createElement("div");
    row.className = "applied-domain-row";
    const label = document.createElement("span");
    label.textContent = hostname;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "REMOVE_DOMAIN_CSS", hostname });
      domainRules =
        (await chrome.storage.local.get(DOMAIN_RULES_KEY))[DOMAIN_RULES_KEY] ||
        {};
      renderAppliedDomains();
      renderDomains();
      renderList();
    });
    row.append(label, remove);
    appliedDomainList.append(row);
  });
}

async function saveSelected() {
  const stylesheet = stylesheets.find((item) => item.id === selectedId);
  if (!stylesheet) return;
  try {
    const css = assertCss(editor.value);
    const oldCss = stylesheet.css;
    stylesheet.name = nameInput.value.trim() || stylesheet.name;
    stylesheet.css = css;
    stylesheet.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({
      [STYLESHEETS_KEY]: stylesheets,
      [DRAFT_KEY]: css,
    });

    const affectedDomains = stylesheetDomains(selectedId);
    for (const hostname of affectedDomains) {
      await chrome.runtime.sendMessage({
        type: "APPLY_STYLESHEET",
        hostname,
        stylesheetId: selectedId,
        previousCss: oldCss,
      });
    }
    setStatus("Changes saved and applied.");
    renderList();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteSelected() {
  const stylesheet = stylesheets.find((item) => item.id === selectedId);
  if (!stylesheet) return;
  if (
    !window.confirm(
      `Delete "${stylesheet.name}" and remove it from every applied domain?`,
    )
  )
    return;
  await chrome.runtime.sendMessage({
    type: "DELETE_STYLESHEET",
    stylesheetId: selectedId,
  });
  stylesheets = stylesheets.filter((item) => item.id !== selectedId);
  const data = await chrome.storage.local.get(DOMAIN_RULES_KEY);
  domainRules = data[DOMAIN_RULES_KEY] || {};
  selectedId = stylesheets[0]?.id || null;
  if (selectedId) selectStylesheet(selectedId);
  else {
    detail.hidden = true;
    empty.hidden = false;
  }
  renderList();
  renderDomains();
}

async function uploadFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".css")) {
    setStatus("Choose a .css file.", true);
    return;
  }
  if (file.size > MAX_CSS_BYTES) {
    setStatus("CSS files must be 256 KB or smaller.", true);
    return;
  }
  try {
    const css = assertCss(await file.text());
    const stylesheet = {
      id: uniqueId("uploaded"),
      name: file.name.replace(/\.css$/i, "").trim() || "Uploaded CSS",
      source: "uploaded",
      css,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    stylesheets.push(stylesheet);
    await chrome.storage.local.set({
      [STYLESHEETS_KEY]: stylesheets,
      [DRAFT_KEY]: css,
    });
    selectStylesheet(stylesheet.id);
    setStatus(
      "Uploaded CSS saved. It is ready to apply from a supported domain.",
    );
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderDomains() {
  const container = document.querySelector("#domain-list");
  const query = document
    .querySelector("#domain-search")
    .value.trim()
    .toLowerCase();
  container.replaceChildren();
  Object.entries(domainRules)
    .filter(([hostname]) => hostname.toLowerCase().includes(query))
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([hostname, rule]) => {
      const stylesheet = stylesheets.find(
        (item) => item.id === rule.stylesheetId,
      );
      const row = document.createElement("div");
      row.className = "domain-row";
      row.setAttribute("role", "row");
      const domain = document.createElement("span");
      domain.textContent = hostname;
      const name = document.createElement("span");
      name.textContent = stylesheet?.name || "Missing stylesheet";
      const statusText = document.createElement("span");
      statusText.textContent = stylesheet ? "Applied" : "Inactive";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
          type: "REMOVE_DOMAIN_CSS",
          hostname,
        });
        domainRules =
          (await chrome.storage.local.get(DOMAIN_RULES_KEY))[
            DOMAIN_RULES_KEY
          ] || {};
        renderDomains();
        renderAppliedDomains();
        renderList();
      });
      row.append(domain, name, statusText, remove);
      container.append(row);
    });

  if (!container.children.length) {
    const row = document.createElement("div");
    row.className = "domain-row";
    row.textContent = "No active domain rules.";
    container.append(row);
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.remove("active");
      item.removeAttribute("aria-current");
    });
    button.classList.add("active");
    button.setAttribute("aria-current", "page");
    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = true;
    });
    document.querySelector(`#${button.dataset.view}-view`).hidden = false;
  });
});

search.addEventListener("input", renderList);
document
  .querySelector("#domain-search")
  .addEventListener("input", renderDomains);
document.querySelector("#save-button").addEventListener("click", saveSelected);
document
  .querySelector("#delete-button")
  .addEventListener("click", deleteSelected);
document
  .querySelector("#duplicate-button")
  .addEventListener("click", async () => {
    const source = stylesheets.find((item) => item.id === selectedId);
    if (!source) return;
    const copy = {
      ...source,
      id: uniqueId("copied"),
      name: `${source.name} Copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    stylesheets.push(copy);
    await chrome.storage.local.set({ [STYLESHEETS_KEY]: stylesheets });
    selectStylesheet(copy.id);
  });

function exportStylesheet(stylesheet) {
  const blob = new Blob([stylesheet.css], { type: "text/css;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${stylesheet.name}.css`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector("#export-button").addEventListener("click", () => {
  const stylesheet = stylesheets.find((item) => item.id === selectedId);
  if (stylesheet) exportStylesheet(stylesheet);
});

document
  .querySelector("#upload-dashboard-button")
  .addEventListener("click", () => {
    document.querySelector("#dashboard-file-input").click();
  });
document
  .querySelector("#dashboard-file-input")
  .addEventListener("change", (event) => {
    uploadFile(event.target.files?.[0]).finally(() => {
      event.target.value = "";
    });
  });

document.querySelector("#export-all-button").addEventListener("click", () => {
  const blob = new Blob(
    [JSON.stringify({ stylesheets, domainRules }, null, 2)],
    {
      type: "application/json",
    },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "purrfect-css-backup.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.querySelector("#clear-button").addEventListener("click", async () => {
  if (
    !window.confirm(
      "Clear every stylesheet and domain rule? This cannot be undone.",
    )
  )
    return;
  for (const [hostname] of Object.entries(domainRules)) {
    await chrome.runtime.sendMessage({ type: "REMOVE_DOMAIN_CSS", hostname });
  }
  await chrome.storage.local.clear();
  stylesheets = [];
  domainRules = {};
  selectedId = null;
  detail.hidden = true;
  empty.hidden = false;
  renderList();
  renderDomains();
  setStatus("All Purrfect CSS data cleared.");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STYLESHEETS_KEY])
    stylesheets = changes[STYLESHEETS_KEY].newValue || [];
  if (changes[DOMAIN_RULES_KEY])
    domainRules = changes[DOMAIN_RULES_KEY].newValue || {};
  renderList();
  renderDomains();
  if (selectedId) {
    const stylesheet = stylesheets.find((item) => item.id === selectedId);
    if (stylesheet) renderAppliedDomains();
  }
});

load();
