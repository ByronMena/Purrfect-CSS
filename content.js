(() => {
  "use strict";
  if (globalThis.__purrfectInspectorInstalled) return;
  globalThis.__purrfectInspectorInstalled = true;

  const state = { active: false, selected: null, counter: 0, ids: new WeakMap() };
  let box;
  let marginBox;
  let paddingBox;
  let label;

  function ensureOverlay() {
    if (box) return;
    box = document.createElement("div");
    marginBox = document.createElement("div");
    paddingBox = document.createElement("div");
    label = document.createElement("div");
    box.id = "__purrfect_inspector_box";
    const fixed = "position:fixed;pointer-events:none;z-index:2147483646;";
    box.style.cssText = fixed + "border:2px solid #005fb8;box-sizing:border-box;";
    marginBox.style.cssText = fixed + "background:rgba(177,14,30,.12);";
    paddingBox.style.cssText = fixed + "background:rgba(0,95,184,.12);";
    label.style.cssText = fixed + "width:max-content;max-width:280px;padding:5px 7px;background:#242424;color:#fff;font:12px/1.3 Segoe UI,Arial,sans-serif;";
    document.documentElement.append(box, marginBox, paddingBox, label);
    hideOverlay();
  }

  function hideOverlay() {
    [box, marginBox, paddingBox, label].forEach((node) => {
      if (!node) return;
      node.hidden = true;
      node.style.setProperty("display", "none", "important");
    });
  }

  function showOverlay() {
    [box, marginBox, paddingBox, label].forEach((node) => {
      if (!node) return;
      node.hidden = false;
      node.style.setProperty("display", "block", "important");
    });
  }

  function elementId(element) {
    if (!state.ids.has(element)) {
      state.counter += 1;
      state.ids.set(element, `el-${state.counter}`);
    }
    return state.ids.get(element);
  }

  function resolvedBackground(element) {
    let current = element;
    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
      current = current.parentElement;
    }
    return "rgb(255, 255, 255)";
  }

  function srgb(value) {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }

  function luminance(color) {
    const match = color.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const values = match[1].split(",").map((value) => parseFloat(value));
    return 0.2126 * srgb(values[0]) + 0.7152 * srgb(values[1]) + 0.0722 * srgb(values[2]);
  }

  function contrastRatio(foreground, background) {
    const first = luminance(foreground);
    const second = luminance(background);
    if (first === null || second === null) return null;
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  }

  function describeElement(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const background = resolvedBackground(element);
    const foreground = style.color;
    const ratio = contrastRatio(foreground, background);
    const fontSize = parseFloat(style.fontSize) || 0;
    const weight = parseInt(style.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const safeRect = {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left
    };
    let selector = element.tagName.toLowerCase();
    if (element.id) selector = `#${CSS.escape(element.id)}`;
    else if (element.classList.length) {
      selector += `.${Array.from(element.classList).slice(0, 3).map((name) => CSS.escape(name)).join(".")}`;
    }

    return {
      scanId: elementId(element),
      tagName: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || null,
      selector,
      rect: safeRect,
      spacing: {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft]
      },
      text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 500),
      styles: {
        display: style.display,
        position: style.position,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: foreground,
        backgroundColor: background,
        borderRadius: style.borderRadius,
        border: `${style.borderWidth} ${style.borderStyle} ${style.borderColor}`,
        boxShadow: style.boxShadow,
        textShadow: style.textShadow,
        opacity: style.opacity,
        width: style.width,
        height: style.height,
        overflow: style.overflow,
        zIndex: style.zIndex
      },
      contrast: ratio === null ? null : {
        ratio: Number(ratio.toFixed(2)),
        rawRatio: ratio,
        aa: ratio >= (large ? 3 : 4.5),
        aaa: ratio >= (large ? 4.5 : 7),
        foreground,
        background
      }
    };
  }

  function positionOverlay(element) {
    ensureOverlay();
    showOverlay();
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const mt = parseFloat(style.marginTop) || 0;
    const mr = parseFloat(style.marginRight) || 0;
    const mb = parseFloat(style.marginBottom) || 0;
    const ml = parseFloat(style.marginLeft) || 0;

    marginBox.style.left = `${rect.left - ml}px`;
    marginBox.style.top = `${rect.top - mt}px`;
    marginBox.style.width = `${rect.width + ml + mr}px`;
    marginBox.style.height = `${rect.height + mt + mb}px`;
    paddingBox.style.left = `${rect.left}px`;
    paddingBox.style.top = `${rect.top}px`;
    paddingBox.style.width = `${rect.width}px`;
    paddingBox.style.height = `${rect.height}px`;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    label.textContent = `${element.tagName.toLowerCase()} · ${Math.round(rect.width)} × ${Math.round(rect.height)} px`;
    label.style.left = `${Math.min(innerWidth - 290, Math.max(8, rect.left))}px`;
    label.style.top = `${rect.top > 30 ? rect.top - 26 : rect.bottom + 6}px`;
  }

  document.addEventListener("pointermove", (event) => {
    if (!state.active) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || element === document.documentElement || element.closest("#__purrfect_inspector_box")) return;
    positionOverlay(element);
  }, true);

  document.addEventListener("click", (event) => {
    if (!state.active) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || element.closest("#__purrfect_inspector_box")) return;
    event.preventDefault();
    event.stopPropagation();
    state.selected = element;
    positionOverlay(element);
    chrome.runtime.sendMessage({
      type: "INSPECTOR_SELECTION",
      payload: describeElement(element)
    }).catch(() => {});
  }, true);

  function normalizeUrl(raw) {
    try { return raw ? new URL(raw, location.href).href : null; }
    catch { return null; }
  }

  function scanAssets(limit) {
    const assets = [];
    for (const image of document.querySelectorAll("img")) {
      if (assets.length >= limit) break;
      const url = normalizeUrl(image.currentSrc || image.src);
      if (url) assets.push({
        id: `asset-${assets.length + 1}`,
        kind: "image",
        url,
        alt: image.alt || null,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        renderedWidth: Math.round(image.getBoundingClientRect().width),
        renderedHeight: Math.round(image.getBoundingClientRect().height)
      });
    }
    for (const element of document.querySelectorAll("*")) {
      if (assets.length >= limit) break;
      const match = getComputedStyle(element).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (!match) continue;
      const url = normalizeUrl(match[1]);
      if (url) assets.push({ id: `asset-${assets.length + 1}`, kind: "background", url });
    }
    return assets;
  }

  function scanColors(limit) {
    const counts = new Map();
    const add = (category, value) => {
      if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return;
      const key = `${category}|${value}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    const colorTokenPattern = /rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi;
    for (const element of document.querySelectorAll("body, body *")) {
      const style = getComputedStyle(element);
      for (const [category, value] of [
        ["text", style.color],
        ["background", style.backgroundColor],
        ["accent", style.accentColor]
      ]) {
        if (value.startsWith("rgb") || /^#[0-9a-f]{3,8}$/i.test(value)) add(category, value);
      }
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        const color = style[`border${side}Color`];
        if (style[`border${side}Style`] !== "none" &&
            (color.startsWith("rgb") || /^#[0-9a-f]{3,8}$/i.test(color))) {
          add("border", color);
        }
      }
      if (style.outlineStyle !== "none" &&
          (style.outlineColor.startsWith("rgb") || /^#[0-9a-f]{3,8}$/i.test(style.outlineColor))) {
        add("outline", style.outlineColor);
      }
      if (element.namespaceURI === "http://www.w3.org/2000/svg") {
        if (style.fill.startsWith("rgb") || /^#[0-9a-f]{3,8}$/i.test(style.fill)) add("fill", style.fill);
        if (style.stroke.startsWith("rgb") || /^#[0-9a-f]{3,8}$/i.test(style.stroke)) add("stroke", style.stroke);
      }
      for (const match of style.boxShadow.matchAll(colorTokenPattern)) {
        add("shadow", match[0]);
      }
      const gradientText = style.backgroundImage;
      const gradientPattern = /(?:repeating-)?linear-gradient\(/gi;
      for (const match of gradientText.matchAll(gradientPattern)) {
        let depth = 1;
        let end = match.index + match[0].length;
        while (end < gradientText.length && depth > 0) {
          if (gradientText[end] === "(") depth += 1;
          else if (gradientText[end] === ")") depth -= 1;
          end += 1;
        }
        if (depth === 0) add("gradient", gradientText.slice(match.index, end));
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => {
      const separator = key.indexOf("|");
      return { category: key.slice(0, separator), value: key.slice(separator + 1), count };
    });
  }

  function scanTypography(limit) {
    const counts = new Map();
    for (const element of document.querySelectorAll("body, body *")) {
      if (!element.textContent?.trim()) continue;
      const style = getComputedStyle(element);
      const key = JSON.stringify([
        style.fontFamily, style.fontSize, style.fontWeight,
        style.lineHeight, style.letterSpacing, style.color, style.textTransform
      ]);
      let selector = element.tagName.toLowerCase();
      if (element.id) selector = `#${CSS.escape(element.id)}`;
      else if (element.classList.length) {
        selector += `.${Array.from(element.classList).slice(0, 3).map((name) => CSS.escape(name)).join(".")}`;
      }
      if (!counts.has(key)) {
        const sample = (element.innerText || "").trim().replace(/\s+/g, " ");
        if (!sample) continue;
        counts.set(key, {
          style: {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
            color: style.color,
            textTransform: style.textTransform
          },
          count: 0,
          selectors: new Map(),
          sample: sample.slice(0, 80)
        });
      }
      counts.get(key).count += 1;
      const groups = counts.get(key).selectors;
      groups.set(selector, (groups.get(selector) || 0) + 1);
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((item) => ({
        ...item,
        selectors: Array.from(item.selectors, ([selector, count]) => ({ selector, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
      }));
  }

  function accessibilityAudit(limit) {
    const findings = [];
    const add = (severity, confidence, message, element) => {
      if (findings.length >= limit) return;
      findings.push({
        severity, confidence, message,
        scanId: element ? elementId(element) : null,
        selector: element ? describeElement(element).selector : null
      });
    };
    if (!document.documentElement.lang) add("fail", "certain", "The document does not declare a language.");
    for (const image of document.querySelectorAll("img")) {
      if (!image.hasAttribute("alt")) add("fail", "certain", "Image is missing an alt attribute.", image);
    }
    for (const control of document.querySelectorAll("button,a,input,select,textarea")) {
      const name = control.getAttribute("aria-label") || (control.textContent || "").trim() ||
        control.getAttribute("title") || (control.tagName === "INPUT" ? control.getAttribute("placeholder") : "");
      if (!name) add("fail", "likely", "Interactive control may not have an accessible name.", control);
    }
    let previous = 0;
    for (const heading of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const level = parseInt(heading.tagName.slice(1), 10);
      if (previous && level > previous + 1) add("review", "likely", `Heading skips from H${previous} to H${level}.`, heading);
      previous = level;
    }
    for (const element of document.querySelectorAll("body, body *")) {
      if (findings.length >= limit) break;
      if (!element.textContent?.trim()) continue;
      const info = describeElement(element);
      if (info.contrast && !info.contrast.aa) add("fail", "likely", `Text contrast is ${info.contrast.ratio}:1.`, element);
    }
    return findings;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message?.type) return false;
    if (message.type === "INSPECTOR_TOGGLE") {
      state.active = message.payload?.active === true;
      if (state.active) ensureOverlay();
      else {
        state.selected = null;
        hideOverlay();
      }
      sendResponse({ active: state.active });
      return true;
    }
    if (message.type === "INSPECTOR_GET_SELECTION") {
      sendResponse({ element: state.selected ? describeElement(state.selected) : null });
      return true;
    }
    if (message.type === "INSPECTOR_SCAN") {
      sendResponse({
        snapshot: {
          schemaVersion: "1",
          url: location.href,
          title: document.title,
          capturedAt: new Date().toISOString(),
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          counts: {
            elements: document.querySelectorAll("*").length,
            images: document.querySelectorAll("img").length,
            headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length
          },
          colors: scanColors(message.payload?.limit || 120),
          typography: scanTypography(message.payload?.limit || 80),
          assets: scanAssets(message.payload?.limit || 200),
          accessibility: accessibilityAudit(message.payload?.limit || 250)
        }
      });
      return true;
    }
    return false;
  });
})();
