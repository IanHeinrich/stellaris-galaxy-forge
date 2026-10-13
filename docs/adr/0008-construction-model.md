# ADR 0008: Add what a megastructure's build leaves, from the install's scripts

Accepted

## Context

A finished megastructure in a save is the end of a build. The game places a site, and each stage's
`on_build_start` and `on_build_complete` scripts then run: they add timed modifiers and deposits to the system and
its planets, change variables on the owner, set flags, change the class or size of the planet the structure is built
at, and spawn rows and planets of their own. A row added to a save without any of that would be a structure whose
system lacks what the game gives it. Those scripts are arbitrary: scripted effects with parameters, events, scopes and
conditions. A mod can add hundreds of types (Gigastructural Engineering 3.40 adds 878), and nothing from the
game or its mods may be bundled, so per-type rules cannot be written into the editor.

## Decision

An add writes what the build chain's effects leave, read from the install's scripts when the add is built. Effects the
editor cannot place are listed, not guessed, and the game's other build effects do not run.

- A type's build chain is every stage from the first up to the type, following the first `upgrade_from` of each.
  `construction.rs` walks each stage's `on_build_start` and `on_build_complete` in turn, through the scripted effects
  they call with their parameters and the events they fire, one event deep, with the one effect walk in
  `install/walk.rs`.
- The walk keeps nine effects as `Step { on, effect, owned }`: a timed modifier added or removed, a deposit added or
  removed, an owner variable changed, a planet flag set or removed, and a planet's class or size changed. `on` is the
  system, the owner, the body the structure is built at, or every planet of the system passing a `limit`. `owned`
  marks a step that runs only when the structure has an owner. A kept effect the walk cannot place goes in
  `Unfollowed`.
- `Construction::replay` runs the steps against a `ConstructionSite`, the system as the save holds it now, which the
  core reads in `format/save/site.rs`. A guard is judged with the three values of ADR 0002. The result is a
  `MegastructureConstruction` of timed modifiers, deposits and owner variables that rides on `AddMegastructure`. An
  effect behind a guard the replay cannot judge is left out and listed as unsure. An effect that applies but that the
  editor does not write, such as a modifier the build removes or a deposit on the system, is listed as unwritten. Both
  lists reach the player, and the op's description counts them.
- A type whose build changes the class or size of its own planet, plainly and without a condition, is added with that
  change as one batch, class and size first, unless the player keeps the planet as it is. A change the walk cannot tell, such as one under a condition, refuses the type, and the
  dialog says why.
- `construction/layout.rs` reads what a finished stage spawns and removes, with the same walk. `habitat.rs` and
  `ring_world.rs` turn a layout into the planets and rows of `AddHabitat` and `AddRingWorld`. What a layout cannot lay
  out is listed.
- `dismantle.rs` reads a type's `on_dismantle_complete` as the modifiers and deposits it removes and the owner variables
  it lowers. Events are not followed and conditions are not judged, so a removal behind an `if` counts.
  `DeleteMegastructure` takes them back.
- The core only writes the payload it is given (`format/save/write/construction.rs`, `dismantle.rs`). What the install
  says stays in `sgf-gamedata`. The document keeps an added row's construction beside it, so removing the row takes
  back what the add wrote.
- The join of gamedata and session is `generate/megastructure.rs`. The shell's commands check the capability, call it
  and apply the op it returns.

## Alternatives considered

- Add the row alone. The save loads, but the system lacks the modifiers and deposits the game would have given it.
- Rules for each type in the editor. They would be wrong for each mod and stale after each patch, and ADR 0002 rules
  them out.
- Guess an effect the walk cannot place. The save then holds a state the game never produced. Listing it lets the
  player decide.

## Consequences

- An add is as faithful as the effects the walk reads. A type whose build uses an effect the walk does not keep
  is added without it, and the player is told.
- A mod's types are covered by what their scripts do, with no work per mod. A new kind of effect to keep means a new
  `Effect` and a place in the replay.
- The replay and the layout read the same scripts through one walk, so a fix to how the walk reads a scripted effect
  fixes both.
- A ring world delete clears the flags `lay_out_rings` finds for each ring. It assumes the rings were built nearest the
  star first, each on the section flags the earlier rings took. Two rings built in another order can leave a section
  flag behind when one is deleted while the other stands.
- A change to how the editor writes the start of a new game would amend this decision.
