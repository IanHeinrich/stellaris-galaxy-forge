# Changelog fragments

Each pull request adds one file here, named for the change in kebab case,
such as `system-heights.md`.

The file holds one or more `### Added`, `### Changed`, `### Fixed` or
`### Removed` headings with `- ` bullets under them, in the same Markdown
subset as `CHANGELOG.md`. A wrapped line is indented two spaces under its
bullet, and a nested bullet is indented two spaces.

`bash scripts/changelog.sh collect` folds the files into the Unreleased
section of `CHANGELOG.md` and deletes them. `release` does the same first if
any are left. This README is never folded.
