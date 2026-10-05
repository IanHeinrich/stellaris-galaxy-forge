//! What adding a system to a save refuses, and the save shapes it meets: a save without an
//! asteroid pool or a deposit table, a table whose closing brace shares a line, and the
//! version the save names.

use sgf_core::ops::{BeltSpec, OpError, SystemSpec};
use sgf_core::session::Session;
use sgf_core::views::Capabilities;

use crate::common;
use crate::ops_add_system::{add, beside, bodies};
use common::Refused;
use common::diff::{round_trip, round_trip_step};
use common::spec::{belted, body, dorellion, mura};
use common::{SAMPLE, open, open_3_4, open_4_5, open_edited, open_edited_sample, text};

/// A change to the spec, and whether an error is the refusal it should meet.
type Case = Refused<fn(&mut SystemSpec)>;

fn refused(mut session: Session, spec: SystemSpec) -> OpError {
    let error = session.apply(add(spec)).expect_err("refused");
    assert!(!session.doc().is_dirty(), "{error}");
    error
}

/// The 4.4 sample with its asteroid name pool, the prefix list and every suffix block,
/// swapped for `pool`.
pub(crate) fn with_asteroid_pool(pool: &str) -> Session {
    open_edited(|text| {
        let start = text.find("\n\tasteroid_prefix=\n").expect("the prefixes") + 1;
        let last = text.rfind("\n\tasteroid_postfix=\n").expect("the suffixes") + 1;
        let end = last + text[last..].find("\n\t}\n").expect("the last block's end") + 4;
        text.replace_range(start..end, pool);
    })
}

#[test]
fn what_the_op_refuses() {
    let gap = open_edited(|text| {
        *text = text.replace("\nlast_created_system=790\n", "\nlast_created_system=795\n");
    });
    assert!(matches!(
        refused(gap, dorellion()),
        OpError::SystemIdsNotDense {
            last: 795,
            count: 791
        }
    ));

    let cases: Vec<Case> = vec![
        (|s| s.x = f64::NAN, |e| matches!(e, OpError::NotFinite)),
        (
            |s| s.x = 700.0,
            |e| matches!(e, OpError::OutsideGalaxy { .. }),
        ),
        (
            |s| (s.x, s.y) = (397.39 + 6.0, -180.25),
            |e| matches!(e, OpError::TooClose { id: 217, .. }),
        ),
        (
            |s| s.name = String::new(),
            |e| matches!(e, OpError::EmptyText { what: "a name" }),
        ),
        (
            |s| s.lanes = vec![9999],
            |e| matches!(e, OpError::UnknownSystem(9999)),
        ),
        (
            |s| s.lanes = vec![217, 217],
            |e| matches!(e, OpError::DuplicateLane(791, 217)),
        ),
        (
            |s| s.star_class = String::new(),
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a star class"
                    }
                )
            },
        ),
        (
            |s| s.planets[0].class = String::new(),
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a planet class"
                    }
                )
            },
        ),
        (
            |s| s.planets[0].size = 0,
            |e| matches!(e, OpError::ZeroPlanetSize),
        ),
        (
            |s| s.planets[0].deposits = vec!["d_\"x".to_owned()],
            |e| matches!(e, OpError::InvalidText { .. }),
        ),
        (
            |s| s.star.moons = vec![body("pc_barren", 5, 10.0, 0.0, 1)],
            |e| matches!(e, OpError::MoonsNotAllowed("the star")),
        ),
        (
            |s| s.planets[3].moons[0].moons = vec![body("pc_barren", 5, 10.0, 0.0, 1)],
            |e| matches!(e, OpError::MoonsNotAllowed("a moon")),
        ),
        (
            |s| {
                s.planets[1].asteroid = true;
                s.planets[1].moons = vec![body("pc_barren", 5, 10.0, 0.0, 1)];
            },
            |e| matches!(e, OpError::MoonsNotAllowed("an asteroid")),
        ),
        (
            |s| s.star.asteroid = true,
            |e| matches!(e, OpError::AsteroidNotAllowed("the star")),
        ),
        (
            |s| s.planets[3].moons[0].asteroid = true,
            |e| matches!(e, OpError::AsteroidNotAllowed("a moon")),
        ),
        (
            |s| {
                s.belts = vec![BeltSpec {
                    kind: String::new(),
                    inner_radius: 95.0,
                }]
            },
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a belt type"
                    }
                )
            },
        ),
        (
            |s| s.flags = vec!["unique system".to_owned()],
            |e| {
                matches!(
                    e,
                    OpError::InvalidText {
                        what: "a star flag",
                        ..
                    }
                )
            },
        ),
        (
            |s| s.flags = vec![String::new()],
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a star flag"
                    }
                )
            },
        ),
        (
            |s| {
                s.belts = vec![BeltSpec {
                    kind: "rocky_asteroid_belt".to_owned(),
                    inner_radius: f64::INFINITY,
                }]
            },
            |e| matches!(e, OpError::NotFinite),
        ),
    ];
    let mut session = open();
    for (edit, expected) in cases {
        let mut spec = dorellion();
        edit(&mut spec);
        let error = session.apply(add(spec.clone())).expect_err("refused");
        assert!(expected(&error), "{spec:?}: {error:?}");
    }
    assert!(!session.doc().is_dirty(), "a refusal wrote bytes");
    assert!(session.history().undo.is_empty(), "a refusal made history");
}

#[test]
fn a_save_without_an_asteroid_pool_takes_no_asteroids() {
    round_trip(with_asteroid_pool(""), add(dorellion()));
    assert!(matches!(
        refused(with_asteroid_pool(""), belted(dorellion())),
        OpError::MissingKey("asteroid_prefix")
    ));
}

/// The 4.4 sample with a top-level section swapped for `replacement`, which is empty
/// when the section goes.
fn without_section(key: &str, replacement: &str) -> Session {
    let head = format!("\n{key}=\n{{\n");
    open_edited(|text| {
        let start = text.find(&head).expect("the section") + 1;
        let end = start + text[start..].find("\n}\n").expect("its closing brace") + 3;
        text.replace_range(start..end, replacement);
    })
}

#[test]
fn a_save_without_a_deposit_table_takes_a_system_without_deposits() {
    let mut spec = dorellion();
    let mut bare = spec.clone();
    bare.star.deposits.clear();
    for planet in &mut bare.planets {
        planet.deposits.clear();
    }
    round_trip(without_section("deposit", ""), add(bare));
    spec.name = "Sgf_Deposits".to_owned();
    assert!(matches!(
        refused(without_section("deposit", ""), spec),
        OpError::MissingKey("deposit")
    ));
}

#[test]
fn entries_land_inside_a_table_whose_closing_brace_shares_a_line() {
    let mut session = without_section("deposit", "deposit={ }\n");
    round_trip_step(&mut session, "first", add(dorellion()));
    round_trip_step(&mut session, "second", add(beside(&dorellion(), 791)));
    let text = text(&session);
    let start = text.find("\ndeposit={ \n").expect("the table") + 1;
    let table = &text[start..start + text[start..].find("\n}\n").expect("its end") + 3];
    assert!(table.starts_with("deposit={ \n\t0=\n\t{\n\t\ttype=\"d_energy_5\"\n"));
    assert!(table.contains("\t}\n\t5=\n\t{\n"), "{table}");
    assert!(table.ends_with("\t\t\tid=8416\n\t\t}\n\t}\n}\n"), "{table}");
    assert!(table.lines().all(|line| !line.trim().is_empty()), "{table}");
    assert_eq!(bodies(&session, 792)[0].2, ["d_energy_5 x1"]);
    let planets = "planets=\n{\n\tplanet={ }\n}\n";
    let mut session = without_section("planets", planets);
    // Every other system still lists planets this table no longer holds, and the new ones
    // take their ids, so only the text is checked here.
    session.apply(add(dorellion())).expect("add");
    let text = self::text(&session);
    assert!(
        text.contains("planets=\n{\n\tplanet={ \n\t\t0=\n\t\t{\n\t\t\tplanet_class=\"pc_g_star\""),
        "the entry takes the table's indentation"
    );
    assert!(text.contains("\t\t\tentity=1\n\t\t}\n\t}\n}\n"));
}

/// The 4.4 sample with its `meta` rewritten by `edit`.
fn with_meta(edit: impl FnOnce(&mut String)) -> Session {
    open_edited_sample(SAMPLE, |_, meta| edit(meta))
}

/// The 4.4 sample with its `meta` version written as `version`.
fn with_version(version: &str) -> Session {
    with_meta(|meta| {
        *meta = meta.replace(
            "version=\"Pegasus v4.4.6\"",
            &format!("version=\"{version}\""),
        );
    })
}

#[test]
fn the_version_is_read_with_or_without_a_release_name() {
    with_version("4.1.0")
        .apply(add(dorellion()))
        .expect("a bare 4.x version");
    assert!(matches!(
        refused(with_version("v3.14.1"), dorellion()),
        OpError::VersionTooOld(v) if v == "v3.14.1"
    ));
    assert!(matches!(
        refused(with_version("Pegasus"), dorellion()),
        OpError::UnknownVersion(v) if v == "Pegasus"
    ));
}

#[test]
fn a_save_that_refuses_the_add_offers_no_added_systems_but_keeps_bodies() {
    let offered = |session: &Session| {
        let capabilities = Capabilities::of(session.doc());
        (
            capabilities.added_systems,
            capabilities.bodies,
            capabilities.deposits,
        )
    };
    assert_eq!(offered(&open()), (true, true, true));
    assert_eq!(offered(&open_3_4()), (false, true, false));

    let ironman = with_meta(|meta| meta.push_str("ironman=yes\n"));
    assert_eq!(offered(&ironman), (true, true, true));
}

#[test]
fn an_add_is_not_checked_without_its_second_step() {
    let session = open_4_5();
    let refusal = session.check_op(&add(mura())).expect("refused");
    assert!(
        refusal.contains("its second step needs its first applied"),
        "{refusal}"
    );
}
