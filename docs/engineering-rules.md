# Engineering rules

For contributors (people and tools alike).

A desktop editor for Stellaris `.sav` files: a galaxy editor first (move
systems, add/remove hyperlanes). Rust core +
Tauri 2 shell + React/TypeScript UI with a PixiJS map. The architecture
is `docs/architecture.md`, the user guide `docs/user-guide.md`, the format
facts `docs/format-notes.md`, the
install and mod facts `docs/game-data-notes.md`, the decisions behind the
architecture `docs/adr/`, and the in-game checks a change must pass
`.github/pull_request_template.md`.

## Non-negotiables

- **The save is edited as bytes.** `sgf-core` holds the original
  `gamestate` bytes once and applies patches keyed to original offsets
  (one slot per entity). Untouched bytes are copied verbatim on save.
  Load → save with no edits is byte-identical, and a test asserts it.
  Never re-serialise the file, a section or an entity from a typed model.
- **Never rely on indentation.** The game writes keys at column 0 at any
  depth. Structure comes from brace counting; emitted text copies the
  indentation of the entity it is inserted into.
- **Every edit is an `Op` with an inverse** and a human-readable
  description. Only ops write to the overlay; the UI and CLI send ops.
- **Projections are caches.** Indexes built from the bytes at load are
  updated or invalidated by ops and never written back.
- **The game is the oracle.** Nothing about save semantics is assumed
  when it can be tested by loading the save in Stellaris: a change to
  what the game reads is not done until the checks the PR template lists
  have been run in-game (`.github/pull_request_template.md`).
- **Nothing from the game or mods is bundled.** Definitions, localisation
  and art are read from the user's install at runtime.

The open document is not watched, but Save checks it. The session notes
the file's length and modification time when it opens the file and again
after each save. If Stellaris (or anything else) has written the file
since, a save in place refuses with `changed_on_disk` and the app asks:
Overwrite saves again with `force`, and the backup-then-persist path
renames the game's version aside as the backup; Save As picks another
file; Cancel writes nothing. A save to a different path is not checked,
because the file dialog already asked about overwriting it.

## Layout

- `crates/sgf-core`: archive I/O, index scan, lexer/CST, overlay,
  emit, projections, ops, validator, session, the scenario export,
  entity addressing for the inspector, search, IPC view types.
- `crates/sgf-gamedata`: the user's install and its mods, read at
  runtime: definitions, localisation, scripts and textures.
- `crates/sgf-cli`: the `sgf` binary; also the test harness.
- `app/`: Vite + React + TypeScript; `app/src-tauri` is the Tauri crate,
  `sgf-app`.
- `app/src-tauri/tests`: the Tauri commands end to end, on a session
  opened on the sample save.
- `app/src` is split by layer: `api/`, `lib/`, `store/`, `map/`, `panels/`.
  `app/src/lib/README.md` states the import rule the layers keep and the
  exceptions to it; `app/src/panels/README.md` states which folder owns
  which slice of the UI and which stylesheet.
- `app/src/test/`: builders and stand-ins shared by the tests of every
  layer.
- `app/src/generated/`: TypeScript types exported by ts-rs. Generated:
  regenerate with `cargo test --workspace` (`sgf-core`, `sgf-gamedata` and
  `sgf-app`, via its `views.rs`, all export types); never hand-edit.
- `testdata/`: save corpus via git-lfs (`2206.11.16.sav`, Stellaris
  4.4, early game; `2201.03.25.sav`, Stellaris 4.5.0, day one, the
  player empire has Independent Map Color on; `2200.04.11.sav`,
  Stellaris 3.4.5, for lane edits on the brace shape 3.4 to 3.9
  write). Personal saves are never
  committed without asking; larger local saves are found via
  `SGF_CORPUS_DIR`. `issues.sav` and `issues.paint.txt` are built to
  raise as many findings as one file can, so every kind the Issues tab
  shows has a real example behind it; `crates/sgf-core/tests/issues.rs`
  asserts what each of them raises and how the two were made.
  `2206.11.16.scenario.txt` and `2206.11.16.paint.txt` are the 4.4
  save's galaxy exported as a plain scenario and for Paint a Galaxy.
  `paint_a_galaxy.txt` is a scenario as the Paint a Galaxy mod writes
  one, and `scenario_grammar.txt` holds every statement shape the
  scenario grammar allows.
- `docs/`: the user guide, the architecture, the save format notes, the
  game data and mod notes, the Paint a Galaxy integration notes, and the
  ADRs.
- `workshop/`: the Steam Workshop page, which carries no mod content:
  its description, preview images and inline images, and
  `workshop/uploader`, the tool that pushes them to Steam. The uploader
  is its own Cargo package, outside the workspace, so CI never builds
  it. `workshop/README.md` says how to use it.

## Commands

- `cargo test --workspace` · `cargo clippy --workspace --all-targets -- -D warnings` · `cargo fmt --all`
- `cargo run -p sgf-cli -- inspect testdata/2206.11.16.sav`
- `sgf shape <save>` prints every key path of a save with its count, and
  `sgf shape <save> --diff <other>` the paths the two do not share;
  `--section a,b` keeps either to those sections.
- `cd app && npm test` (Vitest) · `npm run build` · `npm run lint`
- `cd app && npm run tauri dev` (one instance per machine)
- `cargo test --workspace` also regenerates `app/src/generated/`; commit
  what it writes.
- `cargo test --release -p sgf-core corpus` times opening the saves in
  `SGF_CORPUS_DIR` against the budget, and round-trips the scenario
  scripts in `SGF_SCENARIO_DIR`. Both are skipped when the variable is
  unset, so run it in release after touching the load path.
- `SGF_REQUIRE_INSTALL=1` turns the tests that skip without a real
  Stellaris install into failures.
- `ci.yml` runs all of the above on Windows, Ubuntu and macOS, on every
  PR, and is also called by `release.yml` on every push to `main`. It also
  runs `bash scripts/version.sh check`. A change that touches only
  documentation (`*.md`, `docs/`, `LICENSE`, the PR template) skips the
  build; `ci-docs.yml` reports the required checks as passed for it.

## When the game updates

- Save a day-one game on the new version and run `bash
  scripts/game-update.sh <save>`. It builds `sgf`, checks the install
  parses, and checks the save loads, validates, round-trips byte for
  byte and exports, then runs the workspace tests with the install
  required.
- Read the shape diff it prints for the sections the core reads:
  `crates/sgf-core/src/keys.rs` names every key, `docs/format-notes.md`
  records the shape. The key-presence test in `keys.rs` fails naming any
  key the game no longer writes.
- A new major or minor version gets its save added to `testdata/` under
  LFS, so the tests cover it from then on.
- Run the in-game checks in `.github/pull_request_template.md`.
- Update the version claims in `README.md`, `docs/user-guide.md` and
  `docs/game-data-notes.md`.

## Releases

- `VERSION` at the repo root is the single version. `bash
  scripts/version.sh set <x.y.z>` (or `bump patch|minor|major`) writes it
  and updates the root `Cargo.toml`, `Cargo.lock`, `app/package.json` and
  `app/package-lock.json`. Never edit the version by hand in any of
  those files.
- `CHANGELOG.md` follows Keep a Changelog. Every PR adds an entry under
  `## [Unreleased]`, or carries the `skip-changelog` label; the required
  `Changelog entry` check enforces this. The changelog is for the people
  who use the editor, so an entry describes what they can now see or do.
  Tooling, tests, refactors and anything else that leaves the app
  unchanged take the label instead.
- To release: `bash scripts/version.sh bump minor` (or
  `patch`/`major`), then `bash scripts/changelog.sh release
  $(cat VERSION)`, which renames Unreleased to `## [x.y.z] - YYYY-MM-DD`
  and opens a fresh Unreleased. Review the diff, then open it as a PR.
- Merging that PR to `main` runs the checks and the three platform
  builds side by side, and only once all of them pass tags `v<x.y.z>` and
  publishes a GitHub Release whose notes are that changelog section.
  Merging anything else runs the checks and releases nothing.
- Tags are never made by hand; the `release.yml` workflow does it. To
  rebuild a release for an existing tag, use the Actions tab: the
  `Release` workflow, "Run workflow", enter the tag.
- The repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` sign the bundles for the updater.
  The public key is compiled into every build (`plugins.updater.pubkey`
  in `app/src-tauri/tauri.conf.json`), so the private key is never
  regenerated: a new key would stop every installed copy from updating.
- `createUpdaterArtifacts` lives in `app/src-tauri/tauri.release.conf.json`
  and is merged in with `--config` only by the release workflow, so a
  local `npm run tauri build` needs no key and produces no `.sig` files.
- The `publish` job writes `latest.json` from the merged assets and the
  changelog section, and the app reads it from
  `releases/latest/download/latest.json`, so a release must be the latest
  to be offered (a future prerelease would need `--latest=false`).
- Once the GitHub Release is out, run the uploader's `push` with Steam
  open (`workshop/README.md`). It posts the changelog sections since the
  last push as the Workshop change note, with any description or image
  changes.

## Testing: outside-in first

Test through the outermost boundary that exercises the behaviour, on real
data, and reach for a unit test only for logic that is particularly
complex or specific.

- **Core**: drive `sgf-core` through its public API or the `sgf` CLI on
  the corpus in `testdata/`. An op is tested by applying it to the real
  sample save and snapshotting the resulting diff (`insta`), not by
  testing its helper functions. Round-trip, index coverage, validator
  and projection counts are asserted on the whole file.
- **App**: Tauri commands are tested end-to-end against a session opened
  on the sample save; the UI through the store's public actions
  (Vitest) and, once it exists, the running app (Playwright). Do not test
  components, reducers or layers in isolation when a store-level or
  app-level test covers them. Component tests render to a string
  (`renderToStaticMarkup`, no jsdom), so a component under test must not
  need its hooks to be invoked.
- **The game**: the in-game checks in `.github/pull_request_template.md`
  are part of the test suite. A change to what the game reads is not done
  until those checks have been run in-game.
- **Unit tests are for**: the lexer/CST on the format quirks, the overlay
  (property test), `emit::coord` formatting, camera and hit-testing
  maths. If a unit test needs private internals or mocks, that is a
  sign to test one level further out instead.
- Prefer fewer, broader tests that fail loudly over many narrow ones.

### Where TDD applies

- **Bug fixes: always.** Write the test that reproduces the bug first, at
  the outermost level that shows it, and see it fail. A fix without a
  test that fails without it is not done.
- **Ops, projections and parsing rules: when the behaviour can be stated
  before the code.** Refusals, what a projection reads back, what undo
  restores and what a round-trip keeps are written as tests first. An
  op's diff snapshot can only be taken once the code produces it; read
  it before accepting it.
- **Not for layout or drawing.** Component and map tests stub text
  measurement and rendering, so they pass while a label overlaps or a
  row wraps. Nor for refactors the existing tests already cover.

### Looking at the running app

A change to what the map or panels draw is looked at in the running app
(`npm run tauri dev`) before its PR is marked ready, and the PR body says
what was looked at. Until the app has Playwright tests, this is the only
check on layout, hit areas and how a feature reads to someone using it.

## Comments

Code speaks for itself: good names, small functions, obvious control
flow. A comment is a last resort, for logic that stays surprising after
the code is as clear as it can be (a format quirk, a non-obvious
invariant, why the simple approach is wrong). Keep it to a line where
possible. Never write what the code does, how it used to work, or what
changed: that is what git history and the diff are for.

## Shell and platform

- Development machine is Windows 11. Scripts and hooks run under Git
  Bash (`bash`), not PowerShell. `cargo` and `npm` work in either.
- All text files are LF (`.gitattributes`). A CRLF script or fixture breaks.
- Run `git lfs install` once after cloning so `testdata/*.sav` resolves.
- Stellaris is wherever Steam installed it
  (`<Steam>\steamapps\common\Stellaris`); saves are in
  `%USERPROFILE%\Documents\Paradox Interactive\Stellaris\save games`.
  Never write into the save directory except through `sgf-core`'s
  backup-then-persist path.

## Format facts to keep in mind

LF, tabs, ASCII. Duplicate keys at every level, order matters.
Statements are whitespace-separated, not line-based. `hyperlane=` blocks
are omitted when empty. `length = floor(euclidean distance)`. Null id is
`4294967295`. Coordinates use up to 5 decimals with trailing zeros
stripped. Full list with examples: `docs/format-notes.md`.
