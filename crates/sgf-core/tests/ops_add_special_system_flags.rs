//! A unique system added to the 4.5 sample carries the `unique_system` flag dated day one,
//! as the game writes it on its own, and the flag reads back for a removal and a reroll.

use sgf_core::ops::Op;

use crate::common;
use crate::ops_add_special_system::{add, opened, zevox};
use common::diff::{report, round_trip_step};
use common::spec::{SAMPLE_4_5, mura, rerolled};
use common::{open_4_5, text};

/// System `id`'s `galactic_object` entry as `text` holds it.
fn galactic_object(text: &str, id: u32) -> &str {
    let table = text.find("\ngalactic_object=\n{\n").expect("the systems");
    let head = format!("\n\t{id}=\n\t{{\n");
    let start = table + text[table..].find(&head).expect("the system's entry") + 1;
    let end = start + text[start..].find("\n\t}\n").expect("its end");
    &text[start..end]
}

/// The `flags` block of a `galactic_object` entry, and the line after it.
fn flags_block(entry: &str) -> (&str, &str) {
    const CLOSE: &str = "\n\t\t}\n";
    let start = entry.find("\t\tflags=\n\t\t{\n").expect("a flags block");
    let end = start + entry[start..].find(CLOSE).expect("its end") + CLOSE.len();
    let next = entry[end..].lines().next().unwrap_or_default();
    (&entry[start..end], next)
}

#[test]
fn a_unique_system_carries_its_flag_dated_day_one_as_the_games_own_do() {
    let (mut session, at, id) = opened(SAMPLE_4_5);
    let result = session.apply(add(zevox(&at))).expect("add Zevox");
    common::snapshot("add_zevox_4_5", &report(&session, &result));
    assert_eq!(session.system(id).expect("Zevox").flags, ["unique_system"]);

    let saved = text(&session);
    let game_started = saved
        .split("\n\tgame_started=")
        .nth(1)
        .and_then(|rest| rest.lines().next())
        .expect("the save's day one");
    let (added, after_added) = flags_block(galactic_object(&saved, id));
    assert_eq!(
        added,
        format!("\t\tflags=\n\t\t{{\n\t\t\tunique_system={game_started}\n\t\t}}\n")
    );
    let kira = session
        .graph()
        .systems
        .values()
        .find(|s| s.initializer == "oasis_system")
        .expect("the game's Kira");
    let (own, after_own) = flags_block(galactic_object(&saved, kira.id));
    let flag = format!("\t\t\tunique_system={game_started}\n");
    assert!(own.contains(&flag), "{own}");
    assert!(after_own.starts_with("\t\tinitializer="), "{after_own}");
    assert!(after_added.starts_with("\t\tinitializer="), "{after_added}");

    let mut session = open_4_5();
    round_trip_step(&mut session, "add", add(zevox(&at)));
    let removed = round_trip_step(&mut session, "remove", Op::RemoveSystem { system: id });
    assert_eq!(removed.inverse, add(zevox(&at)), "the flag reads back");
    session.undo().expect("undo the removal").expect("a step");
    let rolled = round_trip_step(
        &mut session,
        "reroll",
        Op::ReplaceSystemFromSpec {
            system: id,
            spec: rerolled(mura()),
        },
    );
    assert_eq!(
        rolled.inverse,
        Op::ReplaceSystemFromSpec {
            system: id,
            spec: zevox(&at),
        },
        "a reroll's undo puts the flag back"
    );
}
