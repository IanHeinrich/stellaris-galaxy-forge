//! The placement statements of an effect block, read from inline script, and the angle rule
//! between what the game writes and what the editor measures.
use sgf_core::Span;
use sgf_core::cst;
use sgf_core::placements::{
    self, AmbientObject, AmbientPoint, Amount, Orbit, SpawnMegastructure, SpawnPlace, Statement,
    SystemModifier,
};
use sgf_core::projections::geometry::{angle_about, normalised};

/// The statements of `effect = { … }` written as `text`, and the text their spans index.
fn read(text: &str) -> (Vec<Statement>, &str) {
    let root = cst::parse_script(text.as_bytes(), 0).expect("parse");
    let effect = &root.children()[0];
    (placements::read(effect, text.as_bytes()), text)
}

fn at(text: &str, span: Span) -> &str {
    &text[span.start..span.end]
}

fn orbit(distance: f64, angle: f64) -> Option<Orbit> {
    Some(Orbit {
        distance: Amount::Number(distance),
        angle: Amount::Number(angle),
    })
}

fn place(statement: &Statement) -> &SpawnPlace {
    match statement {
        Statement::SpawnMegastructure(SpawnMegastructure { place, .. }) => place,
        other => panic!("not a spawn: {other:?}"),
    }
}

#[test]
fn each_spawn_shape_reads_into_its_place() {
    let (statements, text) = read(
        "effect = {
	spawn_megastructure = { type = \"gateway_ruined\" planet = star }
	spawn_megastructure = { type = gateway_ruined planet = event_target:moon orbit_distance = 12 orbit_angle = 90 random_pos = no }
	spawn_megastructure = { type = gateway_ruined coords_from = prev }
	spawn_megastructure = { type = gateway_ruined }
	spawn_megastructure = { type = gateway_ruined random_pos = yes }
	spawn_megastructure = { type = gateway_ruined orbit_distance = 40 orbit_angle = 30 }
	spawn_megastructure = { type = gateway_ruined orbit_distance = 100 orbit_angle = 0 random_pos = no }
	spawn_megastructure = { type = gateway_ruined orbit_angle = 45 random_pos = no }
	spawn_megastructure = { type = gateway_ruined random_pos = no }
	spawn_megastructure = { type = gateway_ruined orbit_distance = { min = 10 max = 20 } orbit_angle = @angle random_pos = no }
}",
    );
    let places: Vec<&SpawnPlace> = statements.iter().map(place).collect();
    assert_eq!(
        places,
        [
            &SpawnPlace::OnBody {
                target: "star".to_owned(),
                orbit: None
            },
            &SpawnPlace::OnBody {
                target: "event_target:moon".to_owned(),
                orbit: orbit(12.0, 90.0)
            },
            &SpawnPlace::CoordsFrom {
                target: "prev".to_owned(),
                orbit: None
            },
            &SpawnPlace::Random {
                stated: false,
                orbit: None
            },
            &SpawnPlace::Random {
                stated: true,
                orbit: None
            },
            // With no `random_pos = no`, the game picks the spot whatever orbit is written.
            &SpawnPlace::Random {
                stated: false,
                orbit: orbit(40.0, 30.0)
            },
            &SpawnPlace::Free(orbit(100.0, 0.0).unwrap()),
            // An unwritten distance or angle reads 0.
            &SpawnPlace::Free(orbit(0.0, 45.0).unwrap()),
            &SpawnPlace::Centre,
            &SpawnPlace::Free(Orbit {
                distance: Amount::Written("{ min = 10 max = 20 }".to_owned()),
                angle: Amount::Written("@angle".to_owned()),
            }),
        ]
    );
    let Statement::SpawnMegastructure(first) = &statements[0] else {
        unreachable!()
    };
    assert_eq!(first.kind, "gateway_ruined");
    assert_eq!(
        at(text, first.span),
        "spawn_megastructure = { type = \"gateway_ruined\" planet = star }"
    );
}

#[test]
fn a_spawn_naming_no_type_is_foreign() {
    let (statements, text) = read("effect = { spawn_megastructure = { planet = star } }");
    let [Statement::Foreign(span)] = statements.as_slice() else {
        panic!("{statements:?}")
    };
    assert_eq!(at(text, *span), "spawn_megastructure = { planet = star }");
}

#[test]
fn an_ambient_object_takes_the_editors_own_set_location_after_it() {
    let (statements, text) = read(
        "effect = {
	create_ambient_object = { type = \"derelict_ship_object\" location = this }
	last_created_ambient_object = { set_location = { target = prev distance = 120 angle = 315 } }
	set_star_flag = kept
}",
    );
    let [Statement::AmbientObject(object), Statement::Foreign(flag)] = statements.as_slice() else {
        panic!("{statements:?}")
    };
    let AmbientObject {
        kind,
        at: Some(point),
        span,
    } = object
    else {
        panic!("no point: {object:?}")
    };
    assert_eq!(kind, "derelict_ship_object");
    assert_eq!((point.distance, point.angle), (120.0, 315.0));
    assert_eq!(
        at(text, *span),
        "create_ambient_object = { type = \"derelict_ship_object\" location = this }"
    );
    assert_eq!(
        at(text, point.span),
        "last_created_ambient_object = { set_location = { target = prev distance = 120 angle = 315 } }"
    );
    assert_eq!(statements[0].span(), Span::new(span.start, point.span.end));
    assert_eq!(at(text, *flag), "set_star_flag = kept");
}

#[test]
fn a_last_created_ambient_object_of_any_other_shape_stays_foreign() {
    let others = [
        "last_created_ambient_object = { set_ambient_object_flag = workshop }",
        "last_created_ambient_object = { set_location = { target = event_target:sun distance = 10 angle = 0 } }",
        "last_created_ambient_object = { set_location = { target = prev distance = 10 angle = 0 } set_ambient_object_flag = workshop }",
        "last_created_ambient_object = { set_location = { target = prev distance = @far angle = 0 } }",
        "last_created_ambient_object = { set_location = { target = prev angle = 90 } }",
    ];
    for other in others {
        let text = format!(
            "effect = {{ create_ambient_object = {{ type = derelict_ship_object location = this }} {other} }}"
        );
        let (statements, text) = read(&text);
        let [
            Statement::AmbientObject(AmbientObject { at: None, .. }),
            Statement::Foreign(span),
        ] = statements.as_slice()
        else {
            panic!("{other}: {statements:?}")
        };
        assert_eq!(at(text, *span), other);
    }
}

#[test]
fn a_bare_ambient_object_lands_where_the_game_picks() {
    let (statements, _) = read(
        "effect = { create_ambient_object = { type = derelict_ship_object location = this } }",
    );
    let [Statement::AmbientObject(object)] = statements.as_slice() else {
        panic!("{statements:?}")
    };
    assert_eq!(object.at, None::<AmbientPoint>);
}

#[test]
fn a_set_location_with_no_ambient_object_before_it_is_foreign() {
    let (statements, _) = read(
        "effect = { last_created_ambient_object = { set_location = { target = prev distance = 10 angle = 0 } } }",
    );
    assert!(matches!(statements.as_slice(), [Statement::Foreign(_)]));
}

#[test]
fn a_system_modifier_reads_its_modifier_and_days() {
    let (statements, text) = read(
        "effect = {
	add_modifier = { modifier = \"pulsar_radiation\" days = -1 }
	add_modifier = { modifier = nebula_storm }
	add_modifier = { days = 10 }
}",
    );
    let [
        Statement::SystemModifier(timed),
        Statement::SystemModifier(untimed),
        Statement::Foreign(nameless),
    ] = statements.as_slice()
    else {
        panic!("{statements:?}")
    };
    assert_eq!(
        (&timed.modifier, &timed.days),
        (&"pulsar_radiation".to_owned(), &Some(Amount::Number(-1.0)))
    );
    assert_eq!(
        at(text, timed.span),
        "add_modifier = { modifier = \"pulsar_radiation\" days = -1 }"
    );
    assert_eq!(
        untimed,
        &SystemModifier {
            modifier: "nebula_storm".to_owned(),
            days: None,
            span: untimed.span,
        }
    );
    assert_eq!(at(text, *nameless), "add_modifier = { days = 10 }");
}

#[test]
fn every_other_statement_is_kept_foreign_with_its_span() {
    let (statements, text) = read(
        "effect = {
	set_star_flag = painted_galaxy_wormhole_3
	if = { limit = { always = yes } spawn_megastructure = { type = gateway_ruined planet = star } }
	every_system_planet = { add_modifier = { modifier = x } }
	stray
}",
    );
    let spans: Vec<&str> = statements
        .iter()
        .map(|s| match s {
            Statement::Foreign(span) => at(text, *span),
            other => panic!("not foreign: {other:?}"),
        })
        .collect();
    assert_eq!(
        spans,
        [
            "set_star_flag = painted_galaxy_wormhole_3",
            "if = { limit = { always = yes } spawn_megastructure = { type = gateway_ruined planet = star } }",
            "every_system_planet = { add_modifier = { modifier = x } }",
            "stray",
        ]
    );
}

#[test]
fn inline_maths_written_with_spaces_reads_whole() {
    let (statements, text) = read(
        "effect = {
	spawn_megastructure = { type = gateway_ruined orbit_distance = @[ 4 * x ] orbit_angle = 90 random_pos = no }
	set_variable = { which = v value = 1 } x = @[ a + b ]
	add_modifier = { modifier = m days = @[ 30 * 2 ] }
}",
    );
    assert_eq!(
        place(&statements[0]),
        &SpawnPlace::Free(Orbit {
            distance: Amount::Written("@[ 4 * x ]".to_owned()),
            angle: Amount::Number(90.0),
        })
    );
    let [
        _,
        Statement::Foreign(set),
        Statement::Foreign(maths),
        Statement::SystemModifier(added),
    ] = statements.as_slice()
    else {
        panic!("{statements:?}")
    };
    assert_eq!(at(text, *set), "set_variable = { which = v value = 1 }");
    assert_eq!(at(text, *maths), "x = @[ a + b ]");
    assert_eq!(added.days, Some(Amount::Written("@[ 30 * 2 ]".to_owned())));
}

#[test]
fn an_ambient_object_placed_anywhere_but_this_is_foreign() {
    for location in ["location = event_target:sun", "location = prev", ""] {
        let text = format!(
            "effect = {{ create_ambient_object = {{ type = derelict_ship_object {location} }}              last_created_ambient_object = {{ set_location = {{ target = prev distance = 10 angle = 0 }} }} }}"
        );
        let (statements, _) = read(&text);
        assert!(
            matches!(
                statements.as_slice(),
                [Statement::Foreign(_), Statement::Foreign(_)]
            ),
            "{location}: {statements:?}"
        );
        let root = cst::parse_script(text.as_bytes(), 0).expect("parse");
        let create = &root.children()[0].children()[0];
        assert!(
            placements::ambient_object(create, text.as_bytes()).is_some(),
            "the lenient reader takes {location:?}"
        );
    }
}

#[test]
fn a_statement_or_a_comment_between_breaks_the_ambient_pair() {
    let between = ["set_star_flag = x", "# the derelict's spot"];
    for gap in between {
        let text = format!(
            "effect = {{
	create_ambient_object = {{ type = derelict_ship_object location = this }}
	{gap}
	             last_created_ambient_object = {{ set_location = {{ target = prev distance = 10 angle = 0 }} }}
}}"
        );
        let (statements, _) = read(&text);
        let foreign = statements
            .iter()
            .filter(|s| matches!(s, Statement::Foreign(_)))
            .count();
        assert!(
            matches!(
                statements.first(),
                Some(Statement::AmbientObject(AmbientObject { at: None, .. }))
            ),
            "{gap}: {statements:?}"
        );
        let expected = if gap.starts_with('#') { 1 } else { 2 };
        assert_eq!(foreign, expected, "{gap}: {statements:?}");
        assert_eq!(statements.len(), 1 + expected);
    }
}

/// Placed in the game at 100 out at editor angle 180, the spike's object is written at angle
/// 0, saved at (−100.45, 0), and reads back at 180. The 0.45 is the game's own.
#[test]
fn the_written_angle_is_the_editors_turned_half_a_turn() {
    assert_eq!(placements::ORBIT_START, 180.0);
    assert_eq!(placements::game_angle(180.0), 0.0);
    assert_eq!(placements::editor_angle(0.0), 180.0);
    assert_eq!(placements::game_angle(90.0), 270.0);
    assert_eq!(placements::editor_angle(270.0), 90.0);

    let (x, y) = placements::point_at((0.0, 0.0), 100.0, 0.0);
    assert!((x + 100.0).abs() < 1e-9 && y.abs() < 1e-9, "({x}, {y})");

    let saved = (-100.45, 0.0);
    assert_eq!(angle_about((0.0, 0.0), saved), 180.0);
    assert_eq!(placements::game_at((0.0, 0.0), saved), (100.45, 0.0));

    // About an off-centre main star, as an ambient object measures.
    let (x, y) = placements::point_at((10.0, 5.0), 20.0, 270.0);
    assert!(
        (x - 10.0).abs() < 1e-9 && (y - 25.0).abs() < 1e-9,
        "({x}, {y})"
    );
    let (distance, angle) = placements::game_at((10.0, 5.0), (10.0, 25.0));
    assert!((distance - 20.0).abs() < 1e-9 && (angle - 270.0).abs() < 1e-9);

    // A hair below the axis turns by `rem_euclid` to exactly 360, which is 0.
    assert_eq!(normalised(-1e-15), 0.0);
    assert_eq!(angle_about((0.0, 0.0), (100.0, -1e-15)), 0.0);
    assert_eq!(
        placements::game_at((0.0, 0.0), (100.0, -1e-15)),
        (100.0, 180.0)
    );
}
