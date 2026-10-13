# Maintaining

The runs, workflows and procedures a maintainer needs now and then. The
rules every change follows are in [engineering-rules.md](engineering-rules.md).

## Test mechanics

- The integration tests of sgf-core, sgf-gamedata and sgf-app each build
  as one binary, so their shared `tests/common` compiles once and their
  tests run in parallel. A new test file is declared in that crate's
  `tests/main.rs`, and a test there fails if one is missing.
- sgf-core's `corpus.rs` and `scenario_corpus.rs` are binaries of their
  own, so their timings run alone.
- In sgf-core, open a sample save with `common::open()`, `open_4_5()` or
  `open_3_4()`. Each reads and indexes its save once per binary and hands
  every test a copy. Call `Session::open` on a path only when the test is
  about opening, saving or reloading a file.
- In sgf-gamedata, a test that needs the real install reads
  `common::INSTALL`, which loads it once.
- Keep sgf-core's tests single-threaded, because the harness already gives
  every core a test. In sgf-gamedata, where the other tests finish early,
  splitting a slow test across threads helps.
- A test that takes more than a few seconds in a debug build gets a look
  before more cases are added to it.
- The dev profile builds dependencies with `opt-level = 2`. The tests run
  three to four times slower without it.
- `SGF_REQUIRE_INSTALL=1` turns the tests that skip without a real
  Stellaris install into failures.

## Corpus and install runs

Each of these is skipped when its variable is unset.

- `cargo test --release -p sgf-core --test corpus --test scenario_corpus
  -- --nocapture` runs both corpus binaries. `corpus` times opening the
  saves in `SGF_CORPUS_DIR` against the budget, adds a system to each 4.x
  save and removes it, and exports each save for Paint a Galaxy.
  `scenario_corpus` round-trips the scenario scripts in
  `SGF_SCENARIO_DIR`. Run them in release after touching the load path.
- `sgf gamedata --report` lists what the install and the enabled mods
  define that the editor cannot show: planet classes with no name, disc
  or `planet_size`, star classes with no map icon or with other than one
  star body, and the load's diagnostics by kind. Each row names the mod
  whose file won. `--limit N` cuts each list to N rows, and 0 prints all.
- `SGF_PLAYSET=1 cargo test -p sgf-gamedata --test integration
  playset_report::the_enabled_mods -- --nocapture` loads the enabled mods
  as the app does, prints that report and fails on a parse error or an
  unreadable file.
- `SGF_INITIALIZER_CORPUS=1 cargo test -p sgf-gamedata --release --test
  integration initializer_corpus -- --nocapture` reads the initializers of
  the install and of every installed mod, enabled or not, each mod on its
  own over the base game. It resolves every initializer as the scenario
  view does, fails on a panic, a parse error or an unreadable file, and
  prints one line per source.

## CI

- `ci.yml` runs on every PR that changes more than documentation, and
  `release.yml` calls it on every push to `main`.
- The `Lint` job runs on Ubuntu: the script tests, `bash
  scripts/version.sh check`, fmt, clippy, and the app's lint, Vitest and
  build.
- The `Test` jobs run on Windows, Ubuntu and macOS. Shard 0 of each runs
  everything except sgf-core's integration tests. The other shards run
  those, which take most of the time, split by `bash
  scripts/test-shard.sh <index> <count>`.
- Every Ubuntu `Test` job checks the diff of `app/src/generated/`, so a
  hand edit there or a missed regenerate fails.
- `Checks (<os>)` reports passed only when `Lint` and every `Test` job
  passed.
- The `Test` jobs compile through sccache. A job whose workspace library
  sources match an earlier run on `main` or on the same PR reuses those
  libraries.
- Vitest keeps its transformed modules in `app/node_modules/.vitest-cache`
  between runs, and the `Lint` job restores the cache the last run on
  `main` saved. Tests read file lists at run time through `test/files`, not
  `import.meta.glob`, because a glob expanded into a cached module goes
  stale when a file it matched moves.
- A change that touches only documentation (the list is in
  `scripts/docs-only.sh`) skips the build, and `ci-docs.yml` reports the
  required checks as passed for it. For any other change it reports
  nothing.
- `workshop/uploader` is its own Cargo package outside the workspace, so
  CI never builds it.

## When the game updates

1. Save a day-one game on the new version and run `bash
   scripts/game-update.sh <save>`. It builds `sgf`, checks the install
   parses, and checks the save loads, validates, round-trips byte for
   byte and exports. Then it runs the workspace tests with the install
   required.
2. Read the shape diff it prints for the sections the core reads.
   `crates/sgf-core/src/keys.rs` names every key and
   `docs/format-notes.md` records the shape. The key-presence test in
   `keys.rs` fails naming any key the game no longer writes.
3. Compare the start event `game_start.50` and the define
   `SPAWN_SYSTEM_BUFFER_DISTANCE` with the copies in
   `crates/sgf-core/src/format/save/write/game_tables.rs`
   (`docs/game-data-notes.md` lists what they hold). The tests don't read
   them from the install, so a change there fails nothing.
4. Add a save from a new major or minor version to `testdata/` under LFS,
   so the tests cover it from then on.
5. Run the in-game checks in `.github/pull_request_template.md`.
6. Update the version claims in `README.md`,
   `guide/reference/versions.md` and `docs/game-data-notes.md`.

## The version

`VERSION` at the repo root is the single version. Change it with `bash
scripts/version.sh set <x.y.z>` or `bump patch|minor|major`, which also
updates the root `Cargo.toml`, `Cargo.lock`, `app/package.json` and
`app/package-lock.json`. `version.sh check` in CI fails when they differ.

## The changelog

`CHANGELOG.md` follows Keep a Changelog. Every PR adds one file under
`changelog.d/` (its README says how) or takes the `skip-changelog` label,
and the required `Changelog entry` check enforces it. Separate files keep
open PRs from conflicting in `CHANGELOG.md`. An entry describes what a
player can now see or do. Tooling, tests, refactors and anything else
that leaves the app the same take the label.

The changelog uses a small subset of Markdown, because the update dialog
and the Workshop change note each parse it: `###` headings, `- ` bullets
at the start of a line, one nested level of `- ` bullets at two spaces,
and wrapped lines indented under their bullet. Inline, only `code`,
`**bold**` and `[links](url)`. Anything else shows as plain text. Both
parsers' tests read the real `CHANGELOG.md`.

## Releases

1. Bump the version: `bash scripts/version.sh bump minor` (or `patch` or
   `major`).
2. Run `bash scripts/changelog.sh collect`. It folds the `changelog.d/`
   files into `## [Unreleased]`, grouped by kind, and deletes them.
3. Rewrite the Unreleased section into the release notes: one line per
   feature, with at most one short sub-bullet. The details belong in the
   user guide.
4. Run `bash scripts/changelog.sh release $(cat VERSION)`. It collects any
   file still left and renames Unreleased to `## [x.y.z] - YYYY-MM-DD`
   with a fresh Unreleased above it.
5. Review the diff and open it as a PR.

Merging that PR to `main` runs the checks and the three platform builds
side by side. Once all of them pass, `release.yml` tags `v<x.y.z>` and
publishes a GitHub Release whose notes are that changelog section, so a
tag always has its assets. Merging anything else runs the checks and
releases nothing. To rebuild a release for an existing tag, run the
`Release` workflow from the Actions tab and enter the tag.

The user guide is then built from the new tag and published to GitHub
Pages, so the site describes the version players can download. To publish
the guide without a release, run the `Guide` workflow from the Actions
tab. Left empty, it rebuilds the latest release tag. Given `main`, it
publishes what is on `main`, which may describe unreleased features.
GitHub Pages must have "GitHub Actions" as its source.

Once the GitHub Release is out, run `cargo workshop push` with Steam open
(`workshop/README.md`). It posts the changelog sections since the last
push as the Workshop change note, with any description or image changes.

## Signing and the updater

- The repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` sign the bundles for the updater.
  The public key is compiled into every build (`plugins.updater.pubkey`
  in `app/src-tauri/tauri.conf.json`). Keep the private key, because a
  new key would stop every installed copy from updating.
- `createUpdaterArtifacts` lives in `app/src-tauri/tauri.release.conf.json`
  and only the release workflow merges it in with `--config`, so a local
  `npm run tauri build` needs no key and writes no `.sig` files.
- The `publish` job writes `latest.json` from the merged assets and the
  changelog section. The app reads it from
  `releases/latest/download/latest.json`, so a release must be the latest
  to be offered. A future prerelease would need `--latest=false`.
