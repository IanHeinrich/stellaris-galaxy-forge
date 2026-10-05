//! Where Paint a Galaxy's rule places a fallen empire zone by itself: the candidates it
//! keeps clear of the core, the L-Cluster, the edge and the other zones, and what a fit
//! keeps and replaces.

use sgf_core::format::scenario::fe_zone::{self, FeDirection, FeKind, FeZone, Site};
use sgf_core::ops::rules::fe_zone as placement;

use crate::common;
use common::batch::fe_zones;
use common::diff::snapshot_step;
use common::fixture::PAINTED;
use common::paint::{automatic, open_with_automatic_9, zone};

fn site(id: u32, x: f64, y: f64) -> Site<'static> {
    Site {
        id,
        x,
        y,
        zone: None,
        linked: false,
    }
}
#[test]
fn a_candidate_keeps_clear_of_the_core_the_l_cluster_the_edge_systems_and_other_zones() {
    let e = |id| (id, automatic(FeDirection::E));
    assert_eq!(placement::candidates(&[site(1, 200.0, 0.0)]), [e(1)]);

    // Inside the core guide the first three directions fall short of 130; south-west is
    // the first to clear it.
    assert_eq!(
        placement::candidates(&[site(1, 100.0, 0.0)]),
        [(1, automatic(FeDirection::Sw))]
    );

    // On the L-Cluster guide every direction stays within 100 of it.
    assert_eq!(placement::candidates(&[site(1, -380.0, -420.0)]), []);
    assert_eq!(
        placement::candidates(&[site(1, -320.0, -420.0)]),
        [(1, automatic(FeDirection::S))]
    );

    // East of a system near the west edge lies past 470.
    assert_eq!(
        placement::candidates(&[site(1, -440.0, 0.0)]),
        [(1, automatic(FeDirection::Se))]
    );

    // A system in the ring blocks the direction; the next clear one is taken, and the
    // second system keeps its own centre a zone's width from the first.
    assert_eq!(
        placement::candidates(&[site(1, 200.0, 0.0), site(2, 160.0, 10.0)]),
        [
            (1, automatic(FeDirection::S)),
            (2, automatic(FeDirection::Se))
        ]
    );
    assert_eq!(
        placement::candidates(&[site(1, 200.0, 0.0), site(2, 200.0, 50.0)]),
        [e(1), (2, automatic(FeDirection::Se))]
    );

    // A zone placed by hand is kept, anchors no candidate, and pushes its neighbour's
    // centre away as an accepted one does.
    let placed = zone(FeDirection::E, FeKind::Hive, 40, true);
    let sites = [
        Site {
            zone: Some(&placed),
            ..site(1, 200.0, 0.0)
        },
        site(2, 200.0, 50.0),
    ];
    assert_eq!(
        placement::candidates(&sites),
        [(2, automatic(FeDirection::Se))]
    );
}

fn centre_of(sites: &[Site<'_>], id: u32, zone: &FeZone) -> (f64, f64) {
    let site = sites.iter().find(|site| site.id == id).expect("the anchor");
    fe_zone::centre((site.x, site.y), zone)
}

fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

#[test]
fn fitting_every_candidate_keeps_the_placed_zones_and_replaces_the_automatic_ones() {
    let session = PAINTED.open();
    let sites = placement::sites(session.graph());
    assert_eq!(placement::candidate_count(&sites), 9);
    let entries = placement::fit(&sites, usize::MAX);
    assert_eq!(entries.len(), 9);
    assert_eq!(entries, placement::fit(&sites, 9));
    assert!(entries.iter().all(|(id, zone)| {
        *id != 9 && *id != 12 && zone.as_ref().is_some_and(|z| !z.preferred)
    }));
    let mut ids: Vec<u32> = entries.iter().map(|(id, _)| *id).collect();
    ids.dedup();
    assert_eq!(ids.len(), entries.len());
    snapshot_step(&mut PAINTED.open(), "recompute", fe_zones(entries.clone()));

    let session = open_with_automatic_9();
    let entries = placement::fit(&placement::sites(session.graph()), usize::MAX);
    assert_eq!(
        entries.iter().find(|(id, _)| *id == 9),
        Some(&(9, Some(automatic(FeDirection::E)))),
        "{entries:?}"
    );
    assert_eq!(entries.iter().filter(|(id, _)| *id == 9).count(), 1);
    assert!(entries.iter().all(|(id, _)| *id != 12));

    let mut session = PAINTED.open();
    let entries = placement::fit(&placement::sites(session.graph()), usize::MAX);
    session.apply(fe_zones(entries)).expect("fit applies");
    assert!(
        placement::fit(&placement::sites(session.graph()), usize::MAX).is_empty(),
        "a second pass has nothing left to change"
    );
}

#[test]
fn fitting_a_count_spreads_that_many_candidates_away_from_the_placed_zones() {
    let mut session = PAINTED.open();
    session
        .apply(fe_zones(placement::fit(
            &placement::sites(session.graph()),
            usize::MAX,
        )))
        .expect("fill the map with automatic zones");
    let sites = placement::sites(session.graph());
    let cleared = placement::fit(&sites, 0);
    assert_eq!(cleared.len(), 9, "{cleared:?}");
    assert!(cleared.iter().all(|(_, zone)| zone.is_none()));

    let session = PAINTED.open();
    let sites = placement::sites(session.graph());
    let two = placement::fit(&sites, 2);
    assert_eq!(two, placement::fit(&sites, 2), "deterministic");
    assert_eq!(two.len(), 2, "{two:?}");
    assert!(
        two.iter()
            .all(|(id, zone)| *id != 9 && *id != 12 && zone.is_some())
    );
    let centres: Vec<(f64, f64)> = two
        .iter()
        .map(|(id, zone)| centre_of(&sites, *id, zone.as_ref().unwrap()))
        .collect();
    assert!(
        distance(centres[0], centres[1]) > 60.0,
        "{two:?} lie {} apart",
        distance(centres[0], centres[1])
    );

    // The first pick is the candidate whose centre lies farthest from the placed zone.
    let placed = zone(FeDirection::E, FeKind::Hive, 40, true);
    let sites = [
        Site {
            zone: Some(&placed),
            ..site(1, 200.0, 0.0)
        },
        site(2, 200.0, 100.0),
        site(3, -200.0, 0.0),
        site(4, 200.0, -100.0),
    ];
    assert_eq!(
        placement::fit(&sites, 1),
        [(3, Some(automatic(FeDirection::E)))]
    );

    // With no placed zone the first pick is the candidate farthest from the origin,
    // and the second the one farthest from the first.
    let sites = [
        site(1, 200.0, 0.0),
        site(2, 200.0, 150.0),
        site(3, -200.0, 0.0),
        site(4, -300.0, 50.0),
    ];
    assert_eq!(
        placement::fit(&sites, 2),
        [
            (2, Some(automatic(FeDirection::E))),
            (4, Some(automatic(FeDirection::E)))
        ]
    );
}
