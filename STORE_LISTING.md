# Chrome Web Store — Privacy practices

Copy each block into the matching field on the **Privacy practices** tab.

---

## Single purpose

WinTest lets a web developer preview a page they choose at multiple viewport
sizes and zoom levels at once, so they can check responsive layouts without
resizing windows by hand.

---

## Permission: `activeTab`

> When the user clicks "Use tab", WinTest reads the URL of the tab they are
> currently viewing so it can prefill the address to preview, saving them from
> copying and pasting it. This permission also authorises the viewport
> measurement described under "scripting", which runs only in preview windows
> WinTest itself opened, in response to the user clicking "Start test" or
> "Launch". Access is temporary and granted only by that user action. WinTest
> does not read page content, and does not use this permission on any tab the
> user has not acted on.

## Permission: `scripting`

> WinTest injects one small function into the preview windows it opens, to read
> `window.innerWidth` and `window.innerHeight`. Chrome sizes windows including
> the browser frame, so a window requested at 414x896 renders a smaller page
> area. WinTest measures the real viewport and resizes the window to compensate,
> so the preview matches the size the developer asked for. The injected function
> returns only those two numbers. It never reads page content, text, form data,
> cookies, or credentials, and it runs only in windows WinTest opened, never in
> the user's own browsing tabs.

## Permission: `storage`

> WinTest stores the IDs of the preview windows it has opened in
> `chrome.storage.session`, so that "Close all" can still find and close them
> after the popup has been closed and reopened. Chrome closes extension popups
> whenever focus moves, so this state cannot be held in the popup itself. The
> stored data is a list of window IDs and layout labels, it is cleared when the
> browser restarts, and it is never transmitted anywhere.

## Permission: `tabs`

> WinTest applies a per-tab zoom level to each preview window it opens, using
> `chrome.tabs.setZoomSettings` and `chrome.tabs.setZoom`, and waits for each
> preview to finish loading before measuring it. Per-tab zoom scope is required
> because Chrome's default zoom applies per origin, which would make every
> preview of the same site share a single zoom level. WinTest also reads the
> current tab's URL when the user clicks "Use tab", to prefill the address to
> preview.

## Host permission: `https://wintest-verifier.davidkozdra.workers.dev/*`

> Optional, and requested only when the user chooses to use the external screen
> capture feature. The user's chosen URL and viewport size are sent to this
> endpoint, which renders that page at that exact size and returns a PNG. It is
> requested at runtime, not at install, and the feature is not used unless the
> user opts in.

---

## Remote code

> No. All JavaScript and CSS is bundled in the package. WinTest loads no remote
> scripts, no CDN assets, and no external fonts.

## Data usage disclosures

Check **only** the following:

- [x] **Website content** — the URL the user chooses to preview is sent to the
      verification endpoint, but only when the user opts in to external screen
      capture.

Leave unchecked: personally identifiable information, health information,
financial information, authentication information, personal communications,
location, web history, user activity.

Then certify:

- [x] Not being sold to third parties
- [x] Not being used or transferred for purposes unrelated to the item's single purpose
- [x] Not being used or transferred to determine creditworthiness or for lending
