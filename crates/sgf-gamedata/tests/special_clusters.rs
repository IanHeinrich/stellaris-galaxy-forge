//! Clusters of the Special menu on the real install: the table read against the install's
//! chains, a cluster offered once every system of it can be built, a roll that stays inside
//! the chain's ranges, the Junk Ratlings and the Legendary Leader's sites added to the 4.5
//! sample as one step that undoes byte for byte, their cards, and a cluster added to a
//! scenario as statements.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::document::Document;
use sgf_core::ops::Op;
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::body_effects::LeftOut;
use sgf_gamedata::generate::{ClusterRoll, cluster_op, roll_cluster};
use sgf_gamedata::layouts::{CLUSTERS, Eligibility, Unsupported, eligibility};
use sgf_gamedata::menu::{menu_clusters, special_layouts};
use sgf_gamedata::summary::{cluster_picks, layout_summary};

use common::prepare::current;
use common::{INSTALL, SPOT, names, open_4_5, open_4_5_edited, written};

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.4-early.scenario.txt"
);
const RATLINGS: &str = "junk_ratlings";
const LEADER: &str = "legendary_leader";

/// The 4.5 sample with its Ratlings' six global event targets renamed, so that an added
/// cluster takes them.
fn without_ratling_targets() -> Session {
    open_4_5_edited(|gamestate| {
        *gamestate = gamestate.replace("\tname=\"ratling_", "\tname=\"was_ratling_");
    })
}

fn open_scenario() -> Session {
    let doc = Document::load(SCENARIO).expect("load the scenario");
    Session::from_document(Some(SCENARIO.into()), doc).expect("open the scenario")
}

/// The distance between two members of `roll`.
fn apart(roll: &ClusterRoll, a: u32, b: u32) -> f64 {
    let (a, b) = (&roll.members[a as usize], &roll.members[b as usize]);
    (a.x - b.x).hypot(a.y - b.y)
}

/// Apply `op`, snapshot what it wrote as `name`, and undo it back to the original bytes.
fn applied(session: &mut Session, name: &str, op: Op) -> String {
    let result = session.apply(op).expect("the add");
    let text = written(session);
    let report = format!("{}\n{text}", result.entry.description);
    insta::with_settings!({snapshot_path => "snapshots/special_clusters", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(name, report);
    });
    session.undo().expect("undo").expect("the add");
    assert_eq!(current(session), session.doc().original(), "{name}: undo");
    text
}

fn install() -> Option<&'static GameData> {
    INSTALL.as_ref()
}

#[test]
fn every_system_of_a_cluster_is_in_its_homes_chain() {
    let Some(gd) = install() else {
        return;
    };
    for cluster in &CLUSTERS {
        let layouts: Vec<&str> = cluster.layouts().collect();
        for layout in &layouts {
            assert!(gd.initializers.get(layout).is_some(), "{layout}");
        }
        for (from, to) in cluster.links() {
            let spawning = gd.initializers.get(from).expect(from);
            assert!(
                spawning.spawns.iter().any(|spawned| spawned == to),
                "{}: {from} spawns no {to}",
                cluster.key
            );
        }
        for member in cluster.members {
            let ancestors = gd.initializers.ancestors(member);
            assert!(
                ancestors.iter().any(|init| init.name == cluster.home),
                "{}: {member} is not in {}'s chain",
                cluster.key,
                cluster.home
            );
            let at = layouts.iter().position(|l| l == member).expect(member);
            let led_from_before = cluster.links().iter().any(|(from, to)| {
                to == member
                    && layouts
                        .iter()
                        .position(|l| l == from)
                        .is_some_and(|f| f < at)
            });
            assert!(
                led_from_before,
                "{}: no lane leads to {member} from a system placed before it",
                cluster.key
            );
        }
    }
}

/// The Ratlings and the Legendary Leader's sites are offered; Sol's binary and trinary
/// neighbours keep its cluster out. Each home is offered alone too, its card naming the
/// systems it comes without, and the members no galaxy places alone are offered only
/// through their cluster.
#[test]
fn a_cluster_is_offered_once_every_system_of_it_can_be_built() {
    let Some(gd) = install() else {
        return;
    };
    let offered: Vec<&str> = menu_clusters(gd).iter().map(|c| c.key).collect();
    assert_eq!(offered, [RATLINGS, LEADER]);
    let sirius = gd
        .initializers
        .get("sol_neighbor_t2_no_guaranteed_colony")
        .expect("Sirius");
    assert_eq!(
        eligibility(gd, sirius),
        Eligibility::Unsupported(Unsupported::MultiStar)
    );

    let session = open_4_5();
    let keys: BTreeSet<String> = special_layouts(gd, &session)
        .into_iter()
        .map(|layout| layout.key)
        .collect();
    for home in [
        "ratling_1_1",
        "legendary_leader_start_site",
        "sol_system_initializer",
    ] {
        assert!(keys.contains(home), "{home} is not offered alone");
        let card = layout_summary(gd, home, &session).expect(home);
        assert!(
            card.comes_without.contains(&LeftOut::ClusterSystems),
            "{home}"
        );
    }
    for member in ["ratling_1_2", "ratling_1_3", "legendary_leader_1st_site"] {
        assert!(!keys.contains(member), "{member} is offered alone");
    }
}

#[test]
fn a_cluster_rolls_the_same_for_a_seed_inside_its_chains_ranges() {
    let Some(gd) = install() else {
        return;
    };
    let session = open_4_5();
    for (key, min, max) in [(RATLINGS, 0.0, 50.0), (LEADER, 10.0, 30.0)] {
        let mut places = BTreeSet::new();
        for seed in 0..12 {
            let roll = roll_cluster(gd, &session, seed, SPOT, key)
                .expect(key)
                .view(gd);
            let again = roll_cluster(gd, &session, seed, SPOT, key)
                .expect(key)
                .view(gd);
            assert_eq!(roll, again, "{key} from seed {seed}");
            assert_eq!((roll.members[0].x, roll.members[0].y), SPOT);
            for &(from, to) in &roll.lanes {
                let d = apart(&roll, from, to);
                assert!((min..=max).contains(&d), "{key} seed {seed}: {d}");
            }
            for member in &roll.members {
                assert_eq!(member.refused, None, "{key} seed {seed}: {}", member.name);
            }
            places.insert(format!("{:.3},{:.3}", roll.members[1].x, roll.members[1].y));
        }
        assert!(places.len() > 6, "{key}: a new seed places it again");
    }
}

/// Written as distar.295 leaves them: the home with a lane to each partner, every planet's
/// junk heap picture and its flags, carrier flags among them, and the six global targets
/// the Ratlings' events find them by.
#[test]
fn the_junk_ratlings_go_in_as_one_step_with_their_lanes_pictures_flags_and_targets() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = without_ratling_targets();
    let op = cluster_op(gd, &session, 3, SPOT, RATLINGS, true).expect("the op");
    let ops = names(&op);
    assert_eq!(ops.iter().filter(|n| **n == "AddSystemFromSpec").count(), 3);
    assert_eq!(ops.iter().filter(|n| **n == "AddEventTarget").count(), 6);
    assert_eq!(ops.last(), Some(&"AddLanePairs"));
    let Op::Batch { description, .. } = &op else {
        unreachable!()
    };
    assert_eq!(
        description,
        "Added the Junk Ratlings: 3 systems and 2 lanes"
    );

    let text = applied(&mut session, "junk_ratlings", op);
    for written in [
        "picture=\"pc_junkheap\"",
        "ratling_home_system=",
        "ratling_planet=",
        "ruinous_core_planet=",
        "lost_encampment_planet=",
        "name=\"ratling_capital\"",
        "name=\"ratling_planet_6_tar\"",
    ] {
        assert!(text.contains(written), "{written}");
    }
}

/// The 4.5 sample holds the Ratlings' targets already, so a second cluster leaves them, and
/// the story they start, with the Ratlings there; the card says so.
#[test]
fn a_cluster_whose_targets_the_save_holds_leaves_them_and_its_card_says_so() {
    let Some(gd) = install() else {
        return;
    };
    let session = open_4_5();
    let op = cluster_op(gd, &session, 3, SPOT, RATLINGS, true).expect("the op");
    assert!(!names(&op).contains(&"AddEventTarget"));
    let card = |session: &Session| {
        cluster_picks(gd, session)
            .into_iter()
            .find(|pick| pick.cluster.key == RATLINGS)
            .expect("the Ratlings' card")
    };
    let held = card(&session);
    assert!(held.summary.story_kept_by_existing);
    assert_eq!(held.cluster.phrase, "the Junk Ratlings");
    assert_eq!(
        held.cluster.layouts,
        ["ratling_1_1", "ratling_1_2", "ratling_1_3"]
    );
    assert_eq!(held.cluster.lanes, 2);
    assert!(
        !held
            .summary
            .comes_without
            .contains(&LeftOut::ClusterSystems)
    );
    assert!(
        !card(&without_ratling_targets())
            .summary
            .story_kept_by_existing
    );
}

/// The start site with a lane to each of the three sites paragon.3100 looks for, each site
/// with its flags and the deposits its script rolls at random.
#[test]
fn the_legendary_leaders_sites_go_in_as_one_step() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = open_4_5();
    let op = cluster_op(gd, &session, 5, SPOT, LEADER, true).expect("the op");
    let Op::Batch { description, .. } = &op else {
        unreachable!()
    };
    assert_eq!(
        description,
        "Added the Legendary Leader's sites: 4 systems and 3 lanes"
    );
    let text = applied(&mut session, "legendary_leader", op);
    for written in [
        "legendary_leader_spawn_system=",
        "legendary_leader_1st_system=",
        "legendary_leader_3rd_planet=",
    ] {
        assert!(text.contains(written), "{written}");
    }
}

#[test]
fn a_scenario_takes_a_cluster_as_a_statement_per_system_and_its_lanes() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = open_scenario();
    let before = session.graph().systems.len();
    let op = cluster_op(gd, &session, 3, (0.0, 0.0), LEADER, true).expect("the op");
    assert_eq!(names(&op), ["AddSystems", "AddLanePairs"]);
    session.apply(op).expect("the add");
    let graph = session.graph();
    assert_eq!(graph.systems.len(), before + 4);
    let added: BTreeSet<&str> = graph
        .systems
        .values()
        .map(|s| s.initializer.as_str())
        .filter(|init| init.starts_with("legendary_leader"))
        .collect();
    assert_eq!(added.len(), 4, "{added:?}");
    session.undo().expect("undo").expect("the add");
    assert_eq!(current(&session), session.doc().original(), "undo");
}
