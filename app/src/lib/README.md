# `lib/`

`lib/` is what the data means: pure helpers over the generated types, names,
the game's own vocabulary and the humanisers that turn its keys into English.

- `lib/geometry/`: points, hulls, the mesh and the drawn territory: the maths,
  which knows no game vocabulary at all. `territories.ts` keeps one galaxy's
  territories between edits, `territories.worker.ts` runs it off the UI thread
  and `territoryClient.ts` is how the map talks to either. `pairs.ts` and
  `segments.ts` are id pairs and segment crossings, `symmetry.ts` a point's
  images about the centre, and `joinIslands.ts` the fewest short edges that
  join separate components.
- `lib/brush/`: what a brush stroke does, without a canvas: the four brushes
  and what Alt turns each into (`brushTools`), where painted systems land
  (`sample`, `grid`, `symmetricSpacing`), what a stroke sweeps (`stroke`,
  `sweep`, and `special` for the systems an eraser spares), the lanes it adds
  (`lanes`) and the stroke as a whole (`brushStroke`).
- `lib/initializer/`: what the game's initializers are: how they group, how
  they are searched, the rows they read as and the labels the legend shows.
- `lib/details/`: one system's own detail: where its name row and plate sit
  (`layout`), the English its keys read as (`labels`), the textures and frames
  it draws with (`icons`), and its fleets and resources. `planetPage` is one
  body's page: its deposits grouped by type, the district caps they add up to,
  and its planet and timed modifiers as rows. `starBody` says whether a body
  is a star and what a star body's type and size can change to; `starClass` is the star class pickers and the bulk plan
  that sets one class on many systems.
- `lib/spatialGrid.ts`: the uniform grid behind nearest-system and range
  queries: hit-testing maths, so it lives here and not in `map/`.
- The game's concepts, one module each and named for it: `feZone`, `feLinks`,
  `feSpawnGhosts`, `marauder`, `ownership`, `countryKinds`, `spawn`,
  `special`, `paint`, `guides`, `entities`, `resources`, `scenarioBypasses`,
  `issues`, `lgate` (the L-Gate's outcomes and the mods that touch them) and
  `addSystem` (where a system may be added, and the Special menu's marks).
- The app's words: `issueCopy`, `paintCopy` and `sessionCopy` hold the
  sentences each screen uses for one subject, and `names`, `text` and
  `version` turn keys, counts and version strings into English.
  `releaseNotes` reads a release's notes into the spans the update dialog
  shows.
- The rows a screen lists, as pure functions of what has been read:
  `openRows` for the Open screen, `browserRows` for the dock's lists.
- The editor's own vocabulary: `tools` (the rail's tools), `keys` (every key
  binding), `capabilities` (what the open document can take), `flagKey` (the
  texture key of an empire's flag), `paths` and `random` (a seeded sequence,
  and fresh seeds).
  `menuAim` keeps a submenu open while the pointer heads for it, `watchlist`
  is the pinned searches' colours, rings and labels, and `renumber` follows
  system ids and lanes through an edit that renumbers them.

`lib/visual/` is how it looks: colours, fonts, textures, layer ids and badge
styles, shared by the map and the panels so both draw the same thing.

Nothing in `lib/` may import from `store/`, `map/` or `panels/`; `store/` may
not import `map/` or `panels/`; `map/` may not import `panels/`.
`eslint.config.js` enforces it, for the code that runs: a type-only import of
something declared up there is allowed, as `lib/details/labels.ts` does for
`MapTooltipText`. The exception listed there, `lib/names.ts`, reads a store to
localise a name and is the only module in `lib/` that may. The same entry lets
`lib/`'s tests (`lib/**/*.test.ts`) import a store to set one up.
