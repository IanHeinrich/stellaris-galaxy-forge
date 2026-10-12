//! Which row each system of the sample saves' scenarios stands in, what each preset writes,
//! and that the header's counts follow the map, on the sample install.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use sgf_core::export::ScenarioProfile;
use sgf_core::format::scenario::header_counts;
use sgf_core::format::scenario::is_seat_initializer;
use sgf_core::format::scenario::marauder::clan_count;
use sgf_core::ops::Op;
use sgf_core::prepare::{
    self, PlainDraw, PrepareChoice, PrepareError, PrepareOptions, PreparePreset, PrepareRow,
    RowChoice, RowSystems,
};
use sgf_core::session::Session;
use sgf_gamedata::prepare::{classify, plain_draw};

use crate::common;
use crate::common::prepare::{
    INITIALIZER_ROWS, build, current, header_count_issues, initializer_of, row_of, samples,
    scenario, set_initializer,
};

/// How many changed lines a Bare shell snapshot shows before it counts the rest.
const SHOWN: usize = 40;

/// The description, the members by op, and each line the batch rewrote, the first
/// `shown` of them when given.
fn report(session: &Session, result_description: &str, op: &Op, shown: Option<usize>) -> String {
    let Op::Batch { ops, .. } = op else {
        panic!("one batch");
    };
    let mut out = format!("{result_description}\n");
    let mut members: BTreeMap<&str, usize> = BTreeMap::new();
    for member in ops {
        *members.entry(member.name()).or_default() += 1;
    }
    for (name, n) in members {
        writeln!(out, "{name}: {n}").unwrap();
    }
    let before = String::from_utf8_lossy(session.doc().original()).into_owned();
    let after = String::from_utf8_lossy(&current(session)).into_owned();
    let (before, after): (Vec<&str>, Vec<&str>) =
        (before.lines().collect(), after.lines().collect());
    assert_eq!(before.len(), after.len(), "every change stays on its line");
    let changed: Vec<(&str, &str)> = before
        .iter()
        .zip(&after)
        .filter(|(b, a)| b != a)
        .map(|(b, a)| (*b, *a))
        .collect();
    let limit = shown.unwrap_or(changed.len());
    for (b, a) in changed.iter().take(limit) {
        writeln!(out, "-{}\n+{}", b.trim(), a.trim()).unwrap();
    }
    if changed.len() > limit {
        writeln!(out, "… {} more changed lines", changed.len() - limit).unwrap();
    }
    out
}

#[test]
fn each_system_stands_in_one_initializer_row_unless_it_is_a_seat_or_a_fallen_empires() {
    let gd = common::sample_install();
    let session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let counts: Vec<(PrepareRow, usize)> = rows.iter().map(|r| (r.row, r.systems.len())).collect();
    assert_eq!(
        counts,
        [
            (PrepareRow::EmpireSeats, 17),
            (PrepareRow::HomeStarts, 4),
            (PrepareRow::Sol, 1),
            (PrepareRow::HomeNeighbours, 32),
            (PrepareRow::OriginAndEvent, 3),
            (PrepareRow::FallenEmpires, 24),
            (PrepareRow::MarauderClans, 6),
            (PrepareRow::Guardians, 6),
            (PrepareRow::Enclaves, 14),
            (PrepareRow::Primitives, 4),
            (PrepareRow::SpecialSystems, 92),
            (PrepareRow::OrdinarySystems, 593),
            (PrepareRow::WormholePairs, 0),
            (PrepareRow::SystemNames, 791),
        ]
    );
    let of = |row: PrepareRow| -> BTreeSet<u32> {
        let found = rows
            .iter()
            .find(|r| r.row == row)
            .expect("every row is listed");
        found.systems.iter().copied().collect()
    };
    let mut placed: BTreeSet<u32> = BTreeSet::new();
    for row in INITIALIZER_ROWS
        .into_iter()
        .chain([PrepareRow::OrdinarySystems])
    {
        for id in of(row) {
            assert!(
                placed.insert(id),
                "system {id} stands in two initializer rows"
            );
        }
    }
    let unplaced: BTreeSet<u32> = of(PrepareRow::SystemNames)
        .difference(&placed)
        .copied()
        .collect();
    let seats_and_fallen: BTreeSet<u32> = of(PrepareRow::EmpireSeats)
        .union(&of(PrepareRow::FallenEmpires))
        .copied()
        .collect();
    assert!(unplaced.is_subset(&seats_and_fallen), "{unplaced:?}");
    assert!(of(PrepareRow::HomeStarts).is_subset(&of(PrepareRow::EmpireSeats)));
}

#[test]
fn the_sample_install_loads_without_a_diagnostic() {
    let diagnostics: Vec<String> = common::sample_install()
        .diagnostics
        .iter()
        .map(ToString::to_string)
        .collect();
    assert!(diagnostics.is_empty(), "{diagnostics:#?}");
}

/// The sample install is cut from the real one, so both put each sample's systems in the same
/// rows and draw the same plain layouts. When the game changes what Prepare reads, this fails
/// until the sample install is cut again.
#[test]
fn the_sample_install_classifies_the_samples_as_the_real_install_does() {
    let Some(real) = common::INSTALL.as_ref() else {
        return;
    };
    let cut = common::sample_install();
    for (name, session) in samples() {
        assert_eq!(classify(&session, real), classify(&session, cut), "{name}");
    }
    assert_eq!(plain_draw(real, 0), plain_draw(cut, 0));

    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, real);
    let ordinary = row_of(&rows, PrepareRow::OrdinarySystems);
    let seat = row_of(&rows, PrepareRow::EmpireSeats)
        .into_iter()
        .find(|&id| is_seat_initializer(initializer_of(&session, id)))
        .expect("a seat on an ordinary system");
    let deneb = 4;
    for (system, initializer) in [
        (ordinary[0], "pre_ftl_init_sol"),
        (ordinary[1], "init_sol_geocentric"),
        (seat, "random_empire_init_02"),
        (deneb, "basic_init_01"),
    ] {
        set_initializer(&mut session, system, initializer);
        assert_eq!(
            classify(&session, real),
            classify(&session, cut),
            "{system} on {initializer}"
        );
    }
}

#[test]
fn each_preset_on_each_sample_and_profile_is_one_edit_that_undo_takes_back() {
    let gd = common::sample_install();
    for (name, mut session) in samples() {
        let rows = classify(&session, gd);
        let profile = prepare::profile(&session);
        let original = session.doc().original().to_vec();
        assert_eq!(
            build(
                gd,
                &session,
                &rows,
                &PreparePreset::Faithful.choices(profile)
            ),
            None,
            "{name}: Faithful changes nothing"
        );
        for (preset, label, shown) in [
            (PreparePreset::FreshStart, "fresh_start", None),
            (PreparePreset::BareShell, "bare_shell", Some(SHOWN)),
        ] {
            let op = build(gd, &session, &rows, &preset.choices(profile)).expect("a change");
            let result = session.apply(op.clone()).expect("apply the batch");
            assert_eq!(
                session.history().undo.len(),
                1,
                "{name} {label}: one undo step"
            );
            let out = report(&session, &result.entry.description, &op, shown);
            insta::with_settings!({snapshot_path => "snapshots/prepare", prepend_module_to_snapshot => false}, {
                insta::assert_snapshot!(format!("{name}_{label}"), out);
            });
            assert_eq!(
                header_count_issues(&session),
                Vec::<String>::new(),
                "{name} {label}"
            );
            session.undo().expect("undo").expect("an edit to undo");
            assert_eq!(
                current(&session),
                original,
                "{name} {label}: undo is byte-exact"
            );
            assert!(
                !session.doc().is_dirty(),
                "{name} {label}: undo leaves the overlay empty"
            );
        }
    }
}

#[test]
fn a_choice_its_row_does_not_offer_is_refused() {
    let gd = common::sample_install();
    let session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let unoffered = RowChoice {
        row: PrepareRow::OrdinarySystems,
        choice: PrepareChoice::Plain,
    };
    let refused = prepare::build(
        &session,
        &rows,
        &[unoffered],
        &plain_draw(gd, 0),
        &PrepareOptions::default(),
    );
    assert_eq!(
        refused,
        Err(PrepareError::Unoffered {
            row: PrepareRow::OrdinarySystems,
            choice: PrepareChoice::Plain
        })
    );
    let twice = [
        RowChoice {
            row: PrepareRow::SystemNames,
            choice: PrepareChoice::Keep,
        },
        RowChoice {
            row: PrepareRow::SystemNames,
            choice: PrepareChoice::GameNames,
        },
    ];
    let refused = prepare::build(
        &session,
        &rows,
        &twice,
        &plain_draw(gd, 0),
        &PrepareOptions::default(),
    );
    assert_eq!(
        refused,
        Err(PrepareError::RowTwice(PrepareRow::SystemNames))
    );
}

#[test]
fn seats_zones_and_names_left_out_on_a_paint_a_galaxy_map_go_and_undo_brings_them_back() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let empires = session.graph().header_block_count("num_empires", "max");
    let zones: BTreeSet<u8> = session
        .graph()
        .systems
        .values()
        .filter(|system| system.fe_zone.is_some())
        .filter_map(|system| system.fe_link.id)
        .collect();
    let linked = |session: &Session| {
        let systems = session.graph().systems.values();
        systems
            .filter(|s| {
                s.fe_link.custom
                    || s.fe_link.id.is_some()
                    || s.fe_link.to.iter().any(|n| zones.contains(n))
            })
            .count()
    };
    assert!(
        linked(&session) > zones.len(),
        "the zones take custom connections: {zones:?}"
    );
    let rows = classify(&session, gd);
    let choices = [
        (PrepareRow::EmpireSeats, PrepareChoice::None),
        (PrepareRow::FallenEmpires, PrepareChoice::None),
        (PrepareRow::SystemNames, PrepareChoice::GameNames),
    ]
    .map(|(row, choice)| RowChoice { row, choice });
    let op = build(gd, &session, &rows, &choices).expect("a change");
    let result = session.apply(op.clone()).expect("apply the batch");
    let out = report(&session, &result.entry.description, &op, Some(0));
    insta::with_settings!({snapshot_path => "snapshots/prepare", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!("4_4_paint_seats_zones_names", out);
    });
    for system in session.graph().systems.values() {
        assert!(
            system.spawn_script.is_none() && system.spawn_weight.is_none(),
            "{}",
            system.id
        );
        assert!(system.fe_zone.is_none(), "{}", system.id);
        assert!(system.name.key.is_empty(), "{}", system.id);
    }
    assert_eq!(linked(&session), 0, "no link into a removed zone is left");
    for key in ["fallen_empire_max", "fallen_empire_default"] {
        assert_eq!(session.graph().header_count(key), Some(0), "{key}");
    }
    assert_eq!(
        session.graph().header_block_count("num_empires", "max"),
        empires,
        "the empire counts stay with no seat left"
    );
    assert!(
        !String::from_utf8_lossy(&current(&session))
            .contains("painted_galaxy_fe_custom_connection")
    );
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn fallen_empires_and_marauder_clans_left_out_take_their_header_counts_down_in_the_same_edit() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let original = session.doc().original().to_vec();
    let count = |session: &Session, key| session.graph().header_count(key);
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    assert_ne!(count(&session, "fallen_empire_max"), Some(0));
    assert_ne!(count(&session, "marauder_empire_max"), Some(0));
    let rows = classify(&session, gd);
    let choices = [
        (PrepareRow::FallenEmpires, PrepareChoice::None),
        (PrepareRow::MarauderClans, PrepareChoice::Plain),
    ]
    .map(|(row, choice)| RowChoice { row, choice });
    let op = build(gd, &session, &rows, &choices).expect("a change");
    let Op::Batch { ops, description } = &op else {
        panic!("one batch");
    };
    let (header, systems) = ops.split_last().expect("members");
    assert!(
        matches!(header, Op::SetHeaderKeys { .. }),
        "the header comes last: {header:?}"
    );
    assert_eq!(
        description,
        &format!(
            "Prepared {} systems for a new game",
            prepare::changed(&session, &op)
        )
    );

    let without_header = Op::Batch {
        description: description.clone(),
        ops: systems.to_vec(),
    };
    session
        .apply(without_header)
        .expect("apply the systems alone");
    assert_eq!(header_count_issues(&session).len(), 1);
    session.undo().expect("undo").expect("an edit to undo");

    session.apply(op).expect("apply the batch");
    assert_eq!(session.history().undo.len(), 1, "one undo step");
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    for key in [
        "fallen_empire_max",
        "fallen_empire_default",
        "marauder_empire_max",
        "marauder_empire_default",
    ] {
        assert_eq!(count(&session, key), Some(0), "{key}");
    }
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), original, "undo is byte-exact");
}

#[test]
fn one_marauder_clan_left_out_takes_the_marauder_counts_down_by_one() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let original = session.doc().original().to_vec();
    let count = |session: &Session, key| {
        session
            .graph()
            .header_count(key)
            .expect("the header states the key")
    };
    let clans = clan_count(session.graph());
    assert!(clans > 1, "{clans}");
    assert_eq!(count(&session, "marauder_empire_max"), clans);
    assert_eq!(count(&session, "marauder_empire_default"), clans);
    let rows: Vec<RowSystems> = classify(&session, gd)
        .into_iter()
        .map(|row| match row.row {
            PrepareRow::MarauderClans => {
                let clan_of = |id: &u32| session.graph().systems[id].marauder.map(|r| r.clan());
                let first = clan_of(&row.systems[0]);
                RowSystems {
                    systems: row
                        .systems
                        .iter()
                        .copied()
                        .filter(|id| clan_of(id) == first)
                        .collect(),
                    ..row
                }
            }
            _ => row,
        })
        .collect();
    let choices = [RowChoice {
        row: PrepareRow::MarauderClans,
        choice: PrepareChoice::Plain,
    }];
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply the batch");
    assert_eq!(clan_count(session.graph()), clans - 1);
    assert_eq!(count(&session, "marauder_empire_max"), clans - 1);
    assert_eq!(count(&session, "marauder_empire_default"), clans - 1);
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), original, "undo is byte-exact");
}

#[test]
fn marauder_clans_the_game_rolls_open_the_marauder_slider_and_kept_ones_hold_it_to_the_homes() {
    let gd = common::sample_install();
    for profile in [ScenarioProfile::Plain, ScenarioProfile::PaintAGalaxy] {
        let label = format!("{profile:?}");
        let count = |session: &Session, key| session.graph().header_count(key);
        let mut session = scenario(common::open_4_5(), profile);
        let original = session.doc().original().to_vec();
        let exported_default = count(&session, "marauder_empire_default");
        assert_eq!(exported_default, Some(2), "{label}");
        let rows = classify(&session, gd);
        let bare_shell = PreparePreset::BareShell.choices(profile);
        assert!(
            bare_shell.contains(&RowChoice {
                row: PrepareRow::MarauderClans,
                choice: PrepareChoice::GameDecides,
            }),
            "{label}"
        );
        let op = build(gd, &session, &rows, &bare_shell).expect("a change");
        session.apply(op).expect("apply the batch");
        assert_eq!(clan_count(session.graph()), 0, "{label}");
        assert_eq!(count(&session, "marauder_empire_max"), Some(3), "{label}");
        assert_eq!(
            count(&session, "marauder_empire_default"),
            exported_default,
            "{label}"
        );
        assert_eq!(
            header_count_issues(&session),
            Vec::<String>::new(),
            "{label}"
        );
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), original, "{label}: undo is byte-exact");

        let kept: Vec<RowChoice> = bare_shell
            .iter()
            .map(|&choice| match choice.row {
                PrepareRow::MarauderClans => RowChoice {
                    choice: PrepareChoice::Keep,
                    ..choice
                },
                _ => choice,
            })
            .collect();
        let op = build(gd, &session, &rows, &kept).expect("a change");
        session.apply(op).expect("apply the batch");
        let clans = Some(clan_count(session.graph()));
        assert_eq!(clans, Some(2), "{label}");
        assert_eq!(count(&session, "marauder_empire_max"), clans, "{label}");
        assert_eq!(count(&session, "marauder_empire_default"), clans, "{label}");
        assert_eq!(
            header_count_issues(&session),
            Vec::<String>::new(),
            "{label}"
        );
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), original, "{label}: undo is byte-exact");
    }
}

/// A seat on one of the game's random empire starts gets a homeworld built before the
/// game knows the species, so it is a home start: Random starting system rewrites it and
/// Keep as is keeps it. The export writes none, so the seats it gave ordinary systems are
/// put back on a random empire start, as an older scenario has them.
#[test]
fn a_seat_on_a_random_empire_start_is_a_home_start() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let ordinary: Vec<u32> = row_of(&classify(&session, gd), PrepareRow::EmpireSeats)
        .into_iter()
        .filter(|&id| is_seat_initializer(initializer_of(&session, id)))
        .collect();
    assert_eq!(ordinary.len(), 12);
    for &id in &ordinary {
        set_initializer(&mut session, id, "random_empire_init_02");
        session
            .apply(Op::SetHomeSystem {
                system: id,
                home: false,
            })
            .expect("take the export's home mark off");
    }
    let rows = classify(&session, gd);
    let homes = row_of(&rows, PrepareRow::HomeStarts);
    assert_eq!(homes.len(), 16);
    let random = ordinary;
    assert!(random.iter().all(|id| homes.contains(id)), "{homes:?}");

    let row = |choice| {
        [RowChoice {
            row: PrepareRow::HomeStarts,
            choice,
        }]
    };
    assert_eq!(build(gd, &session, &rows, &row(PrepareChoice::Keep)), None);
    let before = current(&session);
    let op = build(gd, &session, &rows, &row(PrepareChoice::GenericStart)).expect("a change");
    session.apply(op).expect("apply Random starting system");
    for &id in &homes {
        let system = &session.graph().systems[&id];
        assert!(
            is_seat_initializer(&system.initializer),
            "{id}: {}",
            system.initializer
        );
        assert!(system.home_system, "{id} is an empire's home");
    }
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");
}

/// On a plain map a batch leaves the home system effect on exactly the seats on one of the
/// game's ordinary systems, whatever rows it touches: here a seat put on one without the
/// effect gains it, and a system that holds the effect but no seat loses it.
#[test]
fn any_plain_batch_leaves_the_home_system_effect_on_exactly_the_ordinary_seats() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let deneb = 4;
    set_initializer(&mut session, deneb, "basic_init_01");
    let rows = classify(&session, gd);
    let stray = row_of(&rows, PrepareRow::OrdinarySystems)[0];
    session
        .apply(Op::SetHomeSystem {
            system: stray,
            home: true,
        })
        .expect("mark a system that holds no seat");
    let rows = classify(&session, gd);
    let fallen_none = [RowChoice {
        row: PrepareRow::FallenEmpires,
        choice: PrepareChoice::None,
    }];
    let before = current(&session);
    let op = build(gd, &session, &rows, &fallen_none).expect("a change");
    session
        .apply(op)
        .expect("apply the fallen empires taken away");
    let graph = session.graph();
    assert!(
        graph.systems[&deneb].home_system,
        "the seat gains the effect"
    );
    assert!(
        !graph.systems[&stray].home_system,
        "{stray} loses the effect"
    );
    for system in graph.systems.values() {
        let ordinary_seat =
            header_counts::is_seat(system) && is_seat_initializer(&system.initializer);
        assert_eq!(system.home_system, ordinary_seat, "{}", system.id);
    }
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");
}

#[test]
fn a_paint_a_galaxy_export_has_no_home_starts_left_to_make_generic() {
    let gd = common::sample_install();
    let session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let counts: Vec<(PrepareRow, usize)> = classify(&session, gd)
        .iter()
        .map(|r| (r.row, r.systems.len()))
        .collect();
    assert_eq!(
        counts,
        [
            (PrepareRow::EmpireSeats, 17),
            (PrepareRow::HomeStarts, 0),
            (PrepareRow::Sol, 0),
            (PrepareRow::HomeNeighbours, 32),
            (PrepareRow::OriginAndEvent, 3),
            (PrepareRow::FallenEmpires, 4),
            (PrepareRow::MarauderClans, 6),
            (PrepareRow::Guardians, 6),
            (PrepareRow::Enclaves, 14),
            (PrepareRow::Primitives, 4),
            (PrepareRow::SpecialSystems, 91),
            (PrepareRow::OrdinarySystems, 591),
            (PrepareRow::WormholePairs, 12),
            (PrepareRow::SystemNames, 765),
        ]
    );
}

#[test]
fn an_initializer_the_install_does_not_know_stands_with_the_special_systems() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let system = session.graph().order[0];
    session
        .apply(Op::SetInitializer {
            system,
            initializer: Some("sgf_unknown_layout".to_owned()),
        })
        .expect("set an initializer no install has");
    let rows = classify(&session, gd);
    let special = rows
        .iter()
        .find(|r| r.row == PrepareRow::SpecialSystems)
        .expect("the row");
    assert!(special.systems.contains(&system), "{system}");
}

#[test]
fn plain_system_with_nothing_to_draw_is_refused() {
    let gd = common::sample_install();
    let session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let plain = [RowChoice {
        row: PrepareRow::OriginAndEvent,
        choice: PrepareChoice::Plain,
    }];
    let refused = prepare::build(
        &session,
        &rows,
        &plain,
        &PlainDraw::default(),
        &PrepareOptions::default(),
    );
    assert_eq!(refused, Err(PrepareError::NoPlainLayouts));
}
