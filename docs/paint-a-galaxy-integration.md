# Paint a Galaxy integration

Reference for embedding Paint a Galaxy (PaG, `oatmealproblem/paint-a-galaxy`,
MIT) inside Stellaris Galaxy Forge, and for the postMessage protocol between
the two. Audience: the Paint a Galaxy maintainer and Forge contributors.
Forge's side of the protocol lives in `app/src/lib/paint.ts` (the message
parser), `app/src/panels/file/paintMessage.ts` (the acceptance logic) and
`app/src/panels/file/PaintGalaxyPanel.tsx` (the panel).

## Protocol

Forge loads PaG in an iframe at:

```
<PaG URL>?embeddedMode=true&parentAppName=Stellaris%20Galaxy%20Forge
```

PaG is a hash router, so both query parameters must precede the `#`.
`parentAppName` is whatever the host calls itself; PaG never hardcodes a
host's name and uses the parameter for its own labels ("Send to Stellaris
Galaxy Forge").

PaG, when `embeddedMode=true`, replaces Download with "Send to
`<parentAppName>`" and posts the galaxy with
`window.parent.postMessage(message, "*")`. The target is `"*"` because
Forge's origin differs per platform (`http://tauri.localhost`,
`tauri://localhost`, `http://localhost:1420` in dev) and the message text is
not secret. External links (Community menu, the Workshop link in the Tweak
step) open in a new window (`target="_blank" rel="noopener"`) rather than
navigating the iframe.

PaG → Forge, the galaxy itself:

```json
{
  "source": "paint-a-galaxy",
  "type": "galaxy",
  "version": 1,
  "name": "<project name>",
  "txt": "<scenario text>"
}
```

`name` is optional: a missing, non-string or blank `name` is shown to the
user as "Painted galaxy".

PaG → Forge, optional, posted on load:

```json
{
  "source": "paint-a-galaxy",
  "type": "ready",
  "version": 1
}
```

Forge → PaG, posted to `iframe.contentWindow` with the PaG origin as target,
on receiving `ready`:

```json
{
  "source": "stellaris-galaxy-forge",
  "type": "ready",
  "version": 1
}
```

Forge accepts a message only when all of the following hold: `event.origin`
is the PaG origin, `event.source === iframe.contentWindow`,
`source === "paint-a-galaxy"`, `type === "galaxy"`, and `txt` is a non-empty
string. Unknown `type` values are ignored rather than treated as errors, so
new message types can be added without breaking old hosts. `version` is
carried on every message for the same reason: a host or PaG build reading an
unfamiliar version can fall back instead of failing.

## What Paint a Galaxy needs to change

1. Read `embeddedMode` and `parentAppName` from `window.location.search`
   once at startup (a constant in `src/lib/constants.ts`, or a field on the
   `Editor` in `src/lib/editor.svelte.ts`).
2. `src/routes/sidebar.svelte`, `handle_download()`: in embedded mode, post
   the `galaxy` message to `window.parent` instead of calling
   `download_blob()`. Label the button "Send to `{parentAppName}`" and
   reword the Tweak step's "follow the instructions on the Workshop"
   sentence, which currently assumes a download.
3. `src/routes/header.svelte`: the Community links and the Tweak
   description's Workshop link get `target="_blank" rel="noopener"` in
   embedded mode, or the Community menu is hidden there.
4. Optional: post the `ready` message on load; hide Export JSON and other
   file-system-only items when embedded.
5. README note: inside a host's webview, IndexedDB (`idb-keyval`) is
   partitioned from the user's ordinary browser, so projects painted inside
   the host and on the public site are separate storage. Export JSON /
   Import remain the bridge between them. The companion mod needs no
   change for any of this.

## Limitations

- WKWebView (macOS) and WebView2 (Windows) partition third-party iframe
  storage from the embedding app's own storage. A project painted inside
  Forge is not the same IndexedDB project as one painted on
  oatmealproblem.github.io in the user's regular browser, and a
  private-browsing or blocked-storage setup makes PaG show its own storage
  error inside the panel.
- Until PaG ships embedded mode, the panel shows the ordinary site and
  Download still downloads a file; Forge falls back to "Open in browser"
  plus opening a downloaded file. Forge's side can be tested against a
  local page that posts the `galaxy` message, reached by setting
  `VITE_PAINT_URL` at build time.
- Keyboard events inside the cross-origin frame never reach Forge, so Esc
  closes the panel only while focus is on the panel's own head row; the
  Close button always works.
