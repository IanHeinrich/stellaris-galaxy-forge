# `lib/`

`lib/` is what the data means: pure functions over the generated types, the
game's vocabulary, and the words the app shows. A module is named for the game
concept or the screen it serves.

- `lib/geometry/`: points, meshes and the drawn territory, with no game
  vocabulary.
- `lib/brush/`: what a brush stroke does, without a canvas.
- `lib/placement/`: new systems and their lanes, shared by the paint brush and
  the Shape tool.
- `lib/initializer/`: how the game's initializers group, search and read.
- `lib/details/`: one system's and one body's detail, the system view's
  layout, and the pickers and edit adapters a body's page uses.
- `lib/visual/`: how things look, shared by the map and the panels: colours,
  fonts, textures, layer ids and badge styles.
- The root: one module per game concept (`feZone`, `marauder`, `wormholes`,
  `height` and the rest), the sentences each screen uses (`*Copy`), and the
  editor's own vocabulary (`tools`, `keys`, `capabilities`, `documentKinds`).

A rule the core owns as well, such as the L-Cluster circle, the spawn buffer
or a fallen empire zone's reach, is read from `generated/constants.ts`, which
the core's tests write.

Nothing in `lib/` may import from `store/`, `map/` or `panels/`; `store/` may
not import `map/` or `panels/`; `map/` may not import `panels/`.
`eslint.config.js` enforces it, for the code that runs: a type-only import of
something declared up there is allowed, as `lib/details/labels.ts` does for
`MapTooltipText`. The exception listed there, `lib/names.ts`, reads a store to
localise a name and is the only module in `lib/` that may. The same entry lets
`lib/`'s tests (`lib/**/*.test.ts`) import a store to set one up.
