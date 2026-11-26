const state = { tabId: null, snapshot: null, inspectorActive: false };
const SNAPSHOT_KEY = "designSnapshots";
let assetLayout = "tiles";
let colorView = "palette";

async function activeTab() {
  const requestedTabValue = new URLSearchParams(location.search).get("tabId");
  const requestedTabId = requestedTabValue !== null && /^\d+$/.test(requestedTabValue)
    ? Number(requestedTabValue)
    : null;
  const requestedTab = Number.isInteger(requestedTabId) && requestedTabId >= 0
    ? await chrome.tabs.get(requestedTabId).catch(() => null)
    : null;
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = requestedTab || currentTab;
  state.tabId = tab?.id ?? null;
  const origin = tab?.url ? new URL(tab.url).hostname : "Unsupported page";
  document.querySelector("#page-origin").textContent = origin;
  return tab;
}

async function sendBackground(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function ensureContent(tab) {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) {
    throw new Error("Open a regular HTTP or HTTPS website.");
  }
  await sendBackground({ type: "INSPECTOR_ENSURE_CONTENT", tabId: tab.id });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function copyIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("button-icon");
  const rect = document.createElementNS(svg.namespaceURI, "rect");
  rect.setAttribute("width", "14");
  rect.setAttribute("height", "14");
  rect.setAttribute("x", "8");
  rect.setAttribute("y", "8");
  rect.setAttribute("rx", "2");
  rect.setAttribute("ry", "2");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2");
  svg.append(rect, path);
  return svg;
}

function downloadIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("button-icon");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3");
  svg.append(path);
  return svg;
}

function contrastIcon(passes) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add(
    "lucide",
    passes ? "lucide-circle-check" : "lucide-circle-x",
    "preview-icon",
    "contrast-icon"
  );
  const circle = document.createElementNS(svg.namespaceURI, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  svg.append(circle);
  const pathData = passes
    ? ["m16 9-5.5 5.5L8 12"]
    : ["m15 9-6 6", "m9 9 6 6"];
  pathData.forEach((data) => {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", data);
    svg.append(path);
  });
  return svg;
}

function contrastGrade(level, threshold, ratio) {
  const passes = ratio >= threshold;
  const badge = el("span", `contrast-chip ${passes ? "pass" : "fail"}`);
  badge.append(
    contrastIcon(passes),
    document.createTextNode(`${level} ≥ ${threshold}:1 · ${passes ? "Pass" : "Fail"}`)
  );
  return badge;
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const originalLabel = button.dataset.copyLabel || "Copy";
    const originalAriaLabel = button.dataset.ariaLabel || originalLabel;
    const tooltip = button.querySelector(".button-tooltip");
    if (tooltip) tooltip.textContent = "Copied";
    button.setAttribute("aria-label", "Copied to clipboard");
    window.setTimeout(() => {
      if (tooltip) tooltip.textContent = originalLabel;
      button.setAttribute("aria-label", originalAriaLabel);
    }, 1200);
  } catch (error) {
    console.error("[Purrfect CSS] Could not copy to clipboard.", error);
  }
}

function parseRgb(value) {
  const rgb = value.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => Number.parseFloat(part));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      const alpha = Number.isFinite(parts[3]) ? parts[3] : 1;
      return parts.slice(0, 3).map((part) => part * alpha + 255 * (1 - alpha));
    }
  }
  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const digits = hex[1].length === 3 || hex[1].length === 4
      ? hex[1].slice(0, 3).split("").map((part) => Number.parseInt(part + part, 16))
      : [0, 2, 4].map((index) => Number.parseInt(hex[1].slice(index, index + 2), 16));
    return digits.length === 3 && digits.every(Number.isFinite) ? digits : null;
  }
  return null;
}

function contrastingText(color) {
  const rgb = parseRgb(color);
  if (!rgb) return "#242424";
  const linear = rgb.map((value) => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.179 ? "#242424" : "#ffffff";
}

function makeCopyButton(value, label = "Copy") {
  const button = el("button", "copy-value copy-icon-button");
  button.type = "button";
  button.dataset.copyLabel = label;
  button.dataset.ariaLabel = `${label} ${value}`;
  button.setAttribute("aria-label", button.dataset.ariaLabel);
  const tooltip = el("span", "button-tooltip", label);
  tooltip.setAttribute("aria-hidden", "true");
  button.append(copyIcon(), tooltip);
  button.addEventListener("click", () => copyText(value, button));
  return button;
}

function appendColorValue(parent, label, value) {
  const valueWrap = el("div", "color-value");
  const swatch = el("span", "inline-swatch");
  swatch.style.backgroundColor = value;
  swatch.setAttribute("aria-hidden", "true");
  valueWrap.append(swatch, el("span", "color-code", value), makeCopyButton(value));
  parent.append(el("dt", "", label), Object.assign(el("dd"), { className: "color-detail" }));
  parent.lastElementChild.append(valueWrap);
}

function setMetric(container, value, label) {
  const metric = el("div", "metric");
  metric.append(el("strong", "", String(value)), el("span", "", label));
  container.append(metric);
}

async function runScan() {
  const tab = await activeTab();
  await ensureContent(tab);
  const result = await sendBackground({
    type: "INSPECTOR_SCAN",
    tabId: tab.id,
    payload: { limit: 250 }
  });
  state.snapshot = result.snapshot;
  await saveSnapshot(state.snapshot);
  renderSnapshot();
  document.querySelector("#scan-status").textContent =
    `Captured ${new Date(state.snapshot.capturedAt).toLocaleTimeString()} at ${state.snapshot.viewport.width} px`;
}

async function saveSnapshot(snapshot) {
  const data = await chrome.storage.local.get(SNAPSHOT_KEY);
  const existing = Array.isArray(data[SNAPSHOT_KEY]) ? data[SNAPSHOT_KEY] : [];
  const next = [snapshot, ...existing.filter((item) => item.url !== snapshot.url)].slice(0, 10);
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: next });
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const metrics = document.querySelector("#overview-metrics");
  metrics.replaceChildren();
  setMetric(metrics, snapshot.counts.elements, "DOM elements");
  setMetric(metrics, snapshot.colors.length, "color values");
  setMetric(metrics, snapshot.typography.length, "type combinations");
  setMetric(metrics, snapshot.assets.length, "assets");
  setMetric(metrics, snapshot.accessibility.filter((item) => item.severity === "fail").length, "contrast/a11y fails");
  setMetric(metrics, snapshot.counts.headings, "headings");

  const recent = document.querySelector("#recent-findings");
  recent.replaceChildren();
  snapshot.accessibility.slice(0, 8).forEach((finding) => {
    const row = el("div", `finding-row ${finding.severity}`);
    row.append(el("strong", "", finding.message), el("span", "", `${finding.confidence} · ${finding.selector || "document"}`));
    recent.append(row);
  });
  if (!recent.children.length) recent.append(el("p", "", "No automated findings detected."));

  renderColors();

  const type = document.querySelector("#typography-results");
  type.replaceChildren();
  snapshot.typography.forEach((item) => {
    const row = el("article", "type-card");
    const preview = el("p", "font-preview", item.sample || "The quick brown fox");
    preview.style.fontFamily = item.style.fontFamily;
    preview.style.fontSize = `${Math.max(14, Math.min(Number.parseFloat(item.style.fontSize) || 16, 44))}px`;
    preview.style.fontWeight = item.style.fontWeight;
    preview.style.lineHeight = item.style.lineHeight;
    preview.style.color = item.style.color;
    preview.style.textTransform = item.style.textTransform || "none";
    const heading = el("div", "type-card-heading");
    heading.append(
      el("strong", "", item.style.fontFamily),
      el("span", "", `${item.count} ${item.count === 1 ? "instance" : "instances"}`)
    );
    const properties = el("dl", "type-properties");
    [
      ["Font family", item.style.fontFamily],
      ["Font size", item.style.fontSize],
      ["Color", item.style.color],
      ["Line height", item.style.lineHeight],
      ["Font weight", item.style.fontWeight],
      ["Letter spacing", item.style.letterSpacing]
    ].forEach(([name, value]) => {
      properties.append(el("dt", "", name), el("dd", "", value));
    });
    const groups = { element: [], class: [], id: [] };
    (item.selectors || []).forEach((selector) => {
      const group = selector.selector.startsWith("#")
        ? "id"
        : selector.selector.includes(".") ? "class" : "element";
      groups[group].push(selector);
    });
    const selectorGroups = el("div", "selector-groups");
    Object.entries(groups).forEach(([name, selectors]) => {
      if (!selectors.length) return;
      const section = el("section", "selector-group");
      const groupLabel = { element: "Elements", class: "Classes", id: "IDs" }[name];
      section.append(el("strong", "", groupLabel));
      selectors.forEach((selector) => {
        section.append(el("span", "selector-item", `${selector.selector} · ${selector.count}`));
      });
      selectorGroups.append(section);
    });
    row.append(heading, preview, properties, selectorGroups);
    type.append(row);
  });

  const findings = document.querySelector("#a11y-results");
  findings.replaceChildren();
  snapshot.accessibility.forEach((finding) => {
    const row = el("div", `finding-row ${finding.severity}`);
    const title = el("strong", "", finding.message);
    const evidence = el("span", "", `${finding.confidence} · ${finding.selector || "document"}`);
    row.append(title, evidence);
    if (/contrast/i.test(finding.message)) {
      const passes = finding.severity !== "fail";
      const status = el("span", `contrast-chip ${passes ? "pass" : "fail"}`);
      status.append(
        contrastIcon(passes),
        document.createTextNode(passes ? "Contrast pass" : "Contrast fail")
      );
      row.append(status);
    }
    findings.append(row);
  });
  if (!findings.children.length) findings.append(el("p", "", "No automated findings detected."));

  renderAssets();
}

function colorLabel(category) {
  return ({
    text: "Text",
    background: "Background",
    border: "Borders",
    outline: "Outlines",
    accent: "Accents",
    fill: "SVG fills",
    stroke: "SVG strokes",
    shadow: "Shadows",
    gradient: "Linear gradients"
  })[category] || category;
}

function makeColorCard(color) {
  const isGradient = color.category === "gradient";
  const card = el("article", `color-card${isGradient ? " gradient-card" : ""}`);
  if (isGradient) {
    const preview = el("div", "gradient-preview");
    preview.style.backgroundImage = color.value;
    preview.setAttribute("aria-label", "Preview of extracted linear gradient");
    card.append(preview);
  } else {
    card.style.backgroundColor = color.value;
    card.style.color = contrastingText(color.value);
  }
  const content = el("div", "color-card-content");
  const meta = el("div", "color-card-meta");
  meta.append(
    el("strong", "color-code", color.value),
    el("span", "color-category", colorLabel(color.category))
  );
  const actions = el("div", "color-actions");
  actions.append(
    makeCopyButton(color.value),
    el("span", "instance-count", `${color.count} ${color.count === 1 ? "instance" : "instances"}`)
  );
  content.append(meta, actions);
  card.append(content);
  return card;
}

function renderColors() {
  const container = document.querySelector("#color-results");
  container.replaceChildren();
  container.classList.toggle("categories-mode", colorView === "categories");
  const colors = state.snapshot?.colors || [];
  if (!colors.length) {
    container.append(el("p", "empty-copy", "Scan the page to find colors."));
    return;
  }
  if (colorView === "palette") {
    colors.forEach((color) => container.append(makeColorCard(color)));
    return;
  }
  const categories = new Map();
  colors.forEach((color) => {
    if (!categories.has(color.category)) categories.set(color.category, []);
    categories.get(color.category).push(color);
  });
  categories.forEach((items, category) => {
    const group = el("section", "color-category-group");
    const heading = el("div", "category-heading");
    heading.append(
      el("h2", "", colorLabel(category)),
      el("span", "", `${items.length} ${items.length === 1 ? "color" : "colors"}`)
    );
    group.append(heading);
    items.forEach((color) => group.append(makeColorCard(color)));
    container.append(group);
  });
}

function renderAssets() {
  const assets = document.querySelector("#asset-results");
  if (!state.snapshot) {
    assets.replaceChildren(el("p", "empty-copy", "Scan the page to find assets."));
    return;
  }
  assets.replaceChildren();
  assets.classList.toggle("asset-grid", assetLayout === "tiles");
  assets.classList.toggle("asset-list", assetLayout === "list");
  const entries = state.snapshot.assets;
  const imageCount = entries.filter((asset) => asset.kind === "image").length;
  const backgroundCount = entries.filter((asset) => asset.kind === "background").length;
  const badges = document.querySelector("#asset-badges");
  badges.replaceChildren();
  badges.append(
    el("span", "count-badge", `${entries.length} total`),
    el("span", "count-badge", `${imageCount} images`),
    el("span", "count-badge", `${backgroundCount} backgrounds`)
  );
  if (!entries.length) {
    assets.append(el("p", "empty-copy", "No image assets found."));
    return;
  }
  entries.forEach((asset) => {
    const card = el("article", "asset-card");
    const preview = el("div", "asset-preview");
    const image = document.createElement("img");
    image.src = asset.url;
    image.alt = asset.alt || `${asset.kind} asset preview`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.hidden = true;
      preview.append(el("span", "asset-unavailable", "Preview unavailable"));
    }, { once: true });
    preview.append(image);
    const info = el("div", "asset-info");
    info.append(
      el("strong", "", asset.alt || asset.kind),
      el("span", "", `${asset.kind} · ${asset.naturalWidth || "?"} × ${asset.naturalHeight || "?"}`),
      el("span", "asset-url", asset.url)
    );
    const download = el("button", "icon-action");
    download.type = "button";
    download.title = "Download asset";
    download.setAttribute("aria-label", `Download ${asset.alt || asset.kind} asset`);
    download.append(downloadIcon());
    download.addEventListener("click", () => chrome.downloads.download({
      url: asset.url,
      conflictAction: "uniquify",
      saveAs: false
    }).catch((error) => console.error("[Purrfect CSS] Could not download asset.", error)));
    card.append(preview, info, download);
    assets.append(card);
  });
}

function renderSelectionColor(parent, label, value) {
  const row = el("dl", "property-list color-property");
  appendColorValue(row, label, value);
  parent.append(row);
}

function appendStyledValue(parent, value) {
  const row = el("div", "inspector-value-row");
  const wrap = el("span", "styled-value");
  const colorPattern = /rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi;
  let previousIndex = 0;
  for (const match of value.matchAll(colorPattern)) {
    const color = match[0];
    if (match.index > previousIndex) {
      wrap.append(document.createTextNode(value.slice(previousIndex, match.index)));
    }
    const swatch = el("span", "inline-swatch");
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    const token = el("span", "styled-color");
    token.append(swatch, el("span", "color-code", color));
    wrap.append(token);
    previousIndex = match.index + color.length;
  }
  if (!previousIndex) {
    wrap.textContent = value;
  } else if (previousIndex < value.length) {
    wrap.append(document.createTextNode(value.slice(previousIndex)));
  }
  row.append(wrap, makeCopyButton(value));
  parent.append(row);
}

function appendShadowList(parent, value) {
  const list = el("ul", "shadow-list");
  const layers = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth = Math.max(0, depth - 1);
    else if (value[index] === "," && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  layers.filter(Boolean).forEach((layer) => {
    const item = el("li");
    appendStyledValue(item, layer);
    list.append(item);
  });
  parent.append(list);
}

function renderSelection(element) {
  if (!element) return;
  document.querySelector("#selected-empty").hidden = true;
  const details = document.querySelector("#selected-details");
  details.hidden = false;
  details.replaceChildren();
  details.append(el("h2", "", `${element.tagName} · ${element.selector}`));
  const list = el("dl", "property-list");
  const properties = [
    ["Element", element.selector],
    ["Dimensions", `${Math.round(element.rect.width)} × ${Math.round(element.rect.height)} px`],
    ["Position", `${Math.round(element.rect.x)}, ${Math.round(element.rect.y)}`],
    ["Font", `${element.styles.fontFamily} · ${element.styles.fontSize} · ${element.styles.fontWeight}`],
    ["Line height", element.styles.lineHeight],
    ["Letter spacing", element.styles.letterSpacing],
    ["Border radius", element.styles.borderRadius],
    ["Border", element.styles.border],
    ["Box shadow", element.styles.boxShadow],
    ["Text shadow", element.styles.textShadow],
    ["Display", element.styles.display]
  ];
  properties.forEach(([name, value]) => {
    list.append(el("dt", "", name));
    const detail = el("dd");
    if (name.includes("shadow")) appendShadowList(detail, value);
    else if (name === "Border") appendStyledValue(detail, value);
    else detail.textContent = value;
    list.append(detail);
  });
  details.append(list);
  renderSelectionColor(details, "Font color", element.styles.color);
  renderSelectionColor(details, "Background", element.styles.backgroundColor);
  if (element.contrast) {
    const ratio = element.contrast.ratio;
    const gradingRatio = Number.isFinite(element.contrast.rawRatio)
      ? element.contrast.rawRatio
      : ratio;
    const contrast = el("section", "contrast-grades");
    contrast.setAttribute("role", "status");
    contrast.append(el("strong", "contrast-ratio", `Text contrast ${ratio}:1`));
    [
      { label: "Normal text", grades: [["AA", 4.5], ["AAA", 7]] },
      { label: "Large text", grades: [["AA", 3], ["AAA", 4.5]] }
    ].forEach(({ label, grades }) => {
      const row = el("div", "contrast-grade-row");
      row.append(el("strong", "contrast-grade-label", label));
      grades.forEach(([level, threshold]) => {
        row.append(contrastGrade(level, threshold, gradingRatio));
      });
      contrast.append(row);
    });
    details.append(contrast);
  }
}
async function toggleInspector() {
  const tab = await activeTab();
  await ensureContent(tab);
  const isActivating = !state.inspectorActive;
  const response = await sendBackground({
    type: "INSPECTOR_COMMAND",
    tabId: tab.id,
    payload: { type: "INSPECTOR_TOGGLE", payload: { active: isActivating } }
  });
  if (response?.active !== isActivating) {
    throw new Error("Could not update the inspector state.");
  }
  state.inspectorActive = response.active;
  const button = document.querySelector("#inspector-button");
  button.textContent = state.inspectorActive ? "Disable inspector" : "Enable inspector";
  button.classList.toggle("inspector-active", state.inspectorActive);
  const selectedDetails = document.querySelector("#selected-details");
  const selectedEmpty = document.querySelector("#selected-empty");
  if (!state.inspectorActive) {
    selectedDetails.replaceChildren();
    selectedDetails.hidden = true;
    selectedEmpty.hidden = false;
    selectedEmpty.textContent = "Inspector is off. Enable Inspector, then click an element on the page.";
    return;
  }
  if (selectedDetails.hidden) {
    selectedEmpty.hidden = false;
    selectedEmpty.textContent = "Inspector is on. Click an element on the page to inspect it.";
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message.type === "INSPECTOR_SELECTION") renderSelection(message.payload);
  return false;
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => {
      item.classList.remove("active");
      item.removeAttribute("aria-current");
    });
    tab.classList.add("active");
    tab.setAttribute("aria-current", "page");
    document.querySelectorAll(".view").forEach((view) => { view.hidden = true; });
    document.querySelector(`#${tab.dataset.view}-view`).hidden = false;
    if (tab.dataset.view === "assets") renderAssets();
  });
});

document.querySelector("#scan-button").addEventListener("click", () => {
  runScan().catch((error) => {
    document.querySelector("#scan-status").textContent = error.message;
  });
});
document.querySelector("#inspector-button").addEventListener("click", () => {
  toggleInspector().catch((error) => alert(error.message));
});
document.querySelector("#copy-palette-button").addEventListener("click", () => {
  const palette = [...new Set((state.snapshot?.colors || []).map((color) => color.value))].join("\n");
  copyText(palette, document.querySelector("#copy-palette-button"));
});
document.querySelectorAll(".color-view-button").forEach((button) => {
  button.addEventListener("click", () => {
    colorView = button.dataset.colorView;
    document.querySelectorAll(".color-view-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderColors();
  });
});
document.querySelector("#download-assets-button").addEventListener("click", async () => {
  for (const asset of state.snapshot?.assets || []) {
    if (!/^https?:/.test(asset.url)) continue;
    await chrome.downloads.download({ url: asset.url, conflictAction: "uniquify", saveAs: false })
      .catch((error) => console.error("[Purrfect CSS] Could not download asset.", error));
  }
});
document.querySelectorAll(".asset-view-button").forEach((button) => {
  button.addEventListener("click", () => {
    assetLayout = button.dataset.layout;
    document.querySelectorAll(".asset-view-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderAssets();
  });
});
document.querySelector("#export-button").addEventListener("click", () => {
  if (!state.snapshot) return;
  const blob = new Blob([JSON.stringify(state.snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "purrfect-css-design-inspection.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector("#dashboard-button").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#close-button").addEventListener("click", () => window.close());

activeTab().then((tab) => ensureContent(tab).catch(() => {})).catch(() => {});
