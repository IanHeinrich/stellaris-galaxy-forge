//! The ruins, ambient objects and modifiers a scenario system's `effect` block places: what
//! each op writes into the block, the statements it leaves where they stand, the block it
//! makes and takes away, the ids it keeps, and what it refuses.
use sgf_core::format::scenario::placed::{STAR_BODY, ambient_object_id, ruin_id};
use sgf_core::ops::{
    MegastructureConstruction, MegastructurePlace, NewBypass, NewMegastructure,
    NewMegastructurePlace, NewPlanet, Op, OpError,
};
use sgf_core::projections::name::NameTemplate;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot};
use common::fixture::{THREE_EACH, from_scenario_text};

/// Kel's one-line block holds a flag, a ruin at a point, an ambient object, a ruin with an
/// owner the editor does not write and a modifier. Ora has no block. Vel writes its
/// statements on lines of their own. Tal's block holds only a modifier, and Ren holds two
/// blocks, of which the game runs the last.
const PLACING: &str = "static_galaxy_scenario = {
	name = \"placing\"
	system = { id = \"1\" name = \"Kel\" position = { x = 0 y = 0 } effect = { set_star_flag = kept spawn_megastructure = { type = \"gateway_ruined\" orbit_distance = 100 orbit_angle = 0 random_pos = no } create_ambient_object = { type = \"derelict_ship_object\" location = this } last_created_ambient_object = { set_location = { target = prev distance = 30 angle = 90 } } spawn_megastructure = { type = \"dyson_sphere_ruined\" planet = star owner = root } add_modifier = { modifier = \"pulsar_radiation\" days = -1 } } }
	system = { id = \"2\" name = \"Ora\" position = { x = 30 y = 40 } }
	system = {
		id = \"3\"
		name = \"Vel\"
		position = { x = 50 y = 60 }
		effect = {
			set_star_flag = kept
		}
	}
	system = { id = \"4\" name = \"Tal\" position = { x = -30 y = 40 } effect = { add_modifier = { modifier = \"nebula_storm\" days = -1 } } }
	system = { id = \"5\" name = \"Ren\" position = { x = -50 y = -60 } effect = { set_star_flag = shadowed } effect = { add_modifier = { modifier = \"nebula_storm\" days = -1 } } }
}
";

fn placing() -> Session {
    from_scenario_text(PLACING)
}

fn ruin(system: u32, n: usize) -> u32 {
    ruin_id(system, n).expect("an id")
}

fn ambient_object(system: u32, n: usize) -> u32 {
    ambient_object_id(system, n).expect("an id")
}

fn add_ruin(system: u32, at: NewMegastructurePlace) -> Op {
    Op::AddMegastructure {
        system,
        spec: NewMegastructure {
            kind: "gateway_ruined".to_owned(),
            at,
            ..NewMegastructure::default()
        },
    }
}

fn on_star() -> NewMegastructurePlace {
    MegastructurePlace::Body { body: STAR_BODY }.into()
}

fn free(x: f64, y: f64) -> NewMegastructurePlace {
    NewMegastructurePlace::Free { x, y }
}

/// The planet a megastructure of the save examples spawns round its body.
fn shipyard_planet() -> Option<NewPlanet> {
    let Op::AddMegastructure { spec, .. } = common::examples::sol_shipyard() else {
        unreachable!("an add");
    };
    spec.planet
}

fn refusal(op: Op) -> OpError {
    let mut session = placing();
    let refused = session.apply(op).expect_err("refused");
    assert!(
        common::holds(&session, PLACING.as_bytes()),
        "a refusal writes nothing"
    );
    refused
}

#[test]
fn a_ruin_at_a_point_gives_a_system_with_no_block_one() {
    snapshot("ruin_at_a_point", placing(), add_ruin(2, free(-100.0, 0.0)));
    round_trip(placing(), add_ruin(2, free(-100.0, 0.0)));
}

#[test]
fn a_ruin_on_the_star_goes_last_in_a_block_on_lines_of_its_own() {
    snapshot("ruin_on_the_star", placing(), add_ruin(3, on_star()));
    round_trip(placing(), add_ruin(3, on_star()));
}

#[test]
fn a_ruin_at_a_point_moves_where_it_stands() {
    let op = Op::MoveMegastructure {
        megastructure: ruin(1, 0),
        at: MegastructurePlace::Free { x: 0.0, y: 120.0 },
    };
    snapshot("move_ruin", placing(), op.clone());
    round_trip(placing(), op);
}

#[test]
fn a_ruin_comes_out_and_the_statements_beside_it_stay() {
    let op = Op::RemoveMegastructure {
        megastructure: ruin(1, 0),
        construction: None,
        left_out: 0,
    };
    snapshot("remove_ruin", placing(), op.clone());
    round_trip(placing(), op);
}

#[test]
fn an_ambient_object_goes_in_as_two_lines_and_moves_and_comes_out() {
    let add = Op::AddAmbientObject {
        system: 3,
        kind: "derelict_ship_object".to_owned(),
        x: 0.0,
        y: 25.0,
    };
    snapshot("add_ambient_object", placing(), add.clone());
    round_trip(placing(), add);
    let moved = Op::MoveAmbientObject {
        ambient_object: ambient_object(1, 0),
        x: -40.0,
        y: 0.0,
    };
    snapshot("move_ambient_object", placing(), moved.clone());
    round_trip(placing(), moved);
    let removed = Op::RemoveAmbientObject {
        ambient_object: ambient_object(1, 0),
    };
    snapshot("remove_ambient_object", placing(), removed.clone());
    round_trip(placing(), removed);
}

#[test]
fn a_modifier_goes_in_and_its_block_goes_with_the_last_statement() {
    let add = Op::AddSystemModifier {
        system: 2,
        modifier: "pulsar_radiation".to_owned(),
    };
    snapshot("add_modifier", placing(), add.clone());
    round_trip(placing(), add);
    let removed = Op::RemoveSystemModifier {
        system: 4,
        modifier: "nebula_storm".to_owned(),
    };
    snapshot("remove_last_modifier", placing(), removed.clone());
    round_trip(placing(), removed);
}

/// Taking the block away would leave the earlier one for the game to run.
#[test]
fn an_emptied_block_stays_when_an_earlier_one_would_run_in_its_place() {
    let mut session = placing();
    session
        .apply(Op::RemoveSystemModifier {
            system: 5,
            modifier: "nebula_storm".to_owned(),
        })
        .expect("remove");
    assert!(
        common::text(&session).contains("effect = { set_star_flag = shadowed } effect = { } }",),
        "{}",
        common::text(&session)
    );
}

/// Placed at 100 out at editor angle 180, a ruin is written at the game's angle 0; an ambient
/// object straight above its star, at editor angle 90, at the game's 270.
#[test]
fn points_are_written_at_the_games_angle() {
    let mut session = placing();
    session
        .apply(add_ruin(2, free(-100.0, 0.0)))
        .expect("add the ruin");
    session
        .apply(Op::AddAmbientObject {
            system: 2,
            kind: "derelict_ship_object".to_owned(),
            x: 0.0,
            y: 25.0,
        })
        .expect("add the ambient object");
    let text = common::text(&session);
    assert!(
        text.contains("orbit_distance = 100 orbit_angle = 0 random_pos = no"),
        "{text}"
    );
    assert!(text.contains("distance = 25 angle = 270"), "{text}");
}

#[test]
fn an_id_holds_across_an_add_and_a_move_and_one_taken_out_moves_the_next_down() {
    let mut session = placing();
    let held = ruin(1, 0);
    let added = session.apply(add_ruin(1, free(0.0, 50.0))).expect("add");
    assert_eq!(
        added.inverse,
        Op::RemoveMegastructure {
            megastructure: ruin(1, 2),
            construction: None,
            left_out: 0,
        },
        "the third ruin of the block"
    );
    session
        .apply(Op::MoveMegastructure {
            megastructure: held,
            at: MegastructurePlace::Free { x: 10.0, y: 0.0 },
        })
        .expect("the held ruin keeps its id");
    session
        .apply(Op::RemoveMegastructure {
            megastructure: held,
            construction: None,
            left_out: 0,
        })
        .expect("remove");
    session
        .apply(Op::MoveMegastructure {
            megastructure: ruin(1, 1),
            at: MegastructurePlace::Free { x: 20.0, y: 0.0 },
        })
        .expect("the added ruin is the second now");
}

#[test]
fn an_add_refuses_what_a_scenarios_ruin_cannot_carry() {
    let with = |spec: NewMegastructure| Op::AddMegastructure {
        system: 2,
        spec: NewMegastructure {
            kind: "gateway_ruined".to_owned(),
            at: free(10.0, 0.0),
            ..spec
        },
    };
    let refused = [
        with(NewMegastructure {
            owner: Some(1),
            ..NewMegastructure::default()
        }),
        with(NewMegastructure {
            culture: Some("mammalian_01".to_owned()),
            ..NewMegastructure::default()
        }),
        with(NewMegastructure {
            bypass: Some(NewBypass {
                kind: "gateway".to_owned(),
                active: true,
            }),
            ..NewMegastructure::default()
        }),
        with(NewMegastructure {
            construction: Some(MegastructureConstruction::default()),
            ..NewMegastructure::default()
        }),
        with(NewMegastructure {
            planet: shipyard_planet(),
            ..NewMegastructure::default()
        }),
        with(NewMegastructure {
            name: Some(NameTemplate::plain("Ruin")),
            ..NewMegastructure::default()
        }),
        add_ruin(
            2,
            NewMegastructurePlace::Body {
                body: STAR_BODY,
                body_flags: vec!["has_megastructure".to_owned()],
                star_only: false,
            },
        ),
        add_ruin(2, MegastructurePlace::Body { body: 7 }.into()),
        add_ruin(
            2,
            MegastructurePlace::Beside {
                body: STAR_BODY,
                x: 5.0,
                y: 5.0,
            }
            .into(),
        ),
    ];
    for op in refused {
        let error = refusal(op.clone());
        assert!(
            matches!(error, OpError::MegastructureRefused { .. }),
            "{op:?}: {error}"
        );
    }
    let second = refusal(add_ruin(1, on_star()));
    assert!(
        matches!(second, OpError::MegastructureRefused { .. }),
        "the star holds a ruin already, though not one the editor writes: {second}"
    );
    assert!(matches!(
        refusal(add_ruin(2, free(f64::NAN, 0.0))),
        OpError::NotFinite
    ));
    assert!(matches!(
        refusal(add_ruin(99, free(1.0, 0.0))),
        OpError::UnknownSystem(99)
    ));
}

/// The spawn naming an owner is no shape the editor writes: it stays as written.
#[test]
fn a_ruin_the_editor_does_not_write_is_neither_moved_nor_removed() {
    let owned = ruin(1, 1);
    for op in [
        Op::MoveMegastructure {
            megastructure: owned,
            at: MegastructurePlace::Body { body: STAR_BODY },
        },
        Op::RemoveMegastructure {
            megastructure: owned,
            construction: None,
            left_out: 0,
        },
    ] {
        let error = refusal(op.clone());
        assert!(
            matches!(error, OpError::MegastructureKept { .. }),
            "{op:?}: {error}"
        );
    }
}

#[test]
fn a_move_and_a_removal_refuse_what_does_not_fit() {
    let held = ruin(1, 0);
    let cases = [
        Op::MoveMegastructure {
            megastructure: held,
            at: MegastructurePlace::Body { body: STAR_BODY },
        },
        Op::RemoveMegastructure {
            megastructure: held,
            construction: Some(MegastructureConstruction::default()),
            left_out: 0,
        },
    ];
    for op in cases {
        let error = refusal(op.clone());
        assert!(
            matches!(error, OpError::MegastructureKept { .. }),
            "{op:?}: {error}"
        );
    }
    let same = refusal(Op::MoveMegastructure {
        megastructure: held,
        at: MegastructurePlace::Free { x: -100.0, y: 0.0 },
    });
    assert!(matches!(same, OpError::Unchanged { .. }), "{same}");
    let unknown = refusal(Op::MoveMegastructure {
        megastructure: ruin(1, 5),
        at: MegastructurePlace::Free { x: 1.0, y: 0.0 },
    });
    assert!(
        matches!(unknown, OpError::UnknownEntity { .. }),
        "{unknown}"
    );
}

#[test]
fn ambient_object_ops_refuse_what_does_not_fit() {
    let foreign = "static_galaxy_scenario = {
	system = { id = \"1\" name = \"Kel\" position = { x = 0 y = 0 } effect = { create_ambient_object = { type = \"derelict_ship_object\" location = this } } }
}
";
    let mut session = from_scenario_text(foreign);
    let bare = session.apply(Op::MoveAmbientObject {
        ambient_object: ambient_object(1, 0),
        x: 10.0,
        y: 0.0,
    });
    assert!(
        matches!(bare, Err(OpError::Unchanged { .. })),
        "one the game places where it picks stays as written: {bare:?}"
    );
    assert!(matches!(
        refusal(Op::RemoveAmbientObject {
            ambient_object: ambient_object(2, 0),
        }),
        OpError::UnknownAmbientObject(_)
    ));
    assert!(matches!(
        refusal(Op::AddAmbientObject {
            system: 2,
            kind: "bad type".to_owned(),
            x: 1.0,
            y: 1.0,
        }),
        OpError::InvalidText { .. }
    ));
    assert!(matches!(
        refusal(Op::MoveAmbientObject {
            ambient_object: ambient_object(1, 0),
            x: 0.0,
            y: -30.0,
        }),
        OpError::Unchanged { .. }
    ));
}

#[test]
fn modifier_ops_refuse_what_does_not_fit() {
    let timed = "static_galaxy_scenario = {
	system = { id = \"1\" name = \"Kel\" position = { x = 0 y = 0 } effect = { add_modifier = { modifier = \"nebula_storm\" days = 30 } } }
}
";
    let mut session = from_scenario_text(timed);
    let kept = session.apply(Op::RemoveSystemModifier {
        system: 1,
        modifier: "nebula_storm".to_owned(),
    });
    assert!(matches!(kept, Err(OpError::Unchanged { .. })), "{kept:?}");
    for op in [
        Op::AddSystemModifier {
            system: 1,
            modifier: "pulsar_radiation".to_owned(),
        },
        Op::RemoveSystemModifier {
            system: 2,
            modifier: "pulsar_radiation".to_owned(),
        },
    ] {
        let error = refusal(op.clone());
        assert!(
            matches!(error, OpError::Unchanged { .. }),
            "{op:?}: {error}"
        );
    }
}

/// Taking out the first of three puts it back where it stood, so the ids read from the
/// places come back too: a redo, through the history or as the inverse's inverse, takes out
/// the same one again.
#[test]
fn a_removal_undone_and_redone_takes_out_the_same_one() {
    for op in [
        Op::RemoveMegastructure {
            megastructure: ruin(1, 0),
            construction: None,
            left_out: 0,
        },
        Op::RemoveAmbientObject {
            ambient_object: ambient_object(1, 0),
        },
    ] {
        let mut session = from_scenario_text(THREE_EACH);
        let removed = session.apply(op.clone()).expect("remove");
        let after = common::current(&session);
        session.undo().expect("undo").expect("an op to undo");
        assert!(
            common::holds(&session, THREE_EACH.as_bytes()),
            "{op:?}: undo"
        );
        session.redo().expect("redo").expect("an op to redo");
        assert!(common::holds(&session, &after), "{op:?}: redo");

        let mut session = from_scenario_text(THREE_EACH);
        session.apply(op.clone()).expect("remove");
        let back = session.apply_inverse(removed.inverse).expect("the inverse");
        assert!(
            common::holds(&session, THREE_EACH.as_bytes()),
            "{op:?}: the inverse puts it back where it stood"
        );
        session
            .apply_inverse(back.inverse)
            .expect("the inverse's inverse");
        assert!(
            common::holds(&session, &after),
            "{op:?}: the inverse's inverse"
        );
    }
}

/// Quotes and how a number is spelled make no difference to whether the editor edits a
/// statement; a key it does not write does.
#[test]
fn a_ruin_is_editable_however_its_type_is_quoted_and_its_numbers_spelled() {
    let spelled = "static_galaxy_scenario = {
	system = { id = \"1\" name = \"Kel\" position = { x = 0 y = 0 } effect = { spawn_megastructure = { type = gateway_ruined orbit_distance = 100.0 orbit_angle = 0.00 random_pos = no } spawn_megastructure = { type = gateway_ruined orbit_distance = 100 orbit_angle = 0 random_pos = no graphical_culture = root } } }
}
";
    let session = from_scenario_text(spelled);
    let (_, placed) = session.scenario_system_placements(1).expect("an effect");
    let editable: Vec<bool> = placed.iter().map(|p| p.adopted).collect();
    assert_eq!(editable, [true, false]);
    let mut session = session;
    session
        .apply(Op::MoveMegastructure {
            megastructure: ruin(1, 0),
            at: MegastructurePlace::Free { x: 0.0, y: 50.0 },
        })
        .expect("the spelled ruin moves");
    assert!(
        common::text(&session).contains(
            "spawn_megastructure = { type = \"gateway_ruined\" orbit_distance = 50 orbit_angle = 270 random_pos = no }"
        ),
        "{}",
        common::text(&session)
    );
}

/// The last system and place that take an id give the last ruin id below the dig sites';
/// one past either takes none. The ranges themselves are held apart where they are declared.
#[test]
fn ruin_ids_end_where_the_dig_sites_begin() {
    use sgf_core::format::scenario::placed::{PER_SYSTEM, SITE_BASE, SYSTEMS};
    assert_eq!(ruin_id(SYSTEMS, 0), None);
    assert_eq!(ruin_id(1, PER_SYSTEM as usize), None);
    assert_eq!(
        ruin_id(SYSTEMS - 1, PER_SYSTEM as usize - 1),
        Some(SITE_BASE - 1)
    );
}

#[test]
fn an_ambient_object_comes_out_of_a_block_on_lines_of_its_own() {
    let op = Op::RemoveAmbientObject {
        ambient_object: ambient_object(1, 1),
    };
    snapshot(
        "remove_ambient_object_lines",
        from_scenario_text(THREE_EACH),
        op.clone(),
    );
    round_trip(from_scenario_text(THREE_EACH), op);
}

/// A comment inside a statement would go with a rewrite, so the statement stays as written.
#[test]
fn a_statement_holding_a_comment_stays_as_written() {
    let commented = "static_galaxy_scenario = {
	system = {
		id = \"1\"
		name = \"Kel\"
		position = { x = 0 y = 0 }
		effect = {
			spawn_megastructure = { type = \"gateway_ruined\" # keep this
				orbit_distance = 100 orbit_angle = 0 random_pos = no }
			create_ambient_object = { type = \"derelict_ship_object\" location = this }
			last_created_ambient_object = { set_location = { target = prev # its spot
				distance = 30 angle = 90 } }
		}
	}
}
";
    let mut session = from_scenario_text(commented);
    let (_, placed) = session.scenario_system_placements(1).expect("an effect");
    assert_eq!(
        placed.iter().map(|p| p.adopted).collect::<Vec<_>>(),
        [false, false]
    );
    let moved = session.apply(Op::MoveMegastructure {
        megastructure: ruin(1, 0),
        at: MegastructurePlace::Free { x: 0.0, y: 50.0 },
    });
    assert!(
        matches!(moved, Err(OpError::MegastructureKept { .. })),
        "{moved:?}"
    );
    let moved = session.apply(Op::MoveAmbientObject {
        ambient_object: ambient_object(1, 0),
        x: 0.0,
        y: 50.0,
    });
    assert!(matches!(moved, Err(OpError::Unchanged { .. })), "{moved:?}");
}

/// Vel's block closes on its last statement's line, and a new statement goes inside it.
#[test]
fn an_add_into_a_block_closing_on_its_last_line_goes_inside_it() {
    let closing = "static_galaxy_scenario = {
	system = {
		id = \"1\"
		name = \"Vel\"
		position = { x = 0 y = 0 }
		effect = {
			set_star_flag = kept }
	}
}
";
    let add = Op::AddSystemModifier {
        system: 1,
        modifier: "pulsar_radiation".to_owned(),
    };
    let mut session = from_scenario_text(closing);
    session.apply(add.clone()).expect("add");
    assert!(
        common::text(&session).contains(
            "			set_star_flag = kept add_modifier = { modifier = \"pulsar_radiation\" days = -1 } }"
        ),
        "{}",
        common::text(&session)
    );
    round_trip(from_scenario_text(closing), add);
}

/// A system whose id is past those that take ruin and ambient object ids is refused for that
/// reason.
#[test]
fn a_system_past_the_addressed_ids_is_refused_as_such() {
    use sgf_core::format::scenario::placed::SYSTEMS;
    let text = format!(
        "static_galaxy_scenario = {{\n\tsystem = {{ id = \"{SYSTEMS}\" name = \"Far\" position = {{ x = 0 y = 0 }} }}\n}}\n"
    );
    let mut session = from_scenario_text(text);
    let ruin = session.apply(add_ruin(SYSTEMS, free(10.0, 0.0)));
    assert!(
        matches!(&ruin, Err(e @ OpError::MegastructureRefused { .. }) if e.to_string().contains("ids below")),
        "{ruin:?}"
    );
    let object = session.apply(Op::AddAmbientObject {
        system: SYSTEMS,
        kind: "derelict_ship_object".to_owned(),
        x: 1.0,
        y: 0.0,
    });
    assert!(
        matches!(&object, Err(e @ OpError::Unchanged { .. }) if e.to_string().contains("ids below")),
        "{object:?}"
    );
}

/// An add answers with what it created, so the app can select it.
#[test]
fn an_add_reports_the_ruin_or_ambient_object_it_created() {
    let mut session = placing();
    let ruin_added = session.apply(add_ruin(2, free(10.0, 0.0))).expect("add");
    assert_eq!(ruin_added.created.megastructures, [ruin(2, 0)]);
    let object_added = session
        .apply(Op::AddAmbientObject {
            system: 1,
            kind: "derelict_ship_object".to_owned(),
            x: 5.0,
            y: 0.0,
        })
        .expect("add");
    assert_eq!(object_added.created.ambient_objects, [ambient_object(1, 1)]);
}
