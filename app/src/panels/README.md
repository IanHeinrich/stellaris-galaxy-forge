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
`button.link`, and `.segmented`, a row of buttons styled from `aria-pressed`,
`aria-checked` or `aria-selected`). Everything else belongs to the folder that draws it, imported
by the components that folder owns. A folder has at most one stylesheet of its
own, nested folders included. `overlays/` is the exception, with `loading.css`
beside `overlays.css`. `inspector/selection/` and `overlays/contextMenu/` have no
stylesheet, and `inspector/system/sections/` has none of its own. The
`panels/` root's own components, such as `IconPicker`, keep theirs in
`panels.css`.

## Editable fields

The inspector is the only place a value is edited. Every entity has one page
there, and a page edits only its own entity: its children are summarised
read-only and link to their own pages. List pencils open a page. A right-click
menu never changes a value a page has a field for. Paste is the exception: it
moves cut planets, and so changes the system a planet page's System field shows.

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
- Prepare for a new game, on the Galaxy page, is the exception. Its rows choose
  one batch that changes many systems at once, so the player reviews it first.
  Apply writes it as one edit, and Undo takes it back.

## The body page

`inspector/entity/BodyPage.tsx` is the one page for a planet, moon or star,
in a save and in a scenario. A `BodySource` for each kind of document
(`bodySources.ts`) reads the body and the rows the page lists, and gives
the page the adapter that edits it. The page then lists its sections in
order, in the `SECTIONS` table: deposits, modifiers, anomaly, dig site,
colony, About, moons and delete. Each section takes the same
`PlanetSectionProps`, and leaves itself out where it has nothing to show.
`planetOffers` says which edits the page offers. The deposit, modifier, anomaly
and dig site pickers are each a `PickerKind` (its store, its words and its
chips) given to one `PlanetPicker`.

`BoundsField` is a number a scenario may leave to a draw, so it edits a
`Bounds`: one field for a fixed value, or one for each end of a range.
`RadiusAngleFields` (`inspector/`) are the Radius and Angle rows of a thing
placed about a point, built on it. A page sends a geometry edit through
`useGeometryEdit` and shows the refusal beside the field.

A system's Overview is a list of sections in `inspector/system/overviewSections.ts`,
each with the capability it needs, so a kind of document shows the sections
it supports.
