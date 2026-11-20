(() => {
  "use strict";

  const listenerFlag = "__purrfectCssMessageListenerInstalled";
  const uploadedCssFlag = "__purrfectCssUploadedStylesheetEnabled";

  if (globalThis[listenerFlag]) return;
  globalThis[uploadedCssFlag] = false;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const expectedPopupUrl = chrome.runtime.getURL("popup.html");

    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== expectedPopupUrl ||
      !message ||
      typeof message.type !== "string"
    ) {
      return false;
    }

    switch (message.type) {
      case "GET_PAGE_INFO":
        sendResponse({ title: document.title, url: location.href });
        return false;

      case "GET_UPLOADED_CSS_STATE":
        sendResponse({ enabled: globalThis[uploadedCssFlag] === true });
        return false;

      case "SET_UPLOADED_CSS_STATE":
        if (typeof message.enabled !== "boolean") return false;
        globalThis[uploadedCssFlag] = message.enabled;
        sendResponse({ enabled: globalThis[uploadedCssFlag] });
        return false;

      default:
        return false;
    }
  });

  globalThis[listenerFlag] = true;
})();
