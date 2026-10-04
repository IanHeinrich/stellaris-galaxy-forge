//! The orbit rules on the cases in `testdata/orbit_rules.json`, which the app's tests read
//! too, against its own copies of the rules.
use serde::Deserialize;
use sgf_core::ops::SystemRadii;
use sgf_core::ops::rules::bodies::{Body, find, overlaps, point};

const CASES: &str = include_str!("../../../testdata/orbit_rules.json");

#[derive(Deserialize)]
struct Cases {
    radii: SystemRadii,
    overlap: Vec<OverlapCase>,
    growth: Vec<GrowthCase>,
    inner_floor: Vec<FloorCase>,
}

/// `body` placed among `bodies` and `belts`, and the body it stands on top of.
#[derive(Deserialize)]
struct OverlapCase {
    name: String,
    bodies: Vec<Placed>,
    belts: Vec<f64>,
    body: Placed,
    overlaps: Option<u32>,
}

/// A body `radius` from its parent, or from the centre without one, at `angle` degrees.
#[derive(Deserialize)]
struct Placed {
    id: u32,
    parent: Option<u32>,
    radius: f64,
    angle: f64,
}

#[derive(Deserialize)]
struct GrowthCase {
    name: String,
    reach: f64,
    reached: f64,
    current: f64,
    inner: Option<f64>,
}

#[derive(Deserialize)]
struct FloorCase {
    name: String,
    reach: f64,
    current: f64,
    floor: f64,
}

fn cases() -> Cases {
    serde_json::from_str(CASES).expect("testdata/orbit_rules.json")
}

/// The frame of `placed`, each body's point about its parent's, parents listed first.
fn frame(placed: &[&Placed]) -> Vec<Body> {
    let mut frame: Vec<Body> = Vec::new();
    for p in placed {
        let centre = p.parent.map_or((0.0, 0.0), |parent| {
            find(&frame, parent).expect("a parent listed first").at
        });
        frame.push(Body {
            id: p.id,
            parent: p.parent,
            at: point(centre, p.radius, p.angle),
            orbit: p.radius,
        });
    }
    frame
}

#[test]
fn a_body_overlaps_the_one_the_case_names() {
    for case in cases().overlap {
        let placed: Vec<&Placed> = case.bodies.iter().chain([&case.body]).collect();
        let found: Vec<u32> = overlaps(&frame(&placed), &case.belts)
            .into_iter()
            .filter_map(|o| match (o.lo, o.hi) {
                (id, other) | (other, id) if id == case.body.id => Some(other),
                _ => None,
            })
            .collect();
        assert_eq!(found, Vec::from_iter(case.overlaps), "{}", case.name);
    }
}

#[test]
fn the_inner_radius_grows_as_the_cases_say() {
    let cases = cases();
    for case in cases.growth {
        assert_eq!(
            cases.radii.grown(case.reach, case.reached, case.current),
            case.inner,
            "{}",
            case.name
        );
    }
}

#[test]
fn the_inner_radius_floor_is_as_the_cases_say() {
    let cases = cases();
    for case in cases.inner_floor {
        assert_eq!(
            cases.radii.inner_floor(case.reach, case.current),
            case.floor,
            "{}",
            case.name
        );
    }
}
