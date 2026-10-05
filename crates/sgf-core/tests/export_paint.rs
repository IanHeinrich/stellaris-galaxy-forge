//! The Paint a Galaxy export profile on the sample save: the committed fixture, the
//! fallen empires it replaces with zones and the links into them.
use sgf_core::VERSION;
use sgf_core::format::scenario::FeLinkFlags;
use sgf_core::format::scenario::fe_zone::{self, FeKind};
use sgf_core::ops::rules::fe_zone as placement;
use sgf_core::projections::galaxy::Galaxy;
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;

use crate::common;
use common::export::{PLAIN_EXPORT, Painted, at_fixture_version, painted};
use common::fixture::EXPORTED_PAINT;
use common::paint::{assert_paint_export_holds_together, left_out};

/// The sample's fallen empires: country id, capital, and the kind the mod's table gives
/// the capital's initializer.
fn sample_fallen_empires(save: &Session) -> Vec<(u32, u32, FeKind)> {
    let mut fallen: Vec<(u32, u32, FeKind)> = save
        .graph()
        .countries
        .iter()
        .filter(|c| c.country_type == "fallen_empire")
        .map(|c| {
            let capital = c.capital_system.expect("a fallen empire's capital");
            let kind = match save.graph().systems[&capital].initializer.as_str() {
                "fallen_1" => FeKind::Materialist,
                "fallen_2" => FeKind::Spiritualist,
                "fallen_machine" => FeKind::Machine,
                other => panic!("{other}"),
            };
            (c.id, capital, kind)
        })
        .collect();
    fallen.sort_unstable_by_key(|f| f.0);
    fallen
}

/// The systems the export adds for the sample's three fallen empires, numbered on from
/// its highest id, 790.
const ANCHORS: [u32; 3] = [791, 792, 793];

#[test]
fn the_paint_a_galaxy_export_of_the_sample_matches_its_fixture_and_the_saves_setup() {
    let Painted { text, report, .. } = painted();
    assert_eq!(
        at_fixture_version(text.as_bytes()),
        EXPORTED_PAINT.bytes(),
        "the fixture is generated: re-export it with `sgf export-scenario --profile paint-a-galaxy` and write its version as 0.0.0"
    );
    assert!(
        text.starts_with(&format!(
            "#\u{200B} created by Stellaris Galaxy Forge {VERSION} (converted from save 4.4-early.sav)
# Systems: 765 · Empire seats: 17 · Nebulae: 9
# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {{
	name = \"4.4-early\"
	priority = 10
	supports_shape = elliptical
"
        )),
        "{}",
        &text[..300]
    );
    assert!(
        text.contains(
            "	num_wormhole_pairs = { min = 0 max = 5 }
	num_wormhole_pairs_default = 1
	num_gateways = { min = 0 max = 5 }
	num_gateways_default = 1
	num_hyperlanes = { min = 0.5 max = 3 }
	num_hyperlanes_default = 0.75
	colonizable_planet_odds = 1.0
	primitive_odds = 1.0
	fallen_empire_max = 3
	marauder_empire_max = 2
"
        ),
        "{}",
        &text[..1200]
    );
    assert!(
        text.contains(
            "	num_empires = { min = 0 max = 16 }
	num_empire_default = 13
	advanced_empire_default = 0
	nomad_empire_default = 2
	nomad_empire_max = 16
	fallen_empire_default = 3
	marauder_empire_default = 2
	crisis_strength = 5.0
	core_radius = 112.5
"
        ),
        "{}",
        &text[..1200]
    );
    assert!(report.setup_from_save);
    assert_eq!(report.omitted, []);
}

/// Each fallen empire's systems are left out, and one anchor in the save's order after
/// the kept systems stands where its capital stood, with a generic start, one lane and
/// the zone flags of the kind its capital's initializer names.
#[test]
fn each_fallen_empire_is_replaced_by_a_zone_anchored_on_its_capital() {
    let Painted {
        save,
        report,
        reopened,
        ..
    } = painted();
    let galaxy: &Galaxy = reopened.graph();
    let (plain, plain_report) = &*PLAIN_EXPORT;
    assert_eq!(
        plain_report.fallen_empire_zones, 0,
        "the plain profile places no zone"
    );
    assert!(
        !String::from_utf8_lossy(plain).contains("painted_galaxy_fe_spawn"),
        "the plain profile writes zone flags"
    );
    let fallen = sample_fallen_empires(&save);
    assert_eq!(
        fallen.iter().map(|f| f.2).collect::<Vec<_>>(),
        [FeKind::Machine, FeKind::Materialist, FeKind::Spiritualist]
    );
    assert_eq!(save.graph().systems.keys().max(), Some(&790));
    assert_eq!(report.fallen_empires.len(), 3);
    for (i, ((country, capital, kind), fe)) in fallen.iter().zip(&report.fallen_empires).enumerate()
    {
        assert_eq!(fe.kind, *kind, "{country}");
        assert_eq!(fe.anchor, Some(ANCHORS[i]), "{country}");
        assert!(fe.exact, "{country}");
        let named = save.graph().countries.iter().find(|c| c.id == *country);
        assert_eq!(fe.name, named.unwrap().name_key, "{capital}");
    }
    assert_eq!(
        report
            .fallen_empires
            .iter()
            .map(|f| f.systems_left_out)
            .collect::<Vec<_>>(),
        [11, 5, 13]
    );

    let typed = assert_paint_export_holds_together(save.graph(), reopened.graph(), report);
    assert_eq!(typed.keys().copied().collect::<Vec<_>>(), ANCHORS);
    let missing = left_out(save.graph(), galaxy);
    let hubs: Vec<u32> = save
        .graph()
        .systems
        .values()
        .filter(|s| s.initializer.starts_with("ai_system_"))
        .map(|s| s.id)
        .collect();
    assert_eq!(hubs.len(), 4, "the Contingency hubs");
    for hub in hubs {
        assert!(!missing.contains(&hub), "Contingency hub {hub} is left out");
    }
    for (country, capital, _) in &fallen {
        assert!(missing.contains(capital), "{country}: {capital} is written");
        for system in save.graph().systems.values() {
            if system.owner == Some(*country) {
                assert!(missing.contains(&system.id), "{country} owns {}", system.id);
            }
        }
    }
    let mut kept_order: Vec<u32> = save
        .graph()
        .order
        .iter()
        .filter(|id| !missing.contains(id))
        .copied()
        .collect();
    kept_order.extend(ANCHORS);
    assert_eq!(galaxy.order, kept_order);
    for (anchor, (_, capital, _)) in ANCHORS.iter().zip(&fallen) {
        let system = &galaxy.systems[anchor];
        assert_eq!(system.initializer, "painted_galaxy_rl_basic");
        assert_eq!(system.name.key, "");
        assert_eq!(system.lanes.len(), 1, "{anchor}: {:?}", system.lanes);
        assert_eq!(system.spawn_script, None);
        let (effect, _) = reopened.scenario_system_effect(*anchor).expect("flags");
        assert!(
            effect.contains("{ set_star_flag = painted_galaxy_automatic_initializer set_star_flag = painted_galaxy_fe_spawn "),
            "{anchor}: {effect}"
        );
        assert!(
            effect.ends_with(&format!(
                "set_star_flag = painted_galaxy_fe_spawn_preferred set_star_flag = painted_galaxy_fe_custom_connections set_star_flag = painted_galaxy_fe_custom_connection_id_{} }}",
                anchor - ANCHORS[0]
            )),
            "{anchor}: {effect}"
        );
        let zone = &typed[anchor];
        assert_eq!(zone.distance, 40);
        let centre = fe_zone::centre((system.x, system.y), zone);
        let old = &save.graph().systems[capital];
        let off = (centre.0 - old.x).hypot(centre.1 - old.y);
        assert!(off < 0.01, "{anchor}: {centre:?} is {off} from {capital}");
    }
    assert_eq!(
        report.fallen_empire_zones, 0,
        "a save's export places only the zones its fallen empires ask for"
    );
    assert!(
        !placement::candidates(&placement::sites(galaxy)).is_empty(),
        "the mod's candidates stay available to Fit"
    );
}

/// Each zone takes the custom connections of the kept systems that had a lane into the
/// cluster it replaces and stand within the mod's reach of the ring, under the ids 0, 1
/// and 2, and no other system links.
#[test]
fn each_zone_links_the_systems_that_had_a_lane_into_its_cluster() {
    let Painted {
        save,
        report,
        reopened,
        ..
    } = painted();
    let galaxy: &Galaxy = reopened.graph();
    let missing = left_out(save.graph(), galaxy);
    assert_eq!(
        report
            .fallen_empires
            .iter()
            .map(|f| f.links)
            .collect::<Vec<_>>(),
        [6, 7, 12]
    );
    for (i, (anchor, fe)) in ANCHORS.iter().zip(&report.fallen_empires).enumerate() {
        let link = &galaxy.systems[anchor].fe_link;
        assert_eq!(
            *link,
            FeLinkFlags {
                custom: true,
                id: Some(i as u8),
                to: Vec::new(),
            },
            "{anchor}"
        );
        let linked: Vec<u32> = galaxy
            .order
            .iter()
            .filter(|id| galaxy.systems[id].fe_link.to.contains(&(i as u8)))
            .copied()
            .collect();
        assert_eq!(linked.len() as u32, fe.links, "{anchor}: {linked:?}");
        assert!(!linked.is_empty(), "{anchor}");
    }
    for system in galaxy.systems.values() {
        assert_eq!(
            system.fe_link.custom,
            ANCHORS.contains(&system.id),
            "{}",
            system.id
        );
        for n in &system.fe_link.to {
            assert!(usize::from(*n) < ANCHORS.len(), "{}: {n}", system.id);
            let old = &save.graph().systems[&system.id];
            assert!(
                old.lanes.iter().any(|lane| missing.contains(&lane.to)),
                "{} links to {n} but had no lane into a cluster",
                system.id
            );
            let anchor = &galaxy.systems[&ANCHORS[usize::from(*n)]];
            let zone = anchor.fe_zone.as_ref().expect("the anchor's zone");
            let centre = fe_zone::centre((anchor.x, anchor.y), zone);
            let reach = (system.x - centre.0).hypot(system.y - centre.1);
            assert!(reach <= 100.0, "{} links to {n} from {reach}", system.id);
        }
    }
}

/// Leaving the fallen empires out isolates no system the save had linked.
#[test]
fn the_export_isolates_no_system_the_save_linked() {
    let Painted { save, reopened, .. } = painted();
    let issues = sgf_core::validate::validate(reopened.graph());
    let isolated: Vec<u32> = issues
        .iter()
        .filter(|i| i.code == IssueCode::SystemIsolated)
        .flat_map(|i| i.systems.clone())
        .collect();
    let isolated_before: Vec<u32> = save
        .graph()
        .systems
        .values()
        .filter(|s| s.lanes.is_empty())
        .map(|s| s.id)
        .collect();
    assert!(
        isolated.iter().all(|id| isolated_before.contains(id)),
        "{isolated:?} beyond {isolated_before:?}"
    );
}
