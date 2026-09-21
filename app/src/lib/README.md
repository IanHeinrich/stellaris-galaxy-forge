# `lib/`

`lib/` is what the data means: pure helpers over the generated types, names,
the game's own vocabulary and the humanisers that turn its keys into English.

- `lib/geometry/`: points, hulls, the mesh and the drawn territory: the maths,
  which knows no game vocabulary at all. `territories.ts` keeps one galaxy's
  territories between edits, `territories.worker.ts` runs it off the UI thread
  and `territoryClient.ts` is how the map talks to either.
- `lib/initializer/`: what the game's initializers are: how they group, how
  they are searched, the rows they read as and the labels the legend shows.
- `lib/details/`: one system's own detail: where its name row and plate sit
  (`layout`), the English its keys read as (`labels`), the textures and frames
  it draws with (`icons`), and its fleets and resources.
- `lib/spatialGrid.ts`: the uniform grid behind nearest-system and range
  queries: hit-testing maths, so it lives here and not in `map/`.

`lib/visual/` is how it looks: colours, fonts, textures, layer ids and badge
styles, shared by the map and the panels so both draw the same thing.

Nothing in `lib/` may import from `store/`, `map/` or `panels/`; `store/` may
not import `map/` or `panels/`; `map/` may not import `panels/`.
`eslint.config.js` enforces it, for the code that runs: a type-only import of
something declared up there is allowed, as `lib/details/labels.ts` does for
`MapTooltipText`. The one exception listed there, `lib/names.ts`, reads a store
to localise a name and is the only place in `lib/` that may.
