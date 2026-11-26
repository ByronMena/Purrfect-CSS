const STYLESHEETS_KEY = "stylesheets";
const DOMAIN_RULES_KEY = "domainRules";

function scriptId(hostname) {
  return `purrfect_css_${hostname.replace(/[^a-z0-9]/gi, "_")}`;
}

function normalizeHostname(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function hostnameMatchesDomain(hostname, domain) {
  const normalizedHost = normalizeHostname(`https://${hostname}/`);
  const normalizedDomain = normalizeHostname(`https://${domain}/`);
  if (!normalizedHost || !normalizedDomain) return false;
  return normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`);
}

function findMatchingRule(hostname, rules) {
  const normalizedHost = normalizeHostname(`https://${hostname}/`);
  if (!normalizedHost) return null;

  const exact = rules[normalizedHost];
  if (exact) return { domain: normalizedHost, rule: exact };

  for (const [domain, rule] of Object.entries(rules)) {
    if (hostnameMatchesDomain(normalizedHost, domain)) {
      return { domain, rule };
    }
  }
  return null;
}

async function getData() {
  return chrome.storage.local.get([STYLESHEETS_KEY, DOMAIN_RULES_KEY]);
}

async function getStylesheets() {
  const data = await getData();
  return Array.isArray(data[STYLESHEETS_KEY]) ? data[STYLESHEETS_KEY] : [];
}

async function getDomainRules() {
  const data = await getData();
  return data[DOMAIN_RULES_KEY] && typeof data[DOMAIN_RULES_KEY] === "object"
    ? data[DOMAIN_RULES_KEY]
    : {};
}

async function removeRegisteredScript(hostname) {
  const normalizedHost = normalizeHostname(`https://${hostname}/`);
  if (!normalizedHost) return false;
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const patterns = new Set([
    `*://${normalizedHost}/*`,
    `*://*.${normalizedHost}/*`,
    `*://www.${normalizedHost}/*`,
    `*://*.www.${normalizedHost}/*`
  ]);
  const ids = registered
    .filter((script) =>
      script.id.startsWith("purrfect_css_") &&
      script.matches?.some((pattern) => patterns.has(pattern))
    )
    .map((script) => script.id);
  if (!ids.length) return false;
  await chrome.scripting.unregisterContentScripts({ ids });
  return true;
}

async function removeCssFromMatchingTabs(hostname, css) {
  if (!css) return;
  const tabs = await chrome.tabs.query({});
  const failures = [];
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const tabHostname = normalizeHostname(tab.url);
    if (!tabHostname || !hostnameMatchesDomain(tabHostname, hostname)) return;
    try {
      await chrome.scripting.removeCSS({ target: { tabId: tab.id }, css });
      tabCssCache.delete(tab.id);
    } catch (error) {
      console.warn("[Purrfect CSS] Could not remove CSS from tab.", error);
      failures.push(error);
    }
  }));
  if (failures.length) {
    throw new Error(`Could not remove CSS from ${failures.length} matching tab(s).`);
  }
}

async function matchingTabs(hostname) {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => {
    const tabHostname = normalizeHostname(tab.url);
    return Number.isInteger(tab.id) &&
      tabHostname &&
      hostnameMatchesDomain(tabHostname, hostname);
  });
}

async function reloadMatchingTabs(hostname) {
  const tabs = await matchingTabs(hostname);
  await Promise.all(tabs.map((tab) => chrome.tabs.reload(tab.id)));
}

async function applyStylesheet(hostname, stylesheetId, previousCss, tabId) {
  if (!hostname || !stylesheetId) throw new Error("Missing domain or stylesheet.");

  const stylesheets = await getStylesheets();
  const stylesheet = stylesheets.find((item) => item.id === stylesheetId);
  if (!stylesheet) throw new Error("The selected stylesheet no longer exists.");

  const rules = await getDomainRules();
  const previous = rules[hostname];
  if (previousCss) {
    await removeCssFromMatchingTabs(hostname, previousCss);
  } else if (previous?.stylesheetId) {
    const previousStylesheet = stylesheets.find((item) => item.id === previous.stylesheetId);
    await removeCssFromMatchingTabs(hostname, previousStylesheet?.css);
  }

  rules[hostname] = {
    stylesheetId,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [DOMAIN_RULES_KEY]: rules });
  const tabs = await matchingTabs(hostname);
  await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css: stylesheet.css });
      tabCssCache.set(tab.id, { hostname, css: stylesheet.css });
    } catch (error) {
      console.warn("[Purrfect CSS] Could not insert CSS in tab.", error);
    }
  }));

  return { hostname, stylesheet };
}

async function removeDomainCss(hostname, tabId) {
  const rules = await getDomainRules();
  const match = findMatchingRule(hostname, rules);
  const ruleHostname = match?.domain || hostname;
  const previous = match?.rule;
  const stylesheets = await getStylesheets();
  const stylesheet = stylesheets.find((item) => item.id === previous?.stylesheetId);

  const hadRegisteredCss = await removeRegisteredScript(ruleHostname);
  delete rules[ruleHostname];
  await chrome.storage.local.set({ [DOMAIN_RULES_KEY]: rules });
  let removeError;
  try {
    await removeCssFromMatchingTabs(ruleHostname, stylesheet?.css);
  } catch (error) {
    removeError = error;
  }
  if (hadRegisteredCss || removeError || (previous && !stylesheet)) {
    await reloadMatchingTabs(ruleHostname);
  }
  if (removeError && !hadRegisteredCss) {
    console.warn("[Purrfect CSS] Reloaded matching tabs after CSS removal failed.", removeError);
  }
  return { hostname: ruleHostname };
}

async function deleteStylesheet(stylesheetId) {
  const stylesheets = await getStylesheets();
  const stylesheet = stylesheets.find((item) => item.id === stylesheetId);
  const rules = await getDomainRules();

  const reloadDomains = new Set();
  const removalFailures = [];
  for (const [hostname, rule] of Object.entries(rules)) {
    if (rule.stylesheetId === stylesheetId) {
      const hadRegisteredCss = await removeRegisteredScript(hostname);
      if (hadRegisteredCss) reloadDomains.add(hostname);
      try {
        await removeCssFromMatchingTabs(hostname, stylesheet?.css);
      } catch (error) {
        reloadDomains.add(hostname);
        removalFailures.push(error);
      }
      delete rules[hostname];
    }
  }

  await chrome.storage.local.set({
    [STYLESHEETS_KEY]: stylesheets.filter((item) => item.id !== stylesheetId),
    [DOMAIN_RULES_KEY]: rules
  });
  await Promise.all(Array.from(reloadDomains, (hostname) => reloadMatchingTabs(hostname)));
  if (removalFailures.length) {
    console.warn("[Purrfect CSS] Reloaded matching tabs after stylesheet removal failures.", removalFailures);
  }
  return { deleted: Boolean(stylesheet) };
}

async function migrateLegacyState() {
  const data = await chrome.storage.local.get([
    "stylesheets",
    "domainRules",
    "draftCss",
    "uploadedCss"
  ]);

  let stylesheets = Array.isArray(data.stylesheets) ? data.stylesheets : [];
  let changed = false;

  if (!stylesheets.length && typeof data.uploadedCss === "string" && data.uploadedCss.trim()) {
    stylesheets.push({
      id: `uploaded-${Date.now()}`,
      name: "Uploaded CSS",
      source: "uploaded",
      css: data.uploadedCss,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    changed = true;
  }

  if (!stylesheets.length && typeof data.draftCss === "string" && data.draftCss.trim()) {
    stylesheets.push({
      id: `editor-${Date.now()}`,
      name: "Custom CSS",
      source: "editor",
      css: data.draftCss,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    changed = true;
  }

  const rules = data.domainRules && typeof data.domainRules === "object"
    ? data.domainRules
    : {};

  if (Object.keys(rules).length === 0) {
    const legacy = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(legacy)) {
      if (!key.startsWith("appliedCss:") || !value?.css || !value?.url) continue;
      const hostname = normalizeHostname(value.url);
      if (!hostname) continue;

      let stylesheet = stylesheets.find((item) => item.name === "Custom CSS");
      if (!stylesheet) {
        stylesheet = {
          id: `editor-${Date.now()}`,
          name: "Custom CSS",
          source: "editor",
          css: value.css,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        stylesheets.push(stylesheet);
      }
      rules[hostname] = {
        stylesheetId: stylesheet.id,
        updatedAt: new Date().toISOString()
      };
      changed = true;
    }
  }

  if (changed || !Array.isArray(data.stylesheets) || !data.domainRules) {
    await chrome.storage.local.set({
      stylesheets,
      domainRules: rules
    });
  }
}

async function restoreRegisteredScripts() {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const legacyScripts = registered.filter((script) =>
    script.id.startsWith("purrfect_css_")
  );
  if (!legacyScripts.length) return;

  await chrome.scripting.unregisterContentScripts({
    ids: legacyScripts.map((script) => script.id)
  });

  const domains = new Set();
  for (const script of legacyScripts) {
    for (const pattern of script.matches || []) {
      const domain = pattern
        .replace(/^\*:\/\/(?:\*\.)?/, "")
        .split("/")[0];
      if (domain && !domain.includes("*")) {
        const normalized = normalizeHostname(`https://${domain}/`);
        if (normalized) domains.add(normalized);
      }
    }
  }
  await Promise.all(Array.from(domains, (hostname) => reloadMatchingTabs(hostname)));
}

const tabCssCache = new Map();

async function syncTabCss(tab) {
  if (!Number.isInteger(tab?.id)) return;
  const hostname = normalizeHostname(tab.url);
  const previous = tabCssCache.get(tab.id);

  if (!hostname) {
    if (previous?.css) {
      try {
        await chrome.scripting.removeCSS({
          target: { tabId: tab.id },
          css: previous.css
        });
      } catch (error) {
        console.warn("[Purrfect CSS] Could not clear CSS for unsupported page.", error);
      }
    }
    tabCssCache.delete(tab.id);
    return;
  }

  const rules = await getDomainRules();
  const match = findMatchingRule(hostname, rules);
  if (!match) {
    if (previous?.css) {
      try {
        await chrome.scripting.removeCSS({
          target: { tabId: tab.id },
          css: previous.css
        });
      } catch (error) {
        console.warn("[Purrfect CSS] Could not clear inactive domain CSS.", error);
      }
    }
    tabCssCache.delete(tab.id);
    return;
  }

  const stylesheets = await getStylesheets();
  const stylesheet = stylesheets.find((item) => item.id === match.rule.stylesheetId);
  if (!stylesheet) {
    tabCssCache.delete(tab.id);
    return;
  }

  if (previous?.css === stylesheet.css) return;
  if (previous?.css) {
    try {
      await chrome.scripting.removeCSS({
        target: { tabId: tab.id },
        css: previous.css
      });
    } catch (error) {
      console.warn("[Purrfect CSS] Could not replace previous domain CSS.", error);
    }
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      css: stylesheet.css
    });
    tabCssCache.set(tab.id, { hostname, css: stylesheet.css });
  } catch (error) {
    console.warn("[Purrfect CSS] Could not apply CSS during navigation.", error);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    syncTabCss(tab).catch(console.error);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(syncTabCss).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCssCache.delete(tabId);
});

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => syncTabCss(tab)));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    !message ||
    typeof message.type !== "string"
  ) return false;

  (async () => {
    switch (message.type) {
      case "INSPECTOR_ENSURE_CONTENT":
        if (!Number.isInteger(message.tabId)) throw new Error("A valid tab is required.");
        await chrome.scripting.executeScript({
          target: { tabId: message.tabId, allFrames: false },
          files: ["content.js"]
        });
        sendResponse({ ready: true });
        break;
      case "INSPECTOR_COMMAND":
        if (!Number.isInteger(message.tabId)) throw new Error("A valid tab is required.");
        sendResponse(await chrome.tabs.sendMessage(message.tabId, message.payload));
        break;
      case "INSPECTOR_GET_SELECTION":
        if (!Number.isInteger(message.tabId)) throw new Error("A valid tab is required.");
        sendResponse(await chrome.tabs.sendMessage(message.tabId, {
          type: "INSPECTOR_GET_SELECTION"
        }));
        break;
      case "INSPECTOR_SCAN":
        if (!Number.isInteger(message.tabId)) throw new Error("A valid tab is required.");
        sendResponse(await chrome.tabs.sendMessage(message.tabId, {
          type: "INSPECTOR_SCAN",
          payload: message.payload || {}
        }));
        break;
      case "APPLY_STYLESHEET":
        sendResponse(await applyStylesheet(
          message.hostname,
          message.stylesheetId,
          message.previousCss,
          message.tabId
        ));
        break;
      case "REMOVE_DOMAIN_CSS":
        sendResponse(await removeDomainCss(message.hostname, message.tabId));
        break;
      case "DELETE_STYLESHEET":
        sendResponse(await deleteStylesheet(message.stylesheetId));
        break;
      default:
        sendResponse({ error: "Unknown request." });
    }
  })().catch((error) => sendResponse({ error: error.message || "The operation failed." }));

  return true;
});

migrateLegacyState()
  .then(restoreRegisteredScripts)
  .then(syncAllTabs)
  .catch(console.error);
