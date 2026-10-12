//! New random seats and zones: how many, how far apart, on which starts, by seed, on the
//! sample install.

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::export::ScenarioProfile;
use sgf_core::format::scenario::fe_zone::{centre, distance};
use sgf_core::format::scenario::header_counts;
use sgf_core::format::scenario::{FeKind, FeZone, is_seat_initializer};
use sgf_core::prepare::{self, PrepareChoice, PrepareError, PreparePreset, PrepareRow, RowChoice};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_gamedata::prepare::{classify, plain_draw};

use crate::common;
use crate::common::prepare::{
    SOL, build, current, header_count_issues, initializer_of, options, position, random_seats,
    refusals, row_of, samples, scenario, set_initializer, sol, sol_seat,
};

/// Whether `initializer` is a start the scenario's profile gives a seat: one of the game's
/// ordinary systems on a plain map, one of its random empire starts for Paint a Galaxy.
fn is_seat_start(session: &Session, initializer: &str) -> bool {
    match prepare::profile(session) {
        ScenarioProfile::Plain => is_seat_initializer(initializer),
        ScenarioProfile::PaintAGalaxy => initializer.starts_with("random_empire_init_"),
    }
}

/// The home system effect goes with a seat on one of the game's ordinary systems on a
/// plain map: New random seats gives it to each new seat and takes it off each old one,
/// whatever the seed draws, in the one edit undo takes back. Paint a Galaxy's random
/// empire starts set what they need themselves, so a Paint a Galaxy map gets none.
#[test]
fn new_random_seats_move_the_home_system_effect_with_them() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let homes = |session: &Session| -> BTreeSet<u32> {
        let graph = session.graph();
        graph
            .systems
            .values()
            .filter(|s| s.home_system)
            .map(|s| s.id)
            .collect()
    };
    assert_eq!(
        homes(&session).len(),
        12,
        "the export marks the seats it gave ordinary systems"
    );
    let rows = classify(&session, gd);
    let choices = [random_seats()];
    let before = current(&session);
    for seed in [0, 1] {
        let drawn: BTreeSet<u32> = prepare::drawn(&session, &rows, &choices, &options(seed))
            .expect("draw")
            .seats
            .into_iter()
            .collect();
        let draw = plain_draw(gd, seed);
        let op = prepare::build(&session, &rows, &choices, &draw, &options(seed))
            .expect("build the batch")
            .expect("a change");
        session.apply(op).expect("apply new random seats");
        assert_eq!(homes(&session), drawn, "seed {seed}");
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), before, "seed {seed}: undo is byte-exact");
    }

    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply new random seats");
    assert_eq!(homes(&session), BTreeSet::new());
}

#[test]
fn new_random_seats_are_as_many_as_the_old_spaced_apart_on_generic_starts_with_the_old_seats_in_order()
 {
    let gd = common::sample_install();
    for (name, mut session) in samples() {
        let rows = classify(&session, gd);
        let old = row_of(&rows, PrepareRow::EmpireSeats);
        let graph = session.graph();
        let old_seats: Vec<(Option<SpawnScript>, Option<f64>)> = old
            .iter()
            .map(|id| {
                let system = &graph.systems[id];
                (system.spawn_script.clone(), system.spawn_weight)
            })
            .collect();
        let choices = [random_seats()];
        let drawn = prepare::drawn(&session, &rows, &choices, &options(0)).expect("draw");
        assert_eq!(drawn.seats.len(), old.len(), "{name}");
        assert!(drawn.zones.is_empty(), "{name}");
        let floor = match drawn.seat_floor {
            Some(floor) => {
                assert!(floor < prepare::RANDOM_START_DISTANCE, "{name}: {floor}");
                floor
            }
            None => prepare::RANDOM_START_DISTANCE,
        };
        for (i, &a) in drawn.seats.iter().enumerate() {
            assert!(!old.contains(&a), "{name}: {a} is an old seat");
            for &b in &drawn.seats[i + 1..] {
                let apart = distance(position(&session, a), position(&session, b));
                assert!(apart >= floor, "{name}: {a} and {b} are {apart} apart");
            }
        }

        let before = current(&session);
        let op = build(gd, &session, &rows, &choices).expect("a change");
        session.apply(op).expect("apply new random seats");
        let graph = session.graph();
        let seats: BTreeSet<u32> = graph
            .systems
            .values()
            .filter(|s| header_counts::is_seat(s))
            .map(|s| s.id)
            .collect();
        assert_eq!(seats, drawn.seats.iter().copied().collect(), "{name}");
        for (&id, (script, weight)) in drawn.seats.iter().zip(&old_seats) {
            let system = &graph.systems[&id];
            assert!(
                is_seat_start(&session, &system.initializer),
                "{name}: {id} has {}",
                system.initializer
            );
            let carried = match script {
                Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Sol,
                    random_value,
                    ..
                }) => Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Enabled,
                    random_value: *random_value,
                    player: false,
                }),
                script => script.clone(),
            };
            assert_eq!(system.spawn_script, carried, "{name}: {id}");
            if script.is_none() {
                assert_eq!(system.spawn_weight, *weight, "{name}: {id}");
            }
        }
        assert_eq!(
            header_count_issues(&session),
            Vec::<String>::new(),
            "{name}"
        );
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), before, "{name}: undo is byte-exact");
    }
}

#[test]
fn the_same_seed_draws_the_same_seats_and_another_seed_others() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let choices = [random_seats()];
    let seats = |seed| {
        prepare::drawn(&session, &rows, &choices, &options(seed))
            .expect("draw")
            .seats
    };
    let first = seats(0);
    assert_eq!(seats(0), first);
    let other = seats(1);
    assert_ne!(other, first);

    // Each seed seats its own systems and draws each one's start; a system seated under
    // several seeds must not always get the same start.
    let drawn_by_seed: Vec<(u64, Vec<u32>)> = (0..8).map(|seed| (seed, seats(seed))).collect();
    let mut starts: BTreeMap<u32, BTreeSet<String>> = BTreeMap::new();
    for (seed, drawn) in drawn_by_seed {
        let draw = plain_draw(gd, seed);
        let op = prepare::build(&session, &rows, &choices, &draw, &options(seed))
            .expect("build the batch")
            .expect("a change");
        session.apply(op).expect("apply new random seats");
        let graph = session.graph();
        let seated: BTreeSet<u32> = graph
            .systems
            .values()
            .filter(|s| header_counts::is_seat(s))
            .map(|s| s.id)
            .collect();
        assert_eq!(seated, drawn.iter().copied().collect(), "seed {seed}");
        for id in &drawn {
            let start = graph.systems[id].initializer.clone();
            assert!(is_seat_start(&session, &start), "{id}: {start}");
            starts.entry(*id).or_default().insert(start);
        }
        session.undo().expect("undo").expect("an edit to undo");
    }
    assert!(
        starts.values().any(|drawn| drawn.len() > 1),
        "no seat's start moved with the seed: {starts:?}"
    );
}

#[test]
fn new_random_zones_fit_up_to_six_apart_from_each_other_and_from_the_new_seats() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let choices = [
        random_seats(),
        RowChoice {
            row: PrepareRow::FallenEmpires,
            choice: PrepareChoice::RandomZones,
        },
    ];
    let drawn = prepare::drawn(&session, &rows, &choices, &options(0)).expect("draw");
    assert!(
        (1..=6).contains(&drawn.zones.len()),
        "{}",
        drawn.zones.len()
    );
    let before = current(&session);
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply new random zones");
    let graph = session.graph();
    let zones: Vec<(u32, FeZone)> = graph
        .order
        .iter()
        .filter_map(|id| Some((*id, graph.systems[id].fe_zone.clone()?)))
        .collect();
    let anchors: BTreeSet<u32> = zones.iter().map(|(id, _)| *id).collect();
    let expected: BTreeSet<u32> = drawn.zones.iter().map(|(id, _)| *id).collect();
    assert_eq!(anchors, expected);
    let seats: Vec<(f64, f64)> = drawn
        .seats
        .iter()
        .map(|&id| position(&session, id))
        .collect();
    let centres: Vec<(f64, f64)> = zones
        .iter()
        .map(|(id, zone)| centre(position(&session, *id), zone))
        .collect();
    for (i, (id, zone)) in zones.iter().enumerate() {
        assert_eq!(zone.kind, FeKind::Random, "{id}");
        assert!(zone.fallback && !zone.preferred, "{id}");
        for other in &centres[i + 1..] {
            assert!(distance(centres[i], *other) >= 60.0, "{id}");
        }
        for seat in &seats {
            assert!(distance(centres[i], *seat) >= 75.0, "{id}");
        }
    }
    let fallen = u32::try_from(zones.len()).expect("a few zones");
    assert_eq!(graph.header_count("fallen_empire_max"), Some(fallen));
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");

    let plain = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&plain, gd);
    let refused = Some(PrepareError::RandomZonesOnPlain);
    assert_eq!(
        refusals(gd, &plain, &rows, &choices[1..]),
        [refused.clone(), refused]
    );
}

#[test]
fn new_random_seats_on_a_map_with_no_seats_are_refused() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let seats_none = RowChoice {
        row: PrepareRow::EmpireSeats,
        choice: PrepareChoice::None,
    };
    let op = build(gd, &session, &rows, &[seats_none]).expect("a change");
    session.apply(op).expect("take every seat away");
    let rows = classify(&session, gd);
    let refused = Some(PrepareError::NoSeatsToDraw);
    assert_eq!(
        refusals(gd, &session, &rows, &[random_seats()]),
        [refused.clone(), refused]
    );
}

#[test]
fn an_unseated_capital_on_a_generic_start_follows_the_ordinary_systems_row() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let generic =
        |session: &Session, id: u32| initializer_of(session, id).starts_with("random_empire_init_");
    let old: Vec<u32> = row_of(&rows, PrepareRow::EmpireSeats)
        .into_iter()
        .filter(|&id| generic(&session, id))
        .collect();
    assert!(!old.is_empty());
    let before = current(&session);

    let shell = PreparePreset::BareShell.choices(ScenarioProfile::PaintAGalaxy);
    session
        .apply(build(gd, &session, &rows, &shell).expect("a change"))
        .expect("apply bare shell");
    for &id in &old {
        let system = &session.graph().systems[&id];
        assert!(!header_counts::is_seat(system), "{id} is seated again");
        assert!(!generic(&session, id), "{id} keeps {}", system.initializer);
    }
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");

    let custom = [
        (PrepareRow::EmpireSeats, PrepareChoice::None),
        (PrepareRow::OrdinarySystems, PrepareChoice::Keep),
    ]
    .map(|(row, choice)| RowChoice { row, choice });
    session
        .apply(build(gd, &session, &rows, &custom).expect("a change"))
        .expect("apply the seats taken away");
    for &id in &old {
        assert!(
            !header_counts::is_seat(&session.graph().systems[&id]),
            "{id}"
        );
        assert!(generic(&session, id), "{id} keeps its start");
    }
}

#[test]
fn new_random_seats_keep_the_spacing_from_a_seat_that_stays() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    set_initializer(&mut session, SOL, "sol_system_initializer");
    let rows = classify(&session, gd);
    let choices = [random_seats(), sol(PrepareChoice::UneSeat)[0]];
    for seed in 0..8 {
        let drawn = prepare::drawn(&session, &rows, &choices, &options(seed)).expect("draw");
        let floor = drawn.seat_floor.unwrap_or(prepare::RANDOM_START_DISTANCE);
        assert!(!drawn.seats.contains(&SOL), "seed {seed}");
        for &id in &drawn.seats {
            let apart = distance(position(&session, id), position(&session, SOL));
            assert!(apart >= floor, "seed {seed}: {id} is {apart} from Sol");
        }
    }
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply new random seats");
    assert_eq!(
        session.graph().systems[&SOL].spawn_script,
        Some(sol_seat(true)),
        "Sol keeps its seat"
    );
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
}
