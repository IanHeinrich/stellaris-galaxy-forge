# ADR 0002: Read definitions from the user's install

Accepted

## Context

Editing needs the valid planet classes, star classes, deposits and the rest, with names to show for them, and
those sets change with every game version and every mod. Hand-coded enums would be wrong for a modded save on
day one and stale after each patch, and nothing from the game or its mods may be bundled with this editor.

## Decision

`sgf-gamedata` reads the user's own installation at runtime and never writes to it. It finds the game at a
path it is given, else at `steamapps/common/Stellaris` in each Steam library, and takes the enabled mods in
load order from the launcher's `dlc_load.json` under the user data directory, resolving each through its
`.mod` descriptor, then `mods_registry.json`, then each library's Workshop folder; a mod whose directory
exists nowhere is reported and skipped (`sgf-gamedata/src/install/mods.rs`).

Layers are vanilla first, then each loaded mod in load order. Within a `common/` directory a later file of the
same name replaces the earlier one, `replace_path` discards the directory below it, files parse in filename
order, and the last definition of a key wins. Localisation loads English first and the chosen language over
it, `localisation/replace/` winning over all.

Loaded this way are solar system initializers, the script index, country types, star classes, planet classes,
deposits, bypasses, starbase levels, ship sizes, sprites, colours, border defines and localisation. Definition
files are read with the core lexer's script mode: comments, `@variables` and comparison operators, the strict
save mode untouched; localisation has its own line parser, the files not being YAML. Definitions supply the
vocabulary, not the rules: `potential` triggers are not evaluated. The app watches the layer roots, and a
changed file rebuilds only the registry it feeds (`sgf-gamedata/src/reload.rs`). Without an install the load
fails with `NoInstall` and the app carries on showing raw keys.

## Consequences

- A modded save reads correctly with no work per mod, and a new patch needs no release.
- Opening costs a walk of the install and every mod, and the watcher holds OS watches while the app runs.
- An override, a parse failure or a missing mod becomes a diagnostic, and an undefined key shows as itself.
