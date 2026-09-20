# Contributing

This page covers bug reports, feature requests and pull requests. The
rules the code itself follows are in
[docs/engineering-rules.md](docs/engineering-rules.md). Read that before
changing anything under `crates/` or `app/`.

## Reporting a bug

Open an issue with:

- What you did, what you expected, and what happened instead.
- The game version (from the save row on the open screen or the status
  bar), whether the save is modded, and which release of the editor you
  are running.
- For a save that opens wrongly or saves wrongly: the `.sav` file if you
  are willing to share it, or the `gamestate` size and the section the
  error names if not. A save from a mod set is fine. The editor is meant
  to cope with content it does not understand.
- For a scenario: the `.txt` file and the mod it came from.
- For a crash or a refused save: the message the app showed, word for
  word, and the backup path it named.

If an edited save misbehaves in the game, say which edit you made and
what the game did. That is the report I most want.

## Asking for a feature

Read the Scope section of the README first. I pick up requests to show
more of a save readily. A request to edit a new kind of thing needs
three things: what the game does with it, how it can be checked in-game,
and what undo should do.

## Pull requests

1. Open an issue first for anything beyond a small fix, so the approach
   is agreed before the work.
2. Build from source as the README describes, and run the checks before
   you push:

   ```
   cargo test --workspace
   cargo clippy --workspace --all-targets -- -D warnings
   cargo fmt --all
   cd app && npm test && npm run lint && npm run build
   ```

   `cargo test --workspace` also rewrites `app/src/generated/`. Commit
   what it writes and never edit those files by hand.
3. Add an entry to `CHANGELOG.md` under `## [Unreleased]`, written for a
   user, or ask for the `skip-changelog` label if the change is invisible
   to one. The `Changelog entry` check enforces this.
4. Fill in the pull request template. If the change touches anything the
   game reads, run the in-game checks it lists and say which you ran.
5. Keep the pull request to one change. A refactor and a behaviour change
   go in separately.

Pull requests are squash-merged, so the title and description become the
commit. Write them as a sentence saying what changed and why.

## What will not be merged

- Anything that re-serialises a save, a section or an entity from a
  typed model. The file is edited as bytes. See the non-negotiables in
  the engineering rules.
- Anything that bundles game or mod content. Definitions, localisation
  and art are read from the user's install at runtime.
- Edits that cannot be undone, or that write without a backup.
- Support for one mod's private conventions, unless that mod's authors
  ask for it and it can be tested against their files.

## Licence

Contributions are accepted under the MIT licence in [LICENSE](LICENSE),
the same terms as the rest of the project.
