//! Paint a Galaxy's custom connections as rules: how the flags parse, what the validator
//! says about each way a connection can go wrong, and that a fit keeps a linked zone.

use sgf_core::format::scenario::fe_link::{self, FeLinkFlags};
use sgf_core::format::scenario::fe_zone;
use sgf_core::ops::Op;
use sgf_core::ops::rules::fe_zone as placement;
use sgf_core::validate::IssueCode;

use crate::common;
use common::coded;
use common::fixture::{PAINTED, from_scenario_text};
use common::paint::PREFERRED_FLAG;

fn set_links(anchor: u32, linked: &[u32]) -> Op {
    Op::SetFeLinks {
        anchor,
        linked: linked.to_vec(),
    }
}

fn link(custom: bool, id: Option<u8>, to: &[u8]) -> FeLinkFlags {
    FeLinkFlags {
        custom,
        id,
        to: to.to_vec(),
    }
}

#[test]
fn the_flags_parse_as_the_mod_reads_them() {
    let parsed = |flags: &[&str]| fe_link::parse(flags.iter().copied());
    assert_eq!(parsed(&[]), FeLinkFlags::default());
    assert_eq!(
        parsed(&[
            "painted_galaxy_fe_custom_connection_to_7",
            "painted_galaxy_fe_spawn",
            "painted_galaxy_fe_custom_connection_id_12",
            "painted_galaxy_fe_custom_connections",
            "painted_galaxy_fe_custom_connection_to_3",
            "painted_galaxy_fe_custom_connection_id_2",
            "painted_galaxy_fe_custom_connection_to_7",
            "painted_galaxy_fe_custom_connection_to_99",
        ]),
        link(true, Some(12), &[3, 7, 99])
    );
    assert_eq!(
        parsed(&[
            "painted_galaxy_fe_custom_connection_id_x",
            "painted_galaxy_fe_custom_connection_id_100",
            "painted_galaxy_fe_custom_connection_id_-1",
            "painted_galaxy_fe_custom_connection_id_+1",
            "painted_galaxy_fe_custom_connection_id_01",
            "painted_galaxy_fe_custom_connection_to_",
            "painted_galaxy_fe_custom_connection_to_300",
            "painted_galaxy_fe_custom_connection",
            "painted_galaxy_fe_custom_connectionsx",
        ]),
        FeLinkFlags::default()
    );
    for flag in [
        "painted_galaxy_fe_custom_connections",
        "painted_galaxy_fe_custom_connection_id_0",
        "painted_galaxy_fe_custom_connection_id_99",
        "painted_galaxy_fe_custom_connection_to_42",
    ] {
        assert!(fe_link::is_link_flag(flag), "{flag}");
        assert!(!fe_zone::is_zone_flag(flag), "{flag}");
    }
    for flag in [
        "painted_galaxy_fe_custom_connection_id_x",
        "painted_galaxy_fe_custom_connection_id_100",
        "painted_galaxy_fe_custom_connection_id_01",
        "painted_galaxy_fe_custom_connection_to_",
        "painted_galaxy_fe_spawn",
        "painted_galaxy_wormhole_1",
        "empire_cluster",
    ] {
        assert!(!fe_link::is_link_flag(flag), "{flag}");
    }
    assert_eq!(
        fe_link::flags(&link(true, Some(5), &[9, 2, 9])),
        [
            "painted_galaxy_fe_custom_connections",
            "painted_galaxy_fe_custom_connection_id_5",
            "painted_galaxy_fe_custom_connection_to_2",
            "painted_galaxy_fe_custom_connection_to_9",
        ]
    );
    assert!(fe_link::flags(&FeLinkFlags::default()).is_empty());
    assert_eq!(
        fe_link::flags(&link(false, None, &[0])),
        ["painted_galaxy_fe_custom_connection_to_0"]
    );
    assert_eq!(
        parsed(&[
            "empire_cluster",
            "painted_galaxy_fe_spawn",
            "painted_galaxy_fe_custom_connection_to_2",
            "painted_galaxy_fe_custom_connections",
            "painted_galaxy_fe_custom_connection_id_0",
            "painted_galaxy_fe_custom_connection_id_1",
            "painted_galaxy_fe_custom_connection_to_0",
        ]),
        link(true, Some(0), &[0, 2])
    );
    assert_eq!(
        parsed(&["painted_galaxy_fe_spawn", "painted_galaxy_wormhole_1"]),
        FeLinkFlags::default()
    );
}

#[test]
fn the_validator_names_every_way_a_connection_can_go_wrong() {
    let session = from_scenario_text(
        "static_galaxy_scenario = {
	name = \"links\"
	system = { id = \"1\" name = \"Taker\" position = { x = 0 y = 0 } effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_e set_star_flag = painted_galaxy_fe_custom_connections set_star_flag = painted_galaxy_fe_custom_connection_id_0 } }
	system = { id = \"2\" name = \"Near\" position = { x = -40 y = 60 } effect = { set_star_flag = painted_galaxy_fe_custom_connection_to_0 } }
	system = { id = \"3\" name = \"Far\" position = { x = 200 y = 0 } effect = { set_star_flag = painted_galaxy_fe_custom_connection_to_0 } }
	system = { id = \"4\" name = \"Rival\" position = { x = 0 y = 200 } effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_s set_star_flag = painted_galaxy_fe_custom_connections set_star_flag = painted_galaxy_fe_custom_connection_id_0 } }
	system = { id = \"5\" name = \"Dangler\" position = { x = 100 y = 100 } effect = { set_star_flag = painted_galaxy_fe_custom_connection_to_7 } }
	system = { id = \"6\" name = \"No Id\" position = { x = -200 y = -200 } effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_w set_star_flag = painted_galaxy_fe_custom_connections } }
	system = { id = \"7\" name = \"No Zone\" position = { x = 200 y = 200 } effect = { set_star_flag = painted_galaxy_fe_custom_connections set_star_flag = painted_galaxy_fe_custom_connection_id_1 } }
	system = { id = \"8\" name = \"Unlinked\" position = { x = -200 y = 200 } effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_n set_star_flag = painted_galaxy_fe_custom_connections set_star_flag = painted_galaxy_fe_custom_connection_id_9 } }
	system = { id = \"9\" name = \"Plain\" position = { x = 100 y = -100 } effect = { set_star_flag = painted_galaxy_fe_custom_connection_id_1 } }
}
",
    );
    let issues = session.validate();
    let messages = |code: IssueCode| -> Vec<(String, Vec<u32>)> {
        coded(&issues, code)
            .iter()
            .map(|issue| (issue.message.clone(), issue.systems.clone()))
            .collect()
    };
    assert_eq!(
        messages(IssueCode::FeLinkIsolated),
        [
            (
                "No Id takes custom connections for its fallen empire zone but no system links to it. The mod will lay no hyperlanes to the fallen empire.".to_owned(),
                vec![6]
            ),
            (
                "No Zone takes custom connections but anchors no fallen empire zone.".to_owned(),
                vec![7]
            ),
            (
                "Unlinked takes custom connections for its fallen empire zone but no system links to it. The mod will lay no hyperlanes to the fallen empire.".to_owned(),
                vec![8]
            ),
        ]
    );
    assert_eq!(
        messages(IssueCode::FeLinkDangling),
        [(
            "Dangler links to fallen empire connection 7, which no zone takes.".to_owned(),
            vec![5]
        )]
    );
    assert_eq!(
        messages(IssueCode::FeLinkShared),
        [
            (
                "Taker shares fallen empire connection 0 with Rival. The systems linked to it join both fallen empires.".to_owned(),
                vec![1, 4]
            ),
            (
                "Rival shares fallen empire connection 0 with Taker. The systems linked to it join both fallen empires.".to_owned(),
                vec![4, 1]
            ),
        ]
    );
    // Near stands 60 from Taker's centre at (-40, 0) but 244 from Rival's at (0, 240).
    assert_eq!(
        messages(IssueCode::FeLinkFar),
        [
            (
                "Near is 184 from the fallen empire zone it links to. The mod lays the hyperlane anyway.".to_owned(),
                vec![2, 4]
            ),
            (
                "Far is 240 from the fallen empire zone it links to. The mod lays the hyperlane anyway.".to_owned(),
                vec![3, 1]
            ),
            (
                "Far is 312 from the fallen empire zone it links to. The mod lays the hyperlane anyway.".to_owned(),
                vec![3, 4]
            ),
        ]
    );
    for issue in &issues {
        assert_eq!(issue.severity, issue.code.severity(), "{issue:?}");
    }
}

#[test]
fn a_fit_keeps_an_automatic_zone_that_systems_are_linked_to() {
    let mut session = PAINTED.open_edited(&[(PREFERRED_FLAG, "")]);
    let sites = placement::sites(session.graph());
    assert_eq!(placement::fit(&sites, 0), [(9, None)]);

    session
        .apply(set_links(9, &[3]))
        .expect("link Sol to the automatic zone");
    let sites = placement::sites(session.graph());
    assert!(
        placement::fit(&sites, 0).is_empty(),
        "a linked zone is the map author's: {:?}",
        placement::fit(&sites, 0)
    );
    let filled = placement::fit(&sites, usize::MAX);
    assert!(filled.iter().all(|(id, _)| *id != 9), "{filled:?}");
    let issues = session.validate();
    let blocked = coded(&issues, IssueCode::FeZoneBlocked);
    assert!(blocked.is_empty(), "{blocked:?}");

    session
        .apply(Op::MoveSystem {
            system: 7,
            x: 10.0,
            y: -210.0,
        })
        .expect("move Ingress into the ring");
    let issues = session.validate();
    let blocked = coded(&issues, IssueCode::FeZoneBlocked);
    assert_eq!(blocked.len(), 1);
    assert!(
        !blocked[0].message.contains("Recompute"),
        "a recompute would keep the linked zone: {}",
        blocked[0].message
    );
}
