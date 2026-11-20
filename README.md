# Purrfect CSS 1.1.0

Purrfect CSS is a Microsoft Edge / Chromium Manifest V3 extension for writing, uploading, saving, and managing custom CSS.

CSS is assigned to a hostname, not a tab. After applying it, Purrfect CSS keeps the stylesheet active across pages and reloads on that domain until **Remove CSS** or a delete action removes the rule.

The rule also matches subdomains, such as `www.example.com`, and CSS is reapplied during navigation.

## Project structure

```text
Purrfect_CSS_v1.1.0/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── content.js
├── background.js
├── dashboard.html
├── dashboard.css
├── dashboard.js
├── README.md
└── images/
    ├── tuxedo_cat_16.png
    ├── tuxedo_cat_48.png
    └── tuxedo_cat_128.png
```

Keep `manifest.json` at the top level of the folder you load into Edge.

## Security baseline introduced in v1.0.1

- Introduced `activeTab`, `scripting`, and `storage` access for popup-based CSS editing.
- Adds an explicit Manifest V3 extension-page CSP that permits only locally packaged scripts and objects.
- Restricts `chrome.storage.local` to trusted extension contexts.
- Validates CSS before saving it for application or injecting it.
- Blocks `@import`, `url()`, `image-set()`, and `-webkit-image-set()` constructs to reduce CSS-driven external resource requests.
- Limits editor and uploaded CSS to 256 KB.
- Checks message sender identity and requires messages to originate from this extension's popup.
- Uses `textContent` for page/status text and avoids rendering user CSS as HTML.
- Keeps detailed runtime errors in the extension developer console while showing safer messages in the popup.
- Added no remote code or analytics.

### Important CSS safety and compatibility note

Purrfect CSS is a stylesheet editor, so it applies user-supplied CSS to the active website. CSS can change page appearance and can create deceptive overlays. Some CSS constructs can also cause the browser to request external resources.

This version adopts a conservative policy and rejects parsed CSS containing `@import`, `url()`, `image-set()`, and `-webkit-image-set()`. This means CSS that loads remote images, fonts, or stylesheets will not work. The CSS is parsed using the browser's CSSOM and inspected after parsing; this is a defensive product restriction, not a claim that arbitrary CSS has been made harmless or that a general-purpose CSS sanitizer exists.

Only apply stylesheets you trust. The extension cannot guarantee that a stylesheet will not visually imitate website controls or mislead you about page content.

`chrome.storage.local` is extension-local storage, not encrypted secret storage. Do not store passwords, API keys, authentication tokens, or other secrets in CSS or extension storage.

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Temporary access to the tab when the user invokes the extension |
| `scripting` | Inject and remove CSS and load the small page helper |
| `storage` | Save stylesheets, drafts, and domain rules |
| `tabs` | Find matching open tabs and apply or remove styles during navigation |

The manifest also requests `http://*/*` and `https://*/*` host permissions so saved domain rules can persist across navigation and reloads. CSS is not applied on domains until the user assigns a stylesheet there.

No `webRequest`, `externally_connectable`, or `web_accessible_resources` declaration is used.

## Load the extension in Microsoft Edge

1. Extract the ZIP file to a normal folder.
2. Open Microsoft Edge and visit `edge://extensions`.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `Purrfect_CSS_v1.1.0` folder — the folder containing `manifest.json`.
6. Pin Purrfect CSS to the toolbar if desired.
7. Open an ordinary `http://` or `https://` website and click the extension.

For Chrome, use `chrome://extensions` and the equivalent **Developer mode** / **Load unpacked** steps.

## Use the extension

- Enter CSS in the editor and select **Apply CSS** to save it and apply it to the current domain.
- Select **Remove CSS** to remove the active rule from the current domain while keeping reusable stylesheets in the library.
- Select **Upload CSS** to validate, save, and immediately apply a `.css` file.
- Select a stylesheet in the dropdown to immediately apply it to the current domain.
- Select the X next to a stylesheet name to delete it after confirmation.
- Open the dashboard to edit, duplicate, export, search, or delete stylesheets and review domain rules.

Example:

```css
body {
  background: #f4f4f4 !important;
}

h1 {
  color: #005fb8 !important;
}
```

Reloading or opening another page on the domain keeps the assigned stylesheet active.

## Testing checklist

Before sharing or publishing, test the following in current Microsoft Edge:

1. Load the unpacked extension without manifest errors.
2. Apply a simple CSS rule on a normal HTTPS website.
3. Remove the editor CSS and verify the original appearance returns.
4. Upload a valid local CSS file and confirm it applies immediately.
5. Verify a CSS file larger than 256 KB is rejected.
6. Verify a stylesheet containing `@import` is rejected.
7. Verify a stylesheet containing `url("https://example.invalid/test.png")` is rejected.
8. Verify a stylesheet containing `image-set()` is rejected.
9. Verify `edge://extensions` and other restricted browser pages are not injectable.
10. Reload a website and confirm the domain rule remains applied.
11. Inspect the popup console for unexpected errors.
12. Confirm no network requests originate from Purrfect CSS itself during ordinary editing. The CSS restrictions are intended to prevent CSS resource URLs from being applied.

## Troubleshooting

- **The extension does not load:** Check the error on `edge://extensions`. Ensure the selected folder contains `manifest.json` directly.
- **The page is unsupported:** Browser internal pages, the Edge Add-ons store, and some protected pages do not allow extension injection. Use a regular HTTP or HTTPS website.
- **CSS is rejected:** Check for `@import`, `url()`, `image-set()`, or `-webkit-image-set()`. External CSS resources are intentionally blocked in this version.
- **CSS has no visible effect:** Check selectors and the target page's DOM. Some content is rendered inside frames or shadow roots and may require separate handling.
- **After changing extension files:** Return to `edge://extensions`, select **Reload**, then reopen the popup.

## Privacy summary

Purrfect CSS saves the editor draft, stylesheet library, and domain rules in `chrome.storage.local`. It does not include an analytics service, remote API, or account system. The CSS itself is applied locally to matching domains. Browser storage is not encrypted secret storage.

## Release notes

### Version 1.1.0

This backward-compatible feature release builds on the v1.0.1 security-hardened baseline.

- Applies saved CSS by domain across page navigation and reloads, including matching subdomains.
- Applies uploaded CSS immediately and adds a reusable stylesheet library in the popup.
- Adds a full-page dashboard for managing stylesheets, domains, and local data.
- Removes legacy registered stylesheets so **Remove CSS** can clear active styles.
- Fixes inline event-handler CSP violations in the popup.
- Adds author credit and LinkedIn/GitHub links to the dashboard footer.

### Version 1.0.1

Security-hardening update to the supplied Purrfect CSS v1.0 project. Added CSS policy checks, stylesheet size limits, trusted-context storage access, and stricter extension message validation.
