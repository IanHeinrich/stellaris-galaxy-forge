//! Paint a Galaxy's custom connections on the painted fixture: what the flags read as,
//! what linking systems to a zone writes and takes away, the odd states the flag op
//! reaches and the refusals.

use sgf_core::format::scenario::fe_link::{self, FeLinkFlags};
use sgf_core::ops::{Op, OpError};
use sgf_core::validate::{Issue, IssueCode};

use crate::common;
use common::Refused;
use common::coded;
use common::diff::{plain_report, round_trip, snapshot_step};
use common::fixture::{PAINTED, from_scenario_text};

fn set_links(anchor: u32, linked: &[u32]) -> Op {
    Op::SetFeLinks {
        anchor,
        linked: linked.to_vec(),
    }
}

fn set_flags(entries: Vec<(u32, FeLinkFlags)>) -> Op {
    Op::SetFeLinkFlags { entries }
}

fn link(custom: bool, id: Option<u8>, to: &[u8]) -> FeLinkFlags {
    FeLinkFlags {
        custom,
        id,
        to: to.to_vec(),
    }
}

fn link_issues(issues: &[Issue]) -> Vec<&Issue> {
    issues
        .iter()
        .filter(|issue| {
            matches!(
                issue.code,
                IssueCode::FeLinkIsolated
                    | IssueCode::FeLinkDangling
                    | IssueCode::FeLinkShared
                    | IssueCode::FeLinkFar
            )
        })
        .collect()
}

/// The link issues that say the mod would do other than asked: a far link is only
/// worth a look.
fn link_warnings(issues: &[Issue]) -> Vec<&Issue> {
    link_issues(issues)
        .into_iter()
        .filter(|issue| issue.code != IssueCode::FeLinkFar)
        .collect()
}

#[test]
fn the_fixture_carries_no_connections_and_a_save_never_does() {
    let session = PAINTED.open();
    for system in session.graph().systems.values() {
        assert_eq!(system.fe_link, FeLinkFlags::default(), "{}", system.id);
    }
    assert_eq!(fe_link::next_free_id(session.graph()), Some(0));
    assert!(link_issues(&session.validate()).is_empty());

    let save = common::open();
    assert!(
        save.graph()
            .systems
            .values()
            .all(|s| s.fe_link == FeLinkFlags::default())
    );
}

#[test]
fn linking_writes_the_anchor_and_the_linked_and_relinking_touches_only_what_changes() {
    let mut session = PAINTED.open();
    let result = snapshot_step(&mut session, "link_9_to_2_3", set_links(9, &[3, 2]));
    assert_eq!(result.touched, [2, 3, 9]);
    assert_eq!(
        session.graph().systems[&9].fe_link,
        link(true, Some(0), &[])
    );
    assert_eq!(session.graph().systems[&2].fe_link, link(false, None, &[0]));
    assert_eq!(session.graph().systems[&3].fe_link, link(false, None, &[0]));
    assert_eq!(fe_link::next_free_id(session.graph()), Some(1));
    let issues = session.validate();
    assert!(link_warnings(&issues).is_empty(), "{issues:?}");
    let far = coded(&issues, IssueCode::FeLinkFar);
    assert_eq!(far.len(), 2, "both stand 139 from the centre: {far:?}");
    assert_eq!(
        far[1].message,
        "Sol is 139 from the fallen empire zone it links to. The mod lays the hyperlane anyway."
    );
    assert_eq!(far[1].systems, [3, 9]);

    let result = snapshot_step(&mut session, "link_9_to_7_3", set_links(9, &[7, 3]));
    assert_eq!(
        result.touched,
        [2, 7],
        "Sol and Old Seat stand as they were"
    );
    assert_eq!(
        session.graph().systems[&9].fe_link,
        link(true, Some(0), &[])
    );
    assert_eq!(session.graph().systems[&2].fe_link, FeLinkFlags::default());
    assert_eq!(session.graph().systems[&7].fe_link, link(false, None, &[0]));
    assert!(common::text(&session).contains(
        "spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2| } }"
    ));

    snapshot_step(&mut session, "unlink_9", set_links(9, &[]));
    for id in [2, 3, 7, 9] {
        assert_eq!(session.graph().systems[&id].fe_link, FeLinkFlags::default());
    }
    assert_eq!(fe_link::next_free_id(session.graph()), Some(0));
    assert_eq!(
        common::text(&session),
        String::from_utf8(PAINTED.bytes()).unwrap()
    );

    for _ in 0..3 {
        session.undo().expect("undo").expect("an op to undo");
    }
    assert_eq!(common::current(&session), PAINTED.bytes());
}

#[test]
fn a_second_anchor_takes_the_next_free_id_and_a_freed_id_is_taken_again() {
    let mut session = PAINTED.open();
    session.apply(set_links(9, &[3])).expect("link 9");
    let result = session
        .apply(set_links(12, &[1]))
        .expect("link Beta to High Seat");
    assert_eq!(
        result.entry.description,
        "Linked 1 system to the fallen empire zone at High Seat #12"
    );
    assert_eq!(
        session.graph().systems[&12].fe_link,
        link(true, Some(1), &[])
    );
    assert_eq!(session.graph().systems[&1].fe_link, link(false, None, &[1]));
    assert_eq!(fe_link::next_free_id(session.graph()), Some(2));
    assert!(common::text(&session).contains(
        "set_star_flag = painted_galaxy_fe_spawn_fallback set_star_flag = painted_galaxy_fe_custom_connections set_star_flag = painted_galaxy_fe_custom_connection_id_1 } }"
    ));
    let issues = session.validate();
    assert!(link_warnings(&issues).is_empty(), "{issues:?}");

    session.apply(set_links(9, &[])).expect("unlink 9");
    assert_eq!(fe_link::next_free_id(session.graph()), Some(0));
    session
        .apply(set_links(9, &[3, 1]))
        .expect("Beta links to both zones");
    assert_eq!(
        session.graph().systems[&9].fe_link,
        link(true, Some(0), &[])
    );
    assert_eq!(
        session.graph().systems[&1].fe_link,
        link(false, None, &[0, 1])
    );
    assert!(common::text(&session).contains(
        "effect = { set_star_flag = painted_galaxy_fe_custom_connection_to_0 set_star_flag = painted_galaxy_fe_custom_connection_to_1 } }"
    ));
    for _ in 0..4 {
        session.undo().expect("undo").expect("an op to undo");
    }
    assert_eq!(common::current(&session), PAINTED.bytes());
}

#[test]
fn a_link_needs_a_zone_anchor_other_systems_that_exist_and_ids_the_mod_reads() {
    let mut session = PAINTED.open();
    let cases: Vec<Refused<Op>> = vec![
        (set_links(10, &[3]), |e| {
            matches!(e, OpError::FeLinkNoZone(10))
        }),
        (set_links(9, &[3, 9]), |e| {
            matches!(e, OpError::FeLinkSelf(9))
        }),
        (set_links(9, &[99]), |e| {
            matches!(e, OpError::UnknownSystem(99))
        }),
        (set_links(99, &[3]), |e| {
            matches!(e, OpError::UnknownSystem(99))
        }),
        (set_flags(Vec::new()), |e| matches!(e, OpError::NoEntries)),
        (
            set_flags(vec![
                (3, link(false, None, &[0])),
                (3, FeLinkFlags::default()),
            ]),
            |e| matches!(e, OpError::DuplicateSystem(3)),
        ),
        (set_flags(vec![(9, link(true, Some(100), &[]))]), |e| {
            matches!(e, OpError::FeLinkIdOutOfRange(100, 100))
        }),
        (set_flags(vec![(3, link(false, None, &[0, 200]))]), |e| {
            matches!(e, OpError::FeLinkIdOutOfRange(200, 100))
        }),
    ];
    for (op, expected) in cases {
        let label = format!("{op:?}");
        let error = session.apply(op).expect_err(&label);
        assert!(expected(&error), "{label}: {error:?}");
    }
    assert_eq!(
        session
            .apply(set_links(10, &[3]))
            .expect_err("no zone")
            .to_string(),
        "system 10 anchors no fallen empire zone"
    );
    assert!(!session.is_dirty());

    let mut every_id = Vec::new();
    for n in 0..fe_link::MOST_IDS {
        every_id.push((u32::from(n) % 14, link(true, Some(n), &[])));
    }
    let mut taken = PAINTED.open();
    for (i, (_, flags)) in every_id.iter().enumerate() {
        let id = (i % 14) as u32;
        if taken.graph().systems[&id].fe_link.id.is_none() {
            taken
                .apply(set_flags(vec![(id, flags.clone())]))
                .expect("take an id");
        }
    }
    assert_eq!(fe_link::next_free_id(taken.graph()), Some(14));
    let mut all_taken = from_scenario_text(hundred_anchors());
    assert_eq!(fe_link::next_free_id(all_taken.graph()), None);
    let error = all_taken
        .apply(set_links(100, &[0]))
        .expect_err("no id left");
    assert!(matches!(error, OpError::FeLinkIdsExhausted), "{error}");
    assert_eq!(
        error.to_string(),
        "every fallen empire connection id is taken"
    );
}

/// A scenario whose systems 0 to 99 take the ids 0 to 99, with system 100 anchoring a
/// zone nobody links to yet.
fn hundred_anchors() -> String {
    let mut text = String::from("static_galaxy_scenario = {\n\tname = \"full\"\n");
    for n in 0..fe_link::MOST_IDS {
        text.push_str(&format!(
            "\tsystem = {{ id = \"{n}\" position = {{ x = {} y = 0 }} effect = {{ set_star_flag = painted_galaxy_fe_custom_connection_id_{n} }} }}\n",
            i32::from(n) * 5 - 250
        ));
    }
    text.push_str(
        "\tsystem = { id = \"100\" position = { x = 0 y = 300 } effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_s } }\n}\n",
    );
    text
}

#[test]
fn the_flag_op_reaches_the_states_the_mod_reads_oddly_and_undoes_them_exactly() {
    let mut session = PAINTED.open();
    let result = session
        .apply(set_flags(vec![(9, link(true, None, &[]))]))
        .expect("the custom flag with no id");
    assert_eq!(
        result.entry.description,
        "Set the fallen empire connections of 1 system"
    );
    assert_eq!(result.inverse, set_flags(vec![(9, FeLinkFlags::default())]));
    assert_eq!(session.graph().systems[&9].fe_link, link(true, None, &[]));
    assert!(common::text(&session).contains(
        "set_star_flag = painted_galaxy_fe_spawn_preferred set_star_flag = painted_galaxy_fe_custom_connections } }"
    ));
    common::snapshot(
        "flags_9_custom_without_id",
        &plain_report(&session, &result),
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());

    // An id and a link on a system with no effect block write the block; the id
    // without the custom flag takes nothing, so the link dangles.
    let result = session
        .apply(set_flags(vec![
            (11, link(false, Some(3), &[5])),
            (10, link(true, None, &[])),
        ]))
        .expect("odd flags on two systems");
    assert_eq!(
        result.entry.description,
        "Set the fallen empire connections of 2 systems"
    );
    assert!(common::text(&session).contains(
        "system = { id = \"11\" position = { x = -150 y = -30 } effect = { set_star_flag = painted_galaxy_fe_custom_connection_id_3 set_star_flag = painted_galaxy_fe_custom_connection_to_5 } }"
    ));
    assert!(common::text(&session).contains(
        "name = \"Void\" effect = { set_star_flag = painted_galaxy_fe_custom_connections } }"
    ));
    assert_eq!(
        session.graph().systems[&11].fe_link,
        link(false, Some(3), &[5])
    );
    assert_eq!(fe_link::next_free_id(session.graph()), Some(0));
    session
        .apply(set_flags(vec![(11, FeLinkFlags::default())]))
        .expect("clearing the flags takes the block with them");
    assert!(
        common::text(&session).contains("system = { id = \"11\" position = { x = -150 y = -30 } }")
    );
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
    round_trip(
        PAINTED.open(),
        set_flags(vec![(11, link(false, Some(3), &[5, 5, 1]))]),
    );
}

#[test]
fn flags_on_their_own_lines_are_taken_out_and_put_back_line_by_line() {
    let multi_line = "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = painted_galaxy_fe_custom_connection_to_4
			set_star_flag = painted_galaxy_fe_spawn
			set_star_flag = painted_galaxy_fe_custom_connections
			set_star_flag = painted_galaxy_fe_spawn_distance_50
			set_star_flag = painted_galaxy_fe_custom_connection_id_4
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
		effect = { set_star_flag = painted_galaxy_fe_custom_connection_to_4 }
	}
	system = {
		id = \"9\"
		position = { x = 5 y = 6 }
	}
}
";
    let mut session = from_scenario_text(multi_line);
    assert_eq!(
        session.graph().systems[&7].fe_link,
        link(true, Some(4), &[4])
    );
    assert_eq!(session.graph().systems[&8].fe_link, link(false, None, &[4]));
    assert_eq!(fe_link::next_free_id(session.graph()), Some(0));
    session.apply(set_links(7, &[9])).expect("relink to 9");
    assert_eq!(
        common::text(&session),
        "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = painted_galaxy_fe_spawn
			set_star_flag = painted_galaxy_fe_spawn_distance_50
			set_star_flag = painted_galaxy_fe_custom_connections
			set_star_flag = painted_galaxy_fe_custom_connection_id_4
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
	}
	system = {
		id = \"9\"
		position = { x = 5 y = 6 }
		effect = { set_star_flag = painted_galaxy_fe_custom_connection_to_4 }
	}
}
"
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::text(&session), multi_line);
}
