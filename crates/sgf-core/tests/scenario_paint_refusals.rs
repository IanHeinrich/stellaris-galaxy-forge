//! What the scripted spawn ops refuse: a seat no marker can make the player's, a bad
//! seat name or random value, and a spawn weight that holds script this editor keeps
//! byte for byte.

use sgf_core::ops::{Op, OpError, ParseAt};
use sgf_core::projections::galaxy::PaintSpawnKind;

use crate::common;
use common::batch::{spawn_scripts, spawn_weights};
use common::fixture::{GRAMMAR, PAINTED, from_scenario_text};
use common::paint::{player, reserved, script, seat, set};

/// A scenario whose one system, 7, weighs its spawn with `spawn_weight`.
fn with_spawn_weight(spawn_weight: &str) -> String {
    format!(
        "static_galaxy_scenario = {{
	name = \"modifiers\"
	system = {{
		id = \"7\"
		position = {{ x = 1 y = 2 }}
		initializer = random_empire_init_01
		spawn_weight = {spawn_weight}
	}}
}}
"
    )
}

fn bad_name(name: &str) -> String {
    format!(
        "a reserved seat is named by a letter a to z or a Greek letter alpha to omega, not {name:?}"
    )
}

#[test]
fn each_bad_seat_is_refused_and_nothing_is_written() {
    let enabled_seat = "an enabled seat has no marker to make it the player's; choose a 1st Player, Sol or reserved seat";
    let scripted = "system 1's spawn weight is script; change its spawn kind instead";
    let add = |spawn_weight, spawn_script| Op::AddSystem {
        system: None,
        x: 60.0,
        y: 10.0,
        name: Some("New Seat".to_owned()),
        initializer: None,
        spawn_weight,
        spawn_script,
    };
    let mut refusals: Vec<(Op, String)> = vec![
        (
            set(1, seat(PaintSpawnKind::Enabled, 4)),
            enabled_seat.to_owned(),
        ),
        (
            spawn_scripts(vec![
                (10, script(PaintSpawnKind::Sol, 0)),
                (1, seat(PaintSpawnKind::Enabled, 4)),
            ]),
            enabled_seat.to_owned(),
        ),
        (
            Op::SetSpawnWeight {
                system: 1,
                base: Some(1.0),
            },
            scripted.to_owned(),
        ),
        (
            spawn_weights(vec![(10, Some(1.0)), (1, Some(1.0))]),
            scripted.to_owned(),
        ),
        (
            add(Some(1.0), script(PaintSpawnKind::Enabled, 5)),
            "a system takes a spawn weight or a spawn script, not both".to_owned(),
        ),
        (add(None, script(reserved("ab"), 0)), bad_name("ab")),
    ];
    for name in [
        "", "Z", "A", "ab", "aa", "1", "|", " ", "é", "α", "Alpha", "alph", "sol",
    ] {
        refusals.push((set(10, script(reserved(name), 0)), bad_name(name)));
    }
    // No seat is drawn from more than ten values, so a random value of 37 is refused
    // rather than written beside a modulo of 10.
    for kind in [
        PaintSpawnKind::Enabled,
        PaintSpawnKind::Preferred,
        reserved("a"),
    ] {
        refusals.push((
            set(10, script(kind, 37)),
            "random value 37 is beyond the 10 a Paint a Galaxy seat is drawn from".to_owned(),
        ));
    }
    common::assert_refusals(
        &mut PAINTED.open(),
        refusals
            .iter()
            .map(|(op, message)| (op.clone(), message.as_str())),
    );
}

/// System 2 of the grammar fixture carries a `has_country_flag` modifier: script this
/// editor keeps byte for byte, so a seat is neither written over it nor cleared with it.
#[test]
fn a_block_of_modifiers_is_neither_written_over_nor_cleared() {
    let mut session = GRAMMAR.open();
    for script in [script(PaintSpawnKind::Enabled, 2), None] {
        let error = session.apply(set(2, script)).expect_err("modifiers");
        assert!(
            matches!(
                error,
                OpError::Parse {
                    at: ParseAt::System(2),
                    ..
                }
            ),
            "{error}"
        );
        assert!(
            error.to_string().contains(
                "spawn_weight carries modifiers this editor does not rewrite; edit the block by hand"
            ),
            "{error}"
        );
    }
    assert!(!session.is_dirty());
}

/// A script's own `add` is rewritten whole, but a `modifier` beside it is script this
/// editor keeps byte for byte, so the seat is neither cleared nor written over. A marker
/// of another kind's shape, or the player's marker beside a foreign modifier, is no
/// marker: the block is script and the seat reads as its kind alone. Taking the base
/// alone would leave `add` and the modifier, a block no op puts back.
#[test]
fn a_scripted_seat_with_a_modifier_beside_it_is_neither_cleared_nor_written_over() {
    let mut refused = Vec::new();
    for (spawn_weight, reads_as, rewrite) in [
        (
            "{ base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { factor = 0 has_country_flag = keep_out } }",
            script(PaintSpawnKind::Enabled, 7),
            script(PaintSpawnKind::Preferred, 1),
        ),
        (
            "{ base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 } }",
            script(PaintSpawnKind::Sol, 0),
            seat(PaintSpawnKind::Sol, 0),
        ),
        (
            "{ base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { add = 100000 } modifier = { factor = 0 has_country_flag = keep_out } }",
            script(PaintSpawnKind::Preferred, 7),
            player(7),
        ),
    ] {
        let text = with_spawn_weight(spawn_weight);
        let mut session = from_scenario_text(&text);
        assert_eq!(
            session.graph().systems[&7].spawn_script,
            reads_as,
            "{spawn_weight}"
        );
        for op in [
            set(7, None),
            set(7, rewrite),
            Op::SetSpawnWeight {
                system: 7,
                base: None,
            },
        ] {
            let name = op.name();
            let error = session.apply(op).expect_err(name);
            assert!(
                matches!(
                    error,
                    OpError::Parse {
                        at: ParseAt::System(7),
                        ..
                    }
                ),
                "{spawn_weight}: {name}: {error}"
            );
            refused.push(error.to_string());
        }
        assert_eq!(common::current(&session), text.as_bytes(), "{spawn_weight}");
    }
    common::snapshot("clear_7_modifier_refused", &refused[0]);
}

/// A plain weight beside the marker's shape is not the player's seat: without the
/// dialect's value the modifier is script this editor keeps, so the block is refused.
#[test]
fn a_plain_weight_with_the_markers_shape_is_still_a_block_of_modifiers() {
    let text = with_spawn_weight("{ base = 10 modifier = { add = 100000 } }");
    let mut session = from_scenario_text(&text);
    assert_eq!(session.graph().systems[&7].spawn_script, None);
    assert_eq!(session.graph().systems[&7].spawn_weight, Some(10.0));
    let error = session.apply(set(7, player(7))).expect_err("seat");
    assert!(
        matches!(
            error,
            OpError::Parse {
                at: ParseAt::System(7),
                ..
            }
        ),
        "{error}"
    );
    assert_eq!(common::current(&session), text.as_bytes());

    // The base alone is the editor's to clear, and the modifier stays.
    let result = session
        .apply(Op::SetSpawnWeight {
            system: 7,
            base: None,
        })
        .expect("clear the base");
    assert!(
        common::current(&session)
            .windows(b"modifier = { add = 100000 }".len())
            .any(|w| w == b"modifier = { add = 100000 }")
    );
    session.apply(result.inverse).expect("apply the inverse");
    assert_eq!(common::current(&session), text.as_bytes());
}
