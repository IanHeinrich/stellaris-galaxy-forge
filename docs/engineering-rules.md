# Engineering rules

For contributors, people and tools alike.

Stellaris Galaxy Forge edits Stellaris saves and galaxy scenarios: a Rust
core, a Tauri 2 shell, and a React and TypeScript UI with a PixiJS map.
[architecture.md](architecture.md) says how it fits together and
[maintaining.md](maintaining.md) covers the corpus runs, CI, game updates
and releases. The format facts are in [format-notes.md](format-notes.md),
the install and mod facts in [game-data-notes.md](game-data-notes.md), the
decisions in [adr/](adr/), and the in-game checks in
`.github/pull_request_template.md`.

## Non-negotiables

Each rule comes with its reason, so a case it doesn't name can be judged
by the reason.

- Edit the save as bytes. `sgf-core` holds the original `gamestate` once
  and patches spans keyed to their original offsets, one slot per entity,
  and a save copies every untouched byte. A save holds mod content and
  fields the editor doesn't model, so anything re-serialised from a typed
  model loses data. A test asserts that load then save with no edits is
  byte-identical.
- Find structure by counting braces, because the game writes keys at
  column 0 at any depth. Emitted text copies the indentation of the entity
  it goes into.
- Make every edit an `Op` with an inverse and a one-sentence description.
  Only ops write to the overlay, so undo, the CLI and the app see the same
  edit. An op reads the document and its own payload, and does the same
  thing whatever the undo history holds.
- Treat projections as caches. Ops update or drop them, and nothing writes
  them back.
- Let the game decide what a save means. A change to what the game reads
  is done once the PR template's in-game checks pass.
- Leave to the game what it rebuilds or cleans up on load, because its
  values are better informed than ours. Rely on a cleanup only once a save
  the game wrote shows it complete, and record it in `format-notes.md`.
- Refuse an edit only when the save or the game would break. Players use
  the editor to make galaxies the game wouldn't make, so "the game's rules
  don't allow it" is a question for the maintainer, not a refusal.
- Read the game from the user's install. Definitions, localisation and art
  come from it at runtime, and nothing from the game or a mod is bundled.

## Where a rule lives

- Resolve in the core or gamedata, then draw. Saves and scenarios resolve
  through one layer and the UI draws what it is sent, so a pulsar looks
  the same whichever file said so. A rule the core holds reaches the app
  through a view type or `generated/constants.ts`.
- Ask the document's `Capabilities`, not its kind (ADR 0004). A third
  document kind is planned, and a test fails on a new kind check outside
  the format seam.
- Detect mod content by what its data does, in one place in sgf-gamedata.
  `AddRingWorld` reads its flags from the install's build chain, and a
  test fails on a mod's name in production code.
- When you write something like an existing writer, payload, store slice,
  hook or dialog, move the shared part into one helper and use it from
  both. Two copies of a rule start to disagree, and the next feature
  copies whichever it finds first.
- Make the wrong state unrepresentable. A choice between shapes is an
  enum, not an `Option` beside a flag, and a switch over a union is
  exhaustive.
- Derive a list that must match the code, or test it against the code. A
  `Record<Union, …>` fails to compile when the union grows, and the verb
  list below is tested against `Op`.

## Naming ops

An op is a verb and a subject, in the game's words: `MoveBody`,
`SetBeltRadius`, `RenameSystem`, `AddDeposit`. The name doesn't say which
kind of document takes it. Its row in `ops/op.rs` lists the kinds that
accept it, and the session refuses it for any other kind before the
format sees it.

- Verbs. `Set` replaces one value. `Add` and `Remove` are each other's
  inverse. `Delete` takes out something the document held when it was
  opened. `Restore` writes back whole entities an edit rewrote, and is
  only ever an inverse. `Move` sets a position, `Rotate` turns positions
  about a point and `Rename` sets a name.
  `Prevent` and `Allow` are the scenario's lane pair. `Isolate` takes
  every lane off a system, `Normalise` sets a lane length to the one the
  game writes, and `Replace` rolls an added system again.
- A subject takes the word the game or the player uses. A planet, moon or
  star in a system's list is a `Body`.
- Two kinds share an op when its payload means the same for both. When it
  differs, the name says what the payload is (`AddSystemFromSpec`).
- An id field is named for what it addresses (`system`, `body`, `country`,
  `nebula`), not `id` or `planet`. A place in a list is `index`, an
  absolute position is `at`, and radii and angles are in game units. A
  field only the inverse fills is optional, and its doc says so.
- One op does one thing, and several things as one undo step are a
  `Batch`. A plural op exists only when the group has a rule the singular
  doesn't, and its doc states that rule.
- An op that only appears as an inverse is not exported to the app, and
  the core refuses it from outside.
- The description is one past-tense sentence in the player's words. It
  names the thing as `ops::rules::named` does ("Renamed Ferragon #489 to
  Kel") and counts with `plural` ("Deleted planet #99 and its 2 moons").
- The variant's doc says what it writes, what it refuses and what its
  inverse is. A refusal uses the shared error variants (`Unchanged`,
  `Parse`, `StarRefused`) unless a caller acts on that one refusal.

## Layout

- `crates/sgf-core`: the document model, from archive I/O and the index to
  ops, projections, the session, Prepare's rows and choices (`prepare/`),
  the scenario export and the view types.
- `crates/sgf-gamedata`: the user's install and mods, read at runtime, and
  the generator that rolls what an edit adds. `construction/` reads what a
  megastructure's build leaves, `textures/model/` bakes the game's models
  into sprites, and `mod_compatibility/` is the only place that names a
  mod.
- `crates/sgf-cli`: the `sgf` binary, also a test harness for the core.
- `app/src-tauri`: the Tauri shell, `sgf-app`.
- `app/src/`: `api/` wraps the shell's commands, `lib/` says what the data
  means, `store/` holds state and sends ops, `map/` is the PixiJS
  renderer and `panels/` the UI around it. `lib/README.md` states the
  import rule between them, `panels/README.md` who owns which slice.
- `app/src/test/`: builders and stand-ins shared by the app's tests.
- `app/src/generated/`: written by `cargo test --workspace` from the Rust
  types and constants. Regenerate it and commit what it writes.
- `testdata/`: the sample saves and fixtures, listed in its README.
- `guide/`: the user guide, published with each release. The tests in
  `app/src/guide/` fail when a key, layer or issue kind is missing from it.
- `workshop/`: the Steam Workshop page and its uploader.

## Commands

- `cargo test --workspace` · `cargo clippy --workspace --all-targets -- -D warnings` · `cargo fmt --all`
- `cargo test -p <crate>` and `cargo clippy -p <crate> --all-targets -- -D warnings` for one crate.
- `cargo run -p sgf-cli -- inspect testdata/4.4-early.sav`. `sgf shape
  <save>` prints every key path with its count, `--diff <other>` the
  paths two saves don't share.
- `cd app && npm test` · `npx vitest run <files>` · `npm run build` · `npm run lint`
- `cd app && npm run tauri dev` runs the app, one instance per machine.
- `cd guide && npm run dev` serves the guide, and `npm run build` checks it
  as CI does.

## Testing

Test through the outermost boundary that shows the behaviour, on real
data. Prefer fewer, broader tests that fail loudly over many narrow ones.

- Drive `sgf-core` through its public API or the `sgf` CLI on the files in
  `testdata/`. Test an op by applying it to a sample save and
  snapshotting the diff with `insta`. Assert round-trips, index coverage,
  validator and projection counts on the whole file.
- Test a Tauri command end to end on a session opened on a sample save.
- Test the UI through the store's public actions. A component test renders
  to a string with `renderToStaticMarkup`, so it suits a component whose
  hooks never need to run.
- Keep unit tests for the lexer's format quirks, the overlay, coordinate
  formatting, and camera and hit-testing maths. A unit test that needs
  private internals or mocks belongs one level further out.

Write the test first for a bug fix, at the outermost level that shows the
bug, and see it fail. For an op, a projection or a parsing rule, write the
refusals, what undo restores and what a round-trip keeps as tests first,
and read the op's diff snapshot before accepting it. Layout and drawing
are checked by eye in the running app, because the tests stub text
measurement and rendering. The PR body says what was looked at.

A change a player can see updates its page in `guide/` in the same PR and
adds the questions a player would search for to
`guide/search/queries.json`. A new screenshot is listed in
`guide/images/SHOTS.md`, and a panel that moves or changes style gets its
shots retaken.

## Comments

Write a comment only for what stays surprising after the code is as clear
as it can be: a format quirk, an invariant, why the simple approach is
wrong. Keep it to a line where you can. The diff and the history hold what
the code used to do and what changed.

## Shell and platform

- Scripts and hooks run under Git Bash (`bash`). `cargo` and `npm` work in
  either shell.
- Text files are LF (`.gitattributes`), because a CRLF script or fixture
  breaks.
- Write into the player's save folder only through `sgf-core`'s
  backup-then-persist path, because a crash mid-write would lose a
  campaign.

## Format facts to keep in mind

LF, tabs, ASCII. Duplicate keys at every level, and order matters.
Statements are separated by whitespace, not lines. `hyperlane=` blocks
are left out when empty. `length = floor(euclidean distance)`. The null
id is `4294967295`. Coordinates use up to 5 decimals with trailing zeros
stripped. `format-notes.md` has the full list with examples.
