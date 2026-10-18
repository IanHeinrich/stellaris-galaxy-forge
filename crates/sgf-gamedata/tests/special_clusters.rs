//! Clusters of the Special menu on the real install: the table read against the install's
//! chains, a cluster offered once every system of it can be built, a roll that stays inside
//! the chain's ranges, the Junk Ratlings and the Legendary Leader's sites added to the 4.5
//! sample as one step that undoes byte for byte, their cards, and a cluster added to a
//! scenario as statements.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::document::Document;
use sgf_core::ops::{BodySpec, Op, OpError};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::body_effects::LeftOut;
use sgf_gamedata::generate::{ClusterRoll, ForSaveError, cluster_op, roll_cluster, special_op};
use sgf_gamedata::layouts::{CLUSTERS, Eligibility, eligibility};
use sgf_gamedata::menu::{menu_clusters, special_layouts};
use sgf_gamedata::summary::{cluster_picks, layout_summary};

use common::prepare::current;
use common::{INSTALL, SPOT, members, names, open_4_5, open_4_5_edited, written};

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.4-early.scenario.txt"
);
const SAMPLE_3_4: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/3.4.sav");
const RATLINGS: &str = "junk_ratlings";
const LEADER: &str = "legendary_leader";
const SOL: &str = "sol_neighbours";

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

/// The Ratlings, the Legendary Leader's sites and Sol with its binary and trinary neighbours
/// are offered. Each home is offered alone too, under the label its cluster's entry gives it,
/// its card naming the systems it comes without when its cluster is offered, and the members
/// no galaxy places alone are offered only through their cluster.
#[test]
fn a_cluster_is_offered_once_every_system_of_it_can_be_built() {
    let Some(gd) = install() else {
        return;
    };
    let offered: Vec<&str> = menu_clusters(gd).iter().map(|c| c.key).collect();
    assert_eq!(offered, [RATLINGS, LEADER, SOL]);
    let sirius = gd
        .initializers
        .get("sol_neighbor_t2_no_guaranteed_colony")
        .expect("Sirius");
    assert_eq!(eligibility(gd, sirius), Eligibility::Special);

    let session = open_4_5();
    let keys: BTreeSet<String> = special_layouts(gd, &session)
        .into_iter()
        .map(|layout| layout.key)
        .collect();
    let labels: Vec<(String, String)> = special_layouts(gd, &session)
        .into_iter()
        .map(|layout| (layout.key, layout.label))
        .collect();
    for (home, heads_offered, label) in [
        ("ratling_1_1", true, "Junk Ratlings home"),
        (
            "legendary_leader_start_site",
            true,
            "Legendary Leader crash site",
        ),
        ("sol_system_initializer", true, "Sol"),
    ] {
        assert!(keys.contains(home), "{home} is not offered alone");
        assert!(
            labels.contains(&(home.to_owned(), label.to_owned())),
            "{home} is listed as {label}"
        );
        let card = layout_summary(gd, home, &session).expect(home);
        assert_eq!(
            card.comes_without.contains(&LeftOut::ClusterSystems),
            heads_offered,
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
    let op = cluster_op(gd, &session, 3, SPOT, RATLINGS, true, &[]).expect("the op");
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
    let op = cluster_op(gd, &session, 3, SPOT, RATLINGS, true, &[]).expect("the op");
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
    let op = cluster_op(gd, &session, 5, SPOT, LEADER, true, &[]).expect("the op");
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

/// A scenario's systems run their own script: the Ratlings' partners come from
/// `neighbor_system`, which places nothing in a static galaxy, so the add writes all three; the
/// Legendary Leader's start site creates its sites with `spawn_system`, so its cluster comes to
/// its home alone and is not offered, and the start site's card names no systems it comes
/// without.
#[test]
fn a_scenario_takes_a_cluster_as_statements_less_what_its_home_creates() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = open_scenario();
    let offered: Vec<String> = cluster_picks(gd, &session)
        .into_iter()
        .map(|pick| pick.cluster.key)
        .collect();
    assert_eq!(offered, [RATLINGS, SOL]);
    assert!(matches!(
        roll_cluster(gd, &session, 3, (0.0, 0.0), LEADER),
        Err(ForSaveError::UnknownCluster(_))
    ));
    let site = layout_summary(gd, "legendary_leader_start_site", &session).expect("its card");
    assert!(!site.comes_without.contains(&LeftOut::ClusterSystems));
    let ratlings = layout_summary(gd, "ratling_1_1", &session).expect("its card");
    assert!(ratlings.comes_without.contains(&LeftOut::ClusterSystems));

    let held: Vec<u32> = session.graph().systems.keys().copied().collect();
    let op = cluster_op(gd, &session, 3, (0.0, 0.0), RATLINGS, true, &[]).expect("the op");
    assert_eq!(names(&op), ["AddSystems", "AddLanePairs"]);
    session.apply(op).expect("the add");
    let mut written: Vec<&str> = session
        .graph()
        .systems
        .values()
        .filter(|s| !held.contains(&s.id))
        .map(|s| s.initializer.as_str())
        .collect();
    written.sort_unstable();
    assert_eq!(written, ["ratling_1_1", "ratling_1_2", "ratling_1_3"]);
    session.undo().expect("undo").expect("the add");
    assert_eq!(current(&session), session.doc().original(), "undo");
}

/// Joins lay lanes from the cluster's systems to those the save holds, counted in the undo
/// text; a join naming no system refuses the add before any op is built, and so does a place
/// too near a system. The roll says why it refuses that place.
#[test]
fn a_cluster_add_refuses_a_bad_join_or_place() {
    let Some(gd) = install() else {
        return;
    };
    let session = open_4_5();
    let op =
        cluster_op(gd, &session, 3, SPOT, RATLINGS, true, &[(0, 169), (2, 169)]).expect("the op");
    let Op::Batch { description, .. } = &op else {
        unreachable!()
    };
    assert_eq!(
        description,
        "Added the Junk Ratlings: 3 systems and 4 lanes"
    );

    for joins in [[(0, 4_000_000)], [(3, 169)]] {
        let refused = cluster_op(gd, &session, 3, SPOT, RATLINGS, true, &joins);
        assert!(
            matches!(
                refused,
                Err(ForSaveError::Refused(OpError::UnknownSystem(_)))
            ),
            "{joins:?}: {refused:?}"
        );
    }
    let held = &session.graph().systems[&169];
    let on_it = (held.x, held.y);
    let refused = match cluster_op(gd, &session, 3, on_it, RATLINGS, true, &[]) {
        Err(ForSaveError::Refused(refused @ OpError::TooClose { .. })) => refused,
        other => panic!("{other:?}"),
    };
    let roll = roll_cluster(gd, &session, 3, on_it, RATLINGS)
        .expect("the roll")
        .view(gd);
    assert_eq!(roll.members[0].refused, Some(refused.to_string()));
    assert!(matches!(
        cluster_op(gd, &session, 3, SPOT, "nope", true, &[]),
        Err(ForSaveError::UnknownCluster(_))
    ));
}

/// An add whose join names a system gone by the time it is applied is refused whole: the
/// cluster's statements and the special system's go with it.
#[test]
fn a_join_to_a_system_gone_refuses_the_whole_add() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = open_scenario();
    let held = *session.graph().systems.keys().next().expect("a system");
    let cluster = cluster_op(gd, &session, 3, (0.0, 0.0), RATLINGS, true, &[(0, held)])
        .expect("the cluster's op");
    let special = special_op(
        gd,
        &session,
        3,
        (0.0, 0.0),
        "trappist_initializer",
        true,
        &[held],
    )
    .expect("the special system's op");
    session
        .apply(Op::RemoveSystem { system: held })
        .expect("the removal");
    let before = current(&session);
    for op in [cluster, special] {
        let refused = session.apply(op).expect_err("the join names no system");
        assert!(
            matches!(refused, OpError::UnknownSystem(id) if id == held),
            "{refused:?}"
        );
        assert_eq!(current(&session), before, "nothing applied");
    }
}

/// A special system joined to a system the save holds is one step with its lane, which the
/// undo text counts. In a scenario it is a statement taking the id the scenario hands out
/// next and the lane to it, described as a statement's add is, its lanes counted the same.
#[test]
fn a_special_system_goes_in_with_its_joins() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = open_4_5();
    let op =
        special_op(gd, &session, 4, SPOT, "trappist_initializer", false, &[169]).expect("the op");
    let Op::Batch { description, .. } = &op else {
        panic!("{op:?}")
    };
    assert!(description.ends_with("and 1 lane"), "{description}");
    session.apply(op).expect("the add");
    let lanes = &session.graph().systems[&601].lanes;
    assert!(lanes.iter().any(|lane| lane.to == 169), "{lanes:?}");

    let mut scenario = open_scenario();
    let held = *scenario.graph().systems.keys().next().expect("a system");
    let id = scenario.next_system_ids(1).expect("an id")[0];
    let at = (12.5, -40.0);
    let op =
        special_op(gd, &scenario, 4, at, "trappist_initializer", true, &[held]).expect("the op");
    let Op::Batch { description, ops } = &op else {
        panic!("{op:?}")
    };
    assert_eq!(
        description,
        &format!("Added system #{id} at (12.5, -40) with 1 lane")
    );
    let [Op::AddSystems { systems }, Op::AddLanePairs { lanes }] = ops.as_slice() else {
        panic!("{ops:?}")
    };
    assert_eq!(systems.len(), 1);
    assert_eq!(systems[0].system, id);
    assert_eq!(
        systems[0].initializer.as_deref(),
        Some("trappist_initializer")
    );
    assert_eq!((lanes[0].a, lanes[0].b), (id, held));
    scenario.apply(op).expect("the add");
    let added = &scenario.graph().systems[&id];
    assert!(added.lanes.iter().any(|lane| lane.to == held));
}

/// The names the roll previews are the ones the add writes: the layouts' fixed names while
/// the galaxy has none of them, and names from the pool once it holds them.
#[test]
fn a_cluster_roll_names_its_systems_as_the_add_writes_them() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = open_4_5();
    for round in 0..2 {
        let fits = |at: &(f64, f64)| {
            roll_cluster(gd, &session, 5, *at, LEADER)
                .is_ok_and(|roll| roll.refused.iter().all(Option::is_none))
        };
        let at = [
            SPOT,
            (0.0, -300.0),
            (300.0, 0.0),
            (200.0, 200.0),
            (-200.0, -200.0),
        ]
        .into_iter()
        .find(fits)
        .expect("a free spot");
        let roll = roll_cluster(gd, &session, 5, at, LEADER)
            .expect("the roll")
            .view(gd);
        let op = cluster_op(gd, &session, 5, at, LEADER, true, &[]).expect("the op");
        let written: Vec<String> = members(&op)
            .into_iter()
            .filter_map(|op| match op {
                Op::AddSystemFromSpec { spec } => Some(spec.name.clone()),
                _ => None,
            })
            .collect();
        let shown: Vec<String> = written
            .iter()
            .map(|name| gd.loc.name(name).unwrap_or_else(|| name.clone()))
            .collect();
        let rolled: Vec<String> = roll.members.iter().map(|m| m.name.clone()).collect();
        assert_eq!(rolled, shown, "round {round}");
        let fixed = written.iter().all(|name| name.starts_with("NAME_"));
        assert_eq!(fixed, round == 0, "round {round}: {written:?}");
        session.apply(op).expect("the add");
    }
}

/// A save before Stellaris 4.0 takes no added system, and a cluster's add is refused as its
/// save queries are.
#[test]
fn a_save_before_4_0_takes_no_cluster() {
    let Some(gd) = install() else {
        return;
    };
    let doc = Document::load(SAMPLE_3_4).expect("load the 3.4 sample");
    let session = Session::from_document(Some(SAMPLE_3_4.into()), doc).expect("open it");
    assert!(matches!(
        cluster_op(gd, &session, 3, (0.0, 0.0), RATLINGS, true, &[]),
        Err(ForSaveError::Refused(_))
    ));
}

/// The last Ratling system removed is read back as a spec that holds its junk heap
/// pictures and its `prevent_anomaly` bits, and that spec, applied as an op of its own rather
/// than through the history, writes the system as it was.
#[test]
fn a_removed_ratling_system_reads_back_with_its_pictures_and_bits() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = without_ratling_targets();
    let op = cluster_op(gd, &session, 3, SPOT, RATLINGS, true, &[]).expect("the op");
    session.apply(op).expect("the add");
    let added = current(&session);
    let last = session
        .graph()
        .systems
        .values()
        .filter(|s| s.added)
        .map(|s| s.id)
        .max()
        .expect("an added system");
    let removed = session
        .apply(Op::RemoveSystem { system: last })
        .expect("the removal");
    let spec = members(&removed.inverse)
        .into_iter()
        .find_map(|op| match op {
            Op::AddSystemFromSpec { spec } => Some(spec.clone()),
            _ => None,
        })
        .expect("the inverse re-adds the system from a spec");
    let bodies: Vec<&BodySpec> = spec
        .planets
        .iter()
        .flat_map(|planet| std::iter::once(planet).chain(&planet.moons))
        .collect();
    let heaps: Vec<&&BodySpec> = bodies
        .iter()
        .filter(|body| body.picture.as_deref() == Some("pc_junkheap"))
        .collect();
    assert!(!heaps.is_empty(), "a junk heap: {bodies:#?}");
    assert!(heaps.iter().all(|body| body.prevent_anomaly));
    session
        .apply_inverse(removed.inverse)
        .expect("the spec added again");
    assert_eq!(
        current(&session),
        added,
        "the read-back writes the system as it was"
    );
}
