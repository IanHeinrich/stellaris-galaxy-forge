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
primitives three or more panels use (`.badge`, `.swatch`, `.tri`, `.filter-input`,
`.muted`/`.hinted`/`.warn`/`.spacer`, `kbd`, `.progress-*`, `button.icon`,
`button.link`). Everything else belongs to the folder that draws it, imported
by the components that folder owns. A folder has at most one stylesheet of its
own, nested folders included. `overlays/` is the exception, with `loading.css`
beside `overlays.css`. `inspector/selection/` and `overlays/contextMenu/` have no
stylesheet, and `inspector/system/sections/` has none of its own. The
`panels/` root's own components, such as `IconPicker`, keep theirs in
`panels.css`.

## Editable fields

The inspector is the only place anything is edited. Every entity has one page
there, and a page edits only its own entity: its children are summarised
read-only and link to their own pages. Right-click menus and list pencils open
a page; they never edit.

- Every editable value uses the one field style from `EditField.tsx`: an
  outlined, lightly tinted box whose pencil, chevron or swatch always shows.
  Plain text is information.
- A page puts its editable fields first, in an `EditBlock`, then an About
  block of what it only shows.
- `LockedRow` marks a value the user would expect to edit but cannot yet. Other
  read-only values carry no mark.
- A link to another page (`LinkRow`, `DrillLink`) is underlined text, never a
  box.
- A change is one op, applied as soon as the field commits. Undo takes it back,
  so there is no Apply, Cancel or edit mode.
