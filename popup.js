const cssInput = document.querySelector("#css-input");
const applyButton = document.querySelector("#apply-button");
const removeButton = document.querySelector("#remove-button");
const cssFileInput = document.querySelector("#css-file-input");
const uploadButton = document.querySelector("#upload-button");
const exportButton = document.querySelector("#export-button");
const pageName = document.querySelector("#page-name");
const domainStatus = document.querySelector("#domain-status");
const domainStatusBox = document.querySelector(".domain-status");
const statusMessage = document.querySelector("#status");
const dashboardButton = document.querySelector("#dashboard-button");
const pickerButton = document.querySelector("#stylesheet-picker-button");
const pickerName = document.querySelector("#stylesheet-picker-name");
const pickerMenu = document.querySelector("#stylesheet-picker-menu");

const STYLESHEETS_KEY = "stylesheets";
const DOMAIN_RULES_KEY = "domainRules";
const DRAFT_KEY = "draftCss";
const EDITOR_ID_KEY = "editorStylesheetId";
const MAX_CSS_BYTES = 256 * 1024;

let activeTab;
let hostname;
let stylesheets = [];
let domainRules = {};
let selectedStylesheetId = null;

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function reportError(message, error) {
  console.error("[Purrfect CSS]", error);
  setStatus(message, true);
}

function isSupportedPage(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidTabId(tabId) {
  return Number.isInteger(tabId) && tabId >= 0;
}

function assertCssSize(css) {
  if (typeof css !== "string" || !css.trim()) {
    throw new Error("Enter some CSS before continuing.");
  }
  if (new Blob([css]).size > MAX_CSS_BYTES) {
    throw new Error("CSS must be 256 KB or smaller.");
  }
}

function validateCss(css) {
  assertCssSize(css);
  if (typeof CSSStyleSheet !== "function") {
    throw new Error("This browser does not support CSS validation.");
  }

  let sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  } catch {
    throw new Error("The stylesheet could not be parsed. Check your CSS syntax.");
  }

  function inspectRules(rules) {
    for (const rule of rules) {
      if (rule.type === 3) {
        throw new Error("@import is not allowed. Add the styles directly instead.");
      }
      const serialized = rule.cssText || "";
      if (/(?:^|[^a-z-])url\s*\(/i.test(serialized)) {
        throw new Error("External resource URLs are not allowed in CSS.");
      }
      if (/(?:-webkit-)?image-set\s*\(/i.test(serialized)) {
        throw new Error("image-set() resources are not allowed in CSS.");
      }
      if (rule.cssRules) inspectRules(rule.cssRules);
    }
  }

  inspectRules(sheet.cssRules);
  return css;
}

async function sendBackgroundMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

function uniqueId(prefix) {
  if (typeof crypto?.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadData() {
  const data = await chrome.storage.local.get([
    STYLESHEETS_KEY,
    DOMAIN_RULES_KEY,
    DRAFT_KEY,
    EDITOR_ID_KEY
  ]);
  stylesheets = Array.isArray(data[STYLESHEETS_KEY]) ? data[STYLESHEETS_KEY] : [];
  domainRules = data[DOMAIN_RULES_KEY] && typeof data[DOMAIN_RULES_KEY] === "object"
    ? data[DOMAIN_RULES_KEY]
    : {};

  if (!stylesheets.length) {
    const id = data[EDITOR_ID_KEY] || uniqueId("editor");
    stylesheets = [{
      id,
      name: "Custom CSS",
      source: "editor",
      css: typeof data[DRAFT_KEY] === "string" ? data[DRAFT_KEY] : "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];
    await chrome.storage.local.set({
      [STYLESHEETS_KEY]: stylesheets,
      [EDITOR_ID_KEY]: id
    });
  }
}

function disablePageControls() {
  applyButton.disabled = true;
  removeButton.disabled = true;
  uploadButton.disabled = false;
  pickerButton.disabled = false;
}

function updateDomainStatus() {
  const rule = hostname ? domainRules[hostname] : null;
  const active = stylesheets.find((item) => item.id === rule?.stylesheetId);
  domainStatusBox.classList.toggle("active", Boolean(active));

  if (!hostname) {
    domainStatus.textContent = "No supported domain";
    return;
  }
  if (active) {
    domainStatus.textContent = `${active.name} is applied across this domain`;
  } else {
    domainStatus.textContent = "No CSS is applied to this domain";
  }
  removeButton.disabled = !active;
}

function closePicker() {
  pickerMenu.hidden = true;
  pickerButton.setAttribute("aria-expanded", "false");
}

function openPicker() {
  renderPicker();
  pickerMenu.hidden = false;
  pickerButton.setAttribute("aria-expanded", "true");
  pickerMenu.querySelector(".picker-option")?.focus();
}

function runPickerAction(action) {
  Promise.resolve(action()).catch((error) => {
    reportError(error.message || "Could not update the stylesheet.", error);
  });
}

function renderPicker() {
  pickerMenu.replaceChildren();

  if (!stylesheets.length) {
    const empty = document.createElement("div");
    empty.className = "picker-row";
    empty.textContent = "No saved stylesheets";
    pickerMenu.append(empty);
    return;
  }

  stylesheets
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .forEach((stylesheet) => {
      const row = document.createElement("div");
      row.className = "picker-row";

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "picker-option";
      selectButton.setAttribute("role", "option");
      selectButton.setAttribute("aria-selected", String(selectedStylesheetId === stylesheet.id));
      selectButton.textContent = stylesheet.name;
      selectButton.addEventListener("click", () => {
        runPickerAction(() => applyLibraryStylesheet(stylesheet.id));
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "picker-delete";
      deleteButton.textContent = "×";
      deleteButton.title = `Delete ${stylesheet.name}`;
      deleteButton.setAttribute("aria-label", `Delete ${stylesheet.name} stylesheet`);
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        runPickerAction(() => deleteStylesheet(stylesheet));
      });

      row.append(selectButton, deleteButton);
      pickerMenu.append(row);
    });
}

async function applyLibraryStylesheet(stylesheetId, previousCss) {
  if (!isValidTabId(activeTab?.id) || !isSupportedPage(activeTab.url) || !hostname) {
    throw new Error("Open a regular website before applying CSS.");
  }
  const stylesheet = stylesheets.find((item) => item.id === stylesheetId);
  if (!stylesheet) throw new Error("The selected stylesheet no longer exists.");

  await sendBackgroundMessage({
    type: "APPLY_STYLESHEET",
    hostname,
    tabId: activeTab?.id,
    stylesheetId,
    previousCss: previousCss ?? stylesheets.find((item) => item.id === domainRules[hostname]?.stylesheetId)?.css
  });

  selectedStylesheetId = stylesheetId;
  pickerName.textContent = stylesheet.name;
  cssInput.value = stylesheet.css;
  await chrome.storage.local.set({
    [DRAFT_KEY]: stylesheet.css,
    [EDITOR_ID_KEY]: stylesheet.id
  });
  domainRules[hostname] = {
    stylesheetId,
    updatedAt: new Date().toISOString()
  };
  updateDomainStatus();
  closePicker();
  setStatus(`Applied ${stylesheet.name} to all pages on ${hostname}.`);
}

async function saveDraft() {
  if (new Blob([cssInput.value]).size > MAX_CSS_BYTES) {
    throw new Error("CSS must be 256 KB or smaller.");
  }
  await chrome.storage.local.set({ [DRAFT_KEY]: cssInput.value });
}

async function applyCss() {
  if (!isValidTabId(activeTab?.id) || !isSupportedPage(activeTab.url) || !hostname) {
    throw new Error("Open a regular website before applying CSS.");
  }

  const css = validateCss(cssInput.value);
  await saveDraft();

  let data = await chrome.storage.local.get(EDITOR_ID_KEY);
  let editorId = data[EDITOR_ID_KEY];
  let stylesheet = stylesheets.find((item) => item.id === editorId);

  if (!stylesheet) {
    editorId = uniqueId("editor");
    stylesheet = {
      id: editorId,
      name: "Custom CSS",
      source: "editor",
      css,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    stylesheets.push(stylesheet);
  } else {
    const previousCss = stylesheet.css;
    stylesheet.name = stylesheet.source === "editor" ? (stylesheet.name || "Custom CSS") : stylesheet.name;
    stylesheet.css = css;
    stylesheet.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({
      [STYLESHEETS_KEY]: stylesheets,
      [EDITOR_ID_KEY]: editorId
    });
    await applyLibraryStylesheet(editorId, previousCss);
    setStatus(`Custom CSS applied to all pages on ${hostname}.`);
    return;
  }

  await chrome.storage.local.set({
    [STYLESHEETS_KEY]: stylesheets,
    [EDITOR_ID_KEY]: editorId
  });
  await applyLibraryStylesheet(editorId);
  setStatus(`Custom CSS applied to all pages on ${hostname}.`);
}

async function removeCss() {
  if (!hostname) throw new Error("There is no supported website domain.");
  await sendBackgroundMessage({
    type: "REMOVE_DOMAIN_CSS",
    hostname,
    tabId: activeTab?.id
  });
  delete domainRules[hostname];
  updateDomainStatus();
  setStatus(`CSS removed from ${hostname}.`);
}

async function uploadCss(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".css")) {
    throw new Error("Choose a .css file to upload.");
  }
  if (file.size > MAX_CSS_BYTES) {
    throw new Error("CSS files must be 256 KB or smaller.");
  }

  const css = validateCss(await file.text());
  const baseName = file.name.replace(/\.css$/i, "").trim() || "Uploaded CSS";
  const stylesheet = {
    id: uniqueId("uploaded"),
    name: baseName,
    source: "uploaded",
    css,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  stylesheets.push(stylesheet);

  await chrome.storage.local.set({
    [STYLESHEETS_KEY]: stylesheets,
    [DRAFT_KEY]: css,
    [EDITOR_ID_KEY]: stylesheet.id
  });
  cssInput.value = css;
  pickerName.textContent = stylesheet.name;

  if (hostname && isSupportedPage(activeTab.url)) {
    await applyLibraryStylesheet(stylesheet.id);
    setStatus(`${stylesheet.name} uploaded and applied to ${hostname}.`);
  } else {
    setStatus("CSS uploaded and saved. Open a regular website to apply it.");
  }
}

async function deleteStylesheet(stylesheet) {
  const usedOn = Object.entries(domainRules)
    .filter(([, rule]) => rule.stylesheetId === stylesheet.id)
    .map(([domain]) => domain);
  const warning = usedOn.length
    ? `Delete "${stylesheet.name}"? It will be removed from ${usedOn.length} domain${usedOn.length === 1 ? "" : "s"} and the stylesheet library.`
    : `Delete "${stylesheet.name}" from the stylesheet library?`;
  if (!window.confirm(warning)) return;

  await sendBackgroundMessage({
    type: "DELETE_STYLESHEET",
    stylesheetId: stylesheet.id
  });
  stylesheets = stylesheets.filter((item) => item.id !== stylesheet.id);
  await chrome.storage.local.set({
    [STYLESHEETS_KEY]: stylesheets
  });
  for (const domain of usedOn) delete domainRules[domain];

  if (selectedStylesheetId === stylesheet.id) {
    selectedStylesheetId = stylesheets[0]?.id || null;
    pickerName.textContent = stylesheets[0]?.name || "No saved stylesheets";
  }
  updateDomainStatus();
  closePicker();
  setStatus(`${stylesheet.name} deleted.`, false);
}

function exportCss() {
  try {
    if (new Blob([cssInput.value]).size > MAX_CSS_BYTES) {
      throw new Error("CSS must be 256 KB or smaller.");
    }
    const blob = new Blob([cssInput.value], { type: "text/css;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = "purrfect-custom.css";
    downloadLink.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setStatus("CSS exported as purrfect-custom.css.");
  } catch (error) {
    reportError("Could not export CSS. Check the stylesheet size.", error);
  }
}

async function initialize() {
  try {
    if (typeof chrome.storage.local.setAccessLevel === "function") {
      await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    }
    await loadData();
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!isValidTabId(activeTab?.id) || !isSupportedPage(activeTab.url)) {
      pageName.textContent = "This page does not allow extensions.";
      domainStatus.textContent = "Open a regular http:// or https:// website.";
      setStatus("CSS can only be used on regular websites.", true);
      disablePageControls();
      return;
    }

    hostname = new URL(activeTab.url).hostname.replace(/^www\./i, "").toLowerCase();
    pageName.textContent = typeof activeTab.title === "string" && activeTab.title
      ? activeTab.title
      : hostname;

    const rule = domainRules[hostname];
    selectedStylesheetId = rule?.stylesheetId || null;
    const selected = stylesheets.find((item) => item.id === selectedStylesheetId);
    if (selected) {
      pickerName.textContent = selected.name;
      cssInput.value = selected.css;
    } else {
      const data = await chrome.storage.local.get(DRAFT_KEY);
      cssInput.value = typeof data[DRAFT_KEY] === "string"
        ? data[DRAFT_KEY]
        : stylesheets[0]?.css || "";
      selectedStylesheetId = stylesheets[0]?.id || null;
      pickerName.textContent = stylesheets[0]?.name || "No saved stylesheets";
    }

    updateDomainStatus();
  } catch (error) {
    pageName.textContent = "Could not access the current page.";
    reportError("Could not initialize Purrfect CSS. Try reopening the popup.", error);
    disablePageControls();
  }
}

cssInput.addEventListener("input", () => {
  saveDraft().catch((error) => reportError("Could not save your draft.", error));
});

applyButton.addEventListener("click", () => {
  applyCss().catch((error) => reportError(error.message || "Could not apply CSS.", error));
});

removeButton.addEventListener("click", () => {
  removeCss().catch((error) => reportError("Could not remove CSS from this domain.", error));
});

uploadButton.addEventListener("click", () => cssFileInput.click());
cssFileInput.addEventListener("change", () => {
  uploadCss(cssFileInput.files?.[0])
    .catch((error) => reportError(error.message || "Could not upload CSS.", error))
    .finally(() => { cssFileInput.value = ""; });
});
exportButton.addEventListener("click", exportCss);

pickerButton.addEventListener("click", () => {
  if (pickerMenu.hidden) openPicker();
  else closePicker();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".picker")) closePicker();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePicker();
});

dashboardButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

const catImage = document.querySelector(".cat-image");
catImage?.addEventListener("error", () => {
  catImage.style.display = "none";
  const fallback = catImage.nextElementSibling;
  if (fallback) fallback.style.display = "flex";
});

initialize();
