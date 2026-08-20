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

> Optional, and requested at runtime only when the user chooses to use the
> external screen capture feature. It is not requested at install time, and the
> rest of WinTest works without granting it. When the user clicks "External
> verify", WinTest sends the URL they entered, the viewport size, zoom and pixel
> ratio of the selected layout, and that layout's label to this endpoint, which
> renders the page at that exact size and returns a PNG. If the user has
> configured an optional webhook, the webhook URL and its bearer token are also
> forwarded so the endpoint can deliver the PNG there. A randomly generated
> identifier is sent with the request for rate limiting; it contains no personal
> information and is not linked to any account.

---

## Remote code

> No. All JavaScript and CSS is bundled in the package. WinTest loads no remote
> scripts, no CDN assets, and no external fonts.

## Data usage disclosures

Check the following:

- [x] **Website content** — the URL the user chooses to preview is sent to the
      verification endpoint, and the rendered PNG of that page is returned. Only
      when the user opts in to external screen capture.
- [x] **Authentication information** — *only if the user configures the optional
      customer webhook.* The bearer token they enter is forwarded to the
      verification endpoint so it can authenticate the delivery to their own
      webhook. WinTest does not collect any credential for itself, and never
      touches passwords or cookies. If you would rather not declare this, remove
      the webhook token field from the UI before publishing.

Leave unchecked: personally identifiable information, health information,
financial information, personal communications, location, web history, user
activity.

Then certify:

- [x] Not being sold to third parties
- [x] Not being used or transferred for purposes unrelated to the item's single purpose
- [x] Not being used or transferred to determine creditworthiness or for lending
