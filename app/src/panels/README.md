# `panels/`

One folder per slice of the UI: `browser/` (the dock's lists), `chrome/` (the
top bar, its menus, the dock frame, the status bar and the map's tool rail),
`file/` (the launch and open screens), `initializers/` (the initializer
browser), `inspector/` (the right-hand pane), `overlays/` (dialogs, the context
menu, the map tooltip) and `search/` (the palette). A file more than one
folder uses sits at the root of `panels/`.

## Stylesheets

`App.css` keeps design tokens, element resets, the app frame (`.app`, `.main`,
`.map-area`, `.map-host`, `.top-bar`, `.status-bar`, `.dock*`) and the
primitives three or more panels use (`.badge`, `.swatch`, `.tri`,
`.muted`/`.hinted`/`.warn`/`.spacer`, `kbd`, `.progress-*`, `button.icon`,
`button.link`). Everything else belongs to the folder that draws it, imported
by the components that folder owns. A folder has at most one stylesheet of its
own, nested folders included. `overlays/` is the exception, with `loading.css`
beside `overlays.css`. `inspector/selection/` and `overlays/contextMenu/` have no
stylesheet, and `inspector/system/sections/` has none of its own.
