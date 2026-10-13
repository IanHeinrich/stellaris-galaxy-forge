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
order, and the last definition of a key wins, except in the two folders the amendment below names. Localisation loads
English first and the chosen language over it, `localisation/replace/` winning over all.

Loaded this way are solar system initializers, the script index, country types, star classes, planet classes,
deposits, bypasses, starbase levels, ship sizes, sprites, colours, border defines and localisation. Definition
files are read with the core lexer's script mode: comments, `@variables` and comparison operators, the strict
save mode untouched; localisation has its own line parser, the files not being YAML. Definitions supply the
vocabulary. The rules in them are judged only where the amendment below says. The app watches the layer roots, and a
changed file rebuilds only the registry it feeds (`sgf-gamedata/src/reload.rs`). Without an install the load
fails with `NoInstall` and the app carries on showing raw keys.

## Consequences

- A modded save reads correctly with no work per mod, and a new patch needs no release.
- Opening costs a walk of the install and every mod, and the watcher holds OS watches while the app runs.
- An override, a parse failure or a missing mod becomes a diagnostic, and an undefined key shows as itself.

## Amendment (2026-10-13): first-wins folders, judged triggers and the readers

The game keeps the first definition of a repeated key in `common/scripted_variables` and
`common/solar_system_initializers`, and logs each later one as an error. Every other folder the editor reads
keeps the last. `FIRST_WINS` in `sgf-gamedata/src/install/script.rs` is the one table of those two folders. The
loaders that parse a folder through `ParsedDir` or `Variables` follow it, and a mod that sorts its override file
first, as Planetary Diversity and Gigastructural Engineering do for initializers, wins in both the game and the
editor.

A trigger block is compiled once to a `Condition` (`sgf-gamedata/src/condition.rs`) and judged against a
`Subject`, which answers the leaves it knows: the DLCs a save was played with, a body the generator has just
made, a save's planet, a scenario system's flags, an empire as a `potential` sees a player, or what an effect walk has run so far.
A judgement has three values, `Some(true)`, `Some(false)` and `None` for a condition the subject cannot answer.
`All`, `Any` and `Not` fold them as three-valued logic does: one false settles an `All`, one true settles an
`Any`, and an unknown item leaves the rest unknown. A call to a scripted trigger is judged through
`common/scripted_triggers`, and is unknown past sixteen nested calls. What `None` means is the caller's choice,
and each states it. The add-system roll takes a layout condition it cannot judge as unmet. A scenario's claims take
it as holding and mark the verdict assumed. The planet feature roll drops a feature only when its `potential`
surely fails. The add dialog judges a megastructure type's `potential` for a player and hides the type for that reason only when it surely fails. A
construction replay lists an effect behind a condition it cannot judge instead of guessing.

The registries loaded this way now also cover the megastructure types, the scripted triggers, effects, events and
on_actions, inline scripts, graphical cultures, section templates, planet modifiers, anomaly categories, colony
types, dig site types, asteroid belts, terraform links, precursor civilisations, random names, galaxy shapes and
sizes, the defines the editor reads, the flag emblems, and the model and star lighting files under `gfx/`. A
changed file rebuilds the registry of its `RegistryKind`; the kinds and what each rereads are in
`docs/game-data-notes.md`.
