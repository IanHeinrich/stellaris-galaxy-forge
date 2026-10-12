# Test data

The sample files the tests run on. The `.sav` files are stored with
git-lfs, so run `git lfs install` once after cloning.

## Saves

- `4.4-early.sav`: Stellaris 4.4, early game.
- `4.5-day-one.sav`: Stellaris 4.5.0, day one. The player empire has
  Independent Map Color on.
- `3.4.sav`: Stellaris 3.4.5, for lane edits on the brace shape 3.4 to
  3.9 write.
- `issues.sav` and `issues.paint.txt` are built to raise as many findings
  as one file can, so every kind the Issues tab shows has a real example
  behind it. `crates/sgf-core/tests/issues.rs` asserts what each of them
  raises and says how the two were made.

Personal saves are only committed with their owner's agreement. Larger
local saves are found through `SGF_CORPUS_DIR` (see
[docs/maintaining.md](../docs/maintaining.md)).

## Scenarios

- `4.4-early.scenario.txt` and `4.4-early.paint.txt` are the 4.4 save's
  galaxy exported as a plain scenario and for Paint a Galaxy.
- `paint_a_galaxy.txt` is a scenario as the Paint a Galaxy mod writes one.
- `scenario_grammar.txt` holds every statement shape the scenario grammar
  allows.

## Other fixtures

- `mura.json` and `dorellion.json` are add-system specs, one system each,
  that the core and CLI tests add to the sample saves.
- `orbit_rules.json` holds the system layout cases the core and the app
  both run (`crates/sgf-core/tests/orbit_rules.rs` and
  `app/src/lib/details/orbitReach.test.ts`), so the two copies of those
  rules agree.
