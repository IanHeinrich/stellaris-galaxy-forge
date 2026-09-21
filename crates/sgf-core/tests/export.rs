//! Scenario export through the public API: the sample save's galaxy written out, read
//! back and compared against the committed fixture.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use sgf_core::document;
use sgf_core::emit::rounded;
use sgf_core::export::policy::Category;
use sgf_core::export::{self, DroppedBypasses, ExportReport, HomeInitializer, ScenarioProfile};
use sgf_core::format::scenario::FeLinkFlags;
use sgf_core::format::scenario::fe_zone::{self, FeKind};
use sgf_core::projections::galaxy::{BypassLink, Galaxy, PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};
use sgf_core::views::DocumentKind;

mod common;

use common::paint::{assert_paint_export_holds_together, left_out};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);
const PAINT_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.paint.txt"
);
const GRAMMAR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);
/// The fixture's name: the sample save's file stem, as the exporter defaults to.
const NAME: &str = "2206.11.16";
/// The save the fixture says it was exported from.
const SAVE_FILE: &str = "2206.11.16.sav";

/// No game data, so every name is written as the save holds it.
fn no_names(_: &str) -> Option<String> {
    None
}

/// No game data, so every initializer counts as vanilla.
fn no_sources(_: &str) -> Option<String> {
    None
}

/// The session a written scenario reads back as.
fn reopen(text: Vec<u8>) -> Session {
    let doc = document::Document::from_scenario_bytes(text).expect("the text reads back");
    Session::from_document(None, doc).expect("project the scenario")
}

/// Every undirected lane once, ascending.
fn lanes(galaxy: &Galaxy) -> BTreeSet<(u32, u32)> {
    let mut pairs = BTreeSet::new();
    for system in galaxy.systems.values() {
        for lane in &system.lanes {
            pairs.insert((system.id.min(lane.to), system.id.max(lane.to)));
        }
    }
    pairs
}

/// The export as `sgf export-scenario` writes it from the sample save under `profile`.
fn exported_as(session: &Session, name: &str, profile: ScenarioProfile) -> (Vec<u8>, ExportReport) {
    let options = export::ScenarioOptions {
        exported_from: Some(SAVE_FILE.to_owned()),
        ..export::options_for(&session.graph, name)
    };
    export::scenario_text(&session.graph, &options, &no_names, &no_sources, profile)
}

/// The plain export as `sgf export-scenario` writes it from the sample save.
fn exported(session: &Session, name: &str) -> (Vec<u8>, ExportReport) {
    exported_as(session, name, ScenarioProfile::Plain)
}

/// The sample's bypasses as the save holds them: six wormhole pairs, each listed once;
/// gateways all on an initializer that rebuilds them; L-Gates all on one that spawns
/// `lgate_base`. So the plain export drops the pairs and nothing else.
fn assert_sample_bypasses(galaxy: &Galaxy) {
    let mut pairs = BTreeSet::new();
    for link in &galaxy.bypasses {
        match link {
            BypassLink::Wormhole { a, b } => {
                assert!(pairs.insert((a.min(b), a.max(b))), "{link:?} listed twice");
            }
            BypassLink::Gateway { system, .. } => {
                let initializer = &galaxy.systems[system].initializer;
                assert!(
                    initializer.starts_with("abandoned_gateways"),
                    "{system}: {initializer}"
                );
            }
            BypassLink::LGate { system } => {
                let initializer = galaxy.systems[system].initializer.as_str();
                assert!(
                    matches!(
                        initializer,
                        "distantstars_init_00" | "distantstars_init_01" | "distantstars_init_06"
                    ) || initializer.starts_with("lgate"),
                    "{system}: {initializer}"
                );
            }
            BypassLink::Other { .. } => {}
        }
    }
    assert_eq!(pairs.len(), 6);
}

/// The ids of the `system` lines that carry a base spawn weight of 1.
fn seated(text: &str) -> BTreeSet<u32> {
    text.lines()
        .filter(|line| line.contains(" spawn_weight = { base = 1 }"))
        .map(|line| {
            let id = &line[line.find("id = \"").unwrap() + 6..];
            id[..id.find('"').unwrap()].parse().unwrap()
        })
        .collect()
}

#[test]
fn the_sample_exports_to_the_committed_fixture_and_reads_back_as_the_same_galaxy() {
    let save = common::open();
    let committed = std::fs::read(FIXTURE).expect("read the committed scenario fixture");
    let (text, report) = exported(&save, NAME);
    assert_eq!(
        text, committed,
        "the fixture is generated: re-export it with `sgf export-scenario`"
    );
    let text = String::from_utf8(text).expect("utf-8");

    let capitals = default_capitals(&save);
    let seats = capitals.len();
    assert_eq!(seats, 17);
    let empires = seats - 1;
    assert!(
        text.starts_with(&format!(
            "# Exported by Stellaris Galaxy Forge from {SAVE_FILE}
# Systems: 791 · Empire seats: {seats} · Nebulae: 9
# Not carried over: 6 wormhole pairs
static_galaxy_scenario = {{
	name = \"{NAME}\"
	priority = 5
	supports_shape = elliptical
	supports_shape = ring
	supports_shape = spiral_2
	supports_shape = spiral_3
	supports_shape = spiral_4
	supports_shape = spiral_6
	supports_shape = bar
	supports_shape = starburst
	supports_shape = cartwheel
	supports_shape = spoked
	default = no
	num_empires = {{ min = 0 max = {empires} }}
	num_empire_default = {empires}
"
        )),
        "{}",
        &text[..800]
    );
    assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
    assert_eq!(seated(&text), capitals);
    assert_eq!(text.matches("spawn_weight").count(), seats);

    assert_eq!(report.seats, seats as u32);
    let home = |system: u32, initializer: &str| HomeInitializer {
        system,
        initializer: initializer.to_owned(),
        replaced: false,
    };
    assert_eq!(
        report.home_initializers,
        [
            home(4, "une_deneb_system"),
            home(311, "shattered_ring_start"),
            home(786, "custom_starting_init_02"),
            home(787, "custom_starting_init_02"),
        ]
    );
    assert_sample_bypasses(&save.graph);
    assert_eq!(
        report.dropped,
        DroppedBypasses {
            wormhole_pairs: 6,
            gateways: 0,
            lgates: 0,
        }
    );
    assert_eq!(report.sources, []);
    assert_eq!(report.omitted, []);
    assert_eq!(report.fallen_empires, []);
    assert_eq!(report.player_seat, None);
    assert!(!report.setup_from_save);
    let by_category: BTreeMap<Category, u32> = report
        .by_category
        .iter()
        .map(|c| (c.category, c.systems))
        .collect();
    assert_eq!(by_category[&Category::Home], seats as u32);
    assert_eq!(by_category.values().sum::<u32>(), 791);
    assert!(
        report
            .by_category
            .windows(2)
            .all(|pair| pair[0].category < pair[1].category),
        "{:?}",
        report.by_category
    );

    let issues = report.issues();
    assert!(issues.iter().all(|i| i.severity == Severity::Warning));
    let dropped: Vec<&str> = issues
        .iter()
        .filter(|i| i.code == IssueCode::ExportDropped)
        .map(|i| i.message.as_str())
        .collect();
    assert_eq!(
        dropped,
        ["6 wormhole pairs were not carried into the scenario"]
    );
    let homes: Vec<(&[u32], bool)> = issues
        .iter()
        .filter(|i| i.code == IssueCode::HomeInitializer)
        .map(|i| {
            let named = i.message.contains(&format!("system {} ", i.systems[0]));
            (i.systems.as_slice(), named)
        })
        .collect();
    assert_eq!(
        homes,
        [
            (&[4][..], true),
            (&[311][..], true),
            (&[786][..], true),
            (&[787][..], true)
        ]
    );
    assert_eq!(issues.len(), 5);

    let scenario = Session::open(FIXTURE).expect("open the exported scenario");
    assert_eq!(scenario.kind(), DocumentKind::Scenario);
    assert_eq!(scenario.title(), NAME);
    assert_eq!(scenario.graph.order, save.graph.order);
    assert_eq!(scenario.graph.systems.len(), 791);
    for (id, system) in &save.graph.systems {
        let written = &scenario.graph.systems[id];
        assert_eq!(
            (written.x, written.y),
            (rounded(system.x), rounded(system.y))
        );
        assert_eq!(written.initializer, system.initializer);
        assert_eq!(
            written.spawn_weight,
            capitals.contains(id).then_some(1.0),
            "{id}"
        );
    }
    assert_eq!(lanes(&scenario.graph), lanes(&save.graph));
    assert_eq!(scenario.graph.nebulae.len(), 9);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("roundtrip.txt");
    let mut scenario = scenario;
    scenario.save_as(&path).expect("save the scenario back out");
    assert_eq!(std::fs::read(&path).unwrap(), committed);

    // The save's shape leads the list; the sample's is elliptical, which leads anyway.
    let mut ring = common::open();
    ring.graph.setup.as_mut().expect("the sample's setup").shape = "ring".to_owned();
    let (text, report) = exported(&ring, NAME);
    let text = String::from_utf8(text).expect("utf-8");
    assert!(
        text.contains(
            "	priority = 5
	supports_shape = ring
	supports_shape = elliptical
	supports_shape = spiral_2
"
        ),
        "{}",
        &text[..800]
    );
    assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
    assert_eq!(text.matches("\tsupports_shape = ring\n").count(), 1);
    assert_eq!(
        text.lines().count(),
        committed.split(|&b| b == b'\n').count() - 1
    );
    assert_eq!(report, exported(&save, NAME).1);
}

#[test]
fn a_save_opens_as_an_unsaved_scenario_of_the_same_galaxy() {
    let (mut session, report) = export::open_save_as_scenario(
        Path::new(common::SAMPLE),
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    )
    .expect("open as scenario");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), NAME);
    assert_eq!(session.path, None);
    assert!(session.is_dirty());
    assert_eq!(report, exported(&common::open(), NAME).1);
    assert!(common::current(&session).starts_with(
        format!("# Exported by Stellaris Galaxy Forge from {SAVE_FILE}\n").as_bytes()
    ));

    let error = session
        .save_to(None)
        .expect_err("a pathless document cannot save in place");
    assert!(matches!(error, document::Error::NoPath), "{error:?}");

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("from_save.txt");
    session.save_as(&path).expect("save_as names the file");
    assert_eq!(session.path.as_deref(), Some(path.as_path()));
    assert!(!session.is_dirty());

    let reopened = Session::open(&path).expect("reopen what was saved");
    assert_eq!(reopened.graph.order, session.graph.order);
    assert_eq!(lanes(&reopened.graph), lanes(&session.graph));

    let error = export::open_save_as_scenario(
        Path::new(GRAMMAR),
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    )
    .expect_err("a scenario is not a save");
    assert!(error.to_string().contains("already a scenario"), "{error}");
}

#[test]
fn a_new_scenario_is_a_header_with_nothing_in_it() {
    let mut session =
        export::new_scenario("sgf_test", 0.0, ScenarioProfile::Plain).expect("new scenario");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), "sgf_test");
    assert!(session.graph.systems.is_empty());
    assert!(session.graph.nebulae.is_empty());
    assert_eq!(session.graph.galaxy_radius, 0.0);
    assert_eq!(session.path, None);
    assert!(session.is_dirty());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sgf_test.txt");
    session.save_as(&path).expect("save the new scenario");

    let reopened = Session::open(&path).expect("reopen the new scenario");
    assert_eq!(reopened.title(), "sgf_test");
    assert!(reopened.graph.systems.is_empty());
    common::snapshot(
        "new_scenario",
        &String::from_utf8(std::fs::read(&path).unwrap()).unwrap(),
    );
}

#[test]
fn a_new_paint_a_galaxy_scenario_is_the_mods_header_with_nothing_in_it() {
    let mut session =
        export::new_scenario("sgf_test", 0.0, ScenarioProfile::PaintAGalaxy).expect("new scenario");
    assert_eq!(session.title(), "sgf_test");
    assert!(session.graph.systems.is_empty());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sgf_test.txt");
    session.save_as(&path).expect("save the new scenario");
    let reopened = Session::open(&path).expect("reopen the new scenario");
    assert_eq!(reopened.title(), "sgf_test");
    common::snapshot(
        "new_scenario_paint",
        &String::from_utf8(std::fs::read(&path).unwrap()).unwrap(),
    );
}

/// The systems within `jumps` lanes of any of `from`, `from` included.
fn within(galaxy: &Galaxy, from: &BTreeSet<u32>, jumps: usize) -> BTreeSet<u32> {
    let mut reached = from.clone();
    let mut frontier = from.clone();
    for _ in 0..jumps {
        let mut next = BTreeSet::new();
        for id in &frontier {
            for lane in &galaxy.systems[id].lanes {
                if reached.insert(lane.to) {
                    next.insert(lane.to);
                }
            }
        }
        frontier = next;
    }
    reached
}

/// Where `needle` first occurs in `bytes` at or after `from`.
fn find(bytes: &[u8], from: usize, needle: &str) -> usize {
    from + bytes[from..]
        .windows(needle.len())
        .position(|w| w == needle.as_bytes())
        .unwrap_or_else(|| panic!("{needle:?} not found"))
}

/// The sample save with system `id`'s initializer blanked, since the save itself
/// names one on every system.
fn sample_without_initializer(id: u32) -> Session {
    common::open_edited(|bytes| {
        let section = find(
            bytes,
            0,
            "
galactic_object=",
        );
        let entity = find(
            bytes,
            section,
            &format!(
                "
	{id}=
	{{"
            ),
        );
        let start = find(bytes, entity, "initializer=\"") + "initializer=\"".len();
        let end = find(bytes, start, "\"");
        bytes.drain(start..end);
    })
}

fn default_capitals(save: &Session) -> BTreeSet<u32> {
    save.graph
        .countries
        .iter()
        .filter(|c| c.country_type == "default")
        .filter_map(|c| c.capital_system)
        .collect()
}

/// The sample's fallen empires: country id, capital, and the kind the mod's table gives
/// the capital's initializer.
fn sample_fallen_empires(save: &Session) -> Vec<(u32, u32, FeKind)> {
    let mut fallen: Vec<(u32, u32, FeKind)> = save
        .graph
        .countries
        .iter()
        .filter(|c| c.country_type == "fallen_empire")
        .map(|c| {
            let capital = c.capital_system.expect("a fallen empire's capital");
            let kind = match save.graph.systems[&capital].initializer.as_str() {
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

#[test]
fn the_paint_a_galaxy_export_of_the_sample_matches_its_fixture_and_holds_together() {
    let save = common::open();
    let committed =
        std::fs::read(PAINT_FIXTURE).expect("read the committed Paint a Galaxy fixture");
    let (text, report) = exported_as(&save, NAME, ScenarioProfile::PaintAGalaxy);
    assert_eq!(
        text, committed,
        "the fixture is generated: re-export it with `sgf export-scenario --profile paint-a-galaxy`"
    );
    let text = String::from_utf8(text).expect("utf-8");
    assert!(
        text.starts_with(
            "# Exported by Stellaris Galaxy Forge from 2206.11.16.sav
# Systems: 765 · Empire seats: 17 · Nebulae: 9
# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {
	name = \"2206.11.16\"
	priority = 10
	supports_shape = elliptical
"
        ),
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
	colonizable_planet_odds = 0.25
	primitive_odds = 0.25
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
	crisis_strength = 1.0
	core_radius = 112.5
"
        ),
        "{}",
        &text[..1200]
    );
    assert!(report.setup_from_save);
    assert_eq!(report.omitted, []);

    let fallen = sample_fallen_empires(&save);
    assert_eq!(
        fallen.iter().map(|f| f.2).collect::<Vec<_>>(),
        [FeKind::Machine, FeKind::Materialist, FeKind::Spiritualist]
    );
    let max_id = *save.graph.systems.keys().max().unwrap();
    assert_eq!(max_id, 790);
    let anchors: Vec<u32> = (1..=3).map(|i| max_id + i).collect();
    assert_eq!(report.fallen_empires.len(), 3);
    for (i, ((country, capital, kind), fe)) in fallen.iter().zip(&report.fallen_empires).enumerate()
    {
        assert_eq!(fe.kind, *kind, "{country}");
        assert_eq!(fe.anchor, Some(anchors[i]), "{country}");
        assert!(fe.exact, "{country}");
        let named = save.graph.countries.iter().find(|c| c.id == *country);
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

    let reopened = reopen(text.clone().into_bytes());
    let galaxy: &Galaxy = &reopened.graph;
    let typed = assert_paint_export_holds_together(&save.graph, &reopened.graph, &report);
    assert_eq!(typed.keys().copied().collect::<Vec<_>>(), anchors);
    let missing = left_out(&save.graph, galaxy);
    for (country, capital, _) in &fallen {
        assert!(missing.contains(capital), "{country}: {capital} is written");
        for system in save.graph.systems.values() {
            if system.owner == Some(*country) {
                assert!(missing.contains(&system.id), "{country} owns {}", system.id);
            }
        }
    }
    let mut kept_order: Vec<u32> = save
        .graph
        .order
        .iter()
        .filter(|id| !missing.contains(id))
        .copied()
        .collect();
    kept_order.extend(&anchors);
    assert_eq!(galaxy.order, kept_order);
    for (anchor, (_, capital, _)) in anchors.iter().zip(&fallen) {
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
                anchor - anchors[0]
            )),
            "{anchor}: {effect}"
        );
        let zone = &typed[anchor];
        assert_eq!(zone.distance, 40);
        let centre = fe_zone::centre((system.x, system.y), zone);
        let old = &save.graph.systems[capital];
        let off = (centre.0 - old.x).hypot(centre.1 - old.y);
        assert!(off < 0.01, "{anchor}: {centre:?} is {off} from {capital}");
    }

    // Each zone takes the custom connections of the kept systems that had a lane into
    // the cluster it replaces and stand within the mod's reach of the ring, under the
    // ids 0, 1 and 2, and no other system links.
    assert_eq!(
        report
            .fallen_empires
            .iter()
            .map(|f| f.links)
            .collect::<Vec<_>>(),
        [6, 7, 12]
    );
    for (i, (anchor, fe)) in anchors.iter().zip(&report.fallen_empires).enumerate() {
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
            anchors.contains(&system.id),
            "{}",
            system.id
        );
        for n in &system.fe_link.to {
            assert!(usize::from(*n) < anchors.len(), "{}: {n}", system.id);
            let old = &save.graph.systems[&system.id];
            assert!(
                old.lanes.iter().any(|lane| missing.contains(&lane.to)),
                "{} links to {n} but had no lane into a cluster",
                system.id
            );
            let anchor = &galaxy.systems[&anchors[usize::from(*n)]];
            let centre = fe_zone::centre((anchor.x, anchor.y), &typed[&anchor.id]);
            let reach = (system.x - centre.0).hypot(system.y - centre.1);
            assert!(reach <= 100.0, "{} links to {n} from {reach}", system.id);
        }
    }

    let player = save
        .graph
        .countries
        .iter()
        .find(|c| c.id == 0)
        .and_then(|c| c.capital_system)
        .expect("the capital of country 0");
    assert_eq!(save.graph.player_country, Some(0));
    assert_eq!(report.player_seat, Some(player));
    assert_eq!(player, 217);
    assert_eq!(
        galaxy.systems[&player].spawn_script,
        Some(SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Preferred,
            random_value: 7,
            player: true,
        })
    );
    assert_eq!(
        galaxy.systems[&player].initializer,
        "sol_system_initializer"
    );
    // The Sol seat takes only the United Nations of Earth, so the player's capital is
    // a preferred seat with the marker the first empire placed draws.
    assert!(
        text.contains(
            "	system = { id = \"217\" name = \"NAME_Sol\" position = { x = 397.39 y = -180.25 } initializer = sol_system_initializer spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { add = 100000 } } }
"
        ),
        "{text}"
    );
    assert_eq!(text.matches("modifier = { add = 100000 }").count(), 1);
    let players: Vec<u32> = galaxy
        .systems
        .values()
        .filter(|s| {
            matches!(
                s.spawn_script,
                Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Preferred,
                    player: true,
                    ..
                })
            )
        })
        .map(|s| s.id)
        .collect();
    assert_eq!(players, [player]);
    let preferred = galaxy
        .systems
        .values()
        .filter(|s| {
            matches!(
                s.spawn_script,
                Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Preferred,
                    ..
                })
            )
        })
        .count();
    assert_eq!(preferred, 1);
    assert_eq!(report.home_initializers.len(), 4);
    assert!(report.home_initializers.iter().all(|h| h.replaced));
    for home in &report.home_initializers {
        assert_eq!(
            galaxy.systems[&home.system].initializer,
            format!("random_empire_init_0{}", home.system % 6 + 1)
        );
    }
    let issues = sgf_core::validate::validate(&reopened.graph);
    // Sol's initializer stands on the player's seat by design, so it is no mismatch.
    assert!(
        !issues.iter().any(|i| matches!(
            i.code,
            IssueCode::SolSeatMismatch | IssueCode::PlayerSeatDuplicate
        )),
        "{issues:?}"
    );
    let isolated: Vec<u32> = issues
        .iter()
        .filter(|i| i.code == IssueCode::SystemIsolated)
        .flat_map(|i| i.systems.clone())
        .collect();
    let isolated_before: Vec<u32> = save
        .graph
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

#[test]
fn the_paint_a_galaxy_profile_seats_the_capitals_fills_their_neighbours_and_flags_wormholes() {
    let committed = common::open();
    let capitals = default_capitals(&committed);
    let first = *capitals.first().expect("a playable capital");
    let neighbour = committed.graph.systems[&first]
        .lanes
        .iter()
        .map(|lane| lane.to)
        .find(|to| !capitals.contains(to))
        .expect("a neighbour that is not a capital");
    let save = sample_without_initializer(neighbour);
    assert_eq!(save.graph.systems[&neighbour].initializer, "");
    assert_eq!(default_capitals(&save), capitals);
    let (text, report) = exported_as(&save, NAME, ScenarioProfile::PaintAGalaxy);
    let text = String::from_utf8(text).expect("utf-8");
    // Every pair's ends are written, so the comment lines above the mod's own say
    // nothing was dropped.
    assert_eq!(report.dropped, DroppedBypasses::default());
    assert!(
        report
            .issues()
            .iter()
            .all(|issue| issue.code != IssueCode::ExportDropped),
        "{:?}",
        report.issues()
    );
    let systems = text
        .lines()
        .filter(|line| line.starts_with("\tsystem = "))
        .count();
    assert!(
        text.starts_with(&format!(
            "# Exported by Stellaris Galaxy Forge from {SAVE_FILE}
# Systems: {systems} · Empire seats: {} · Nebulae: 9
# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {{
	name = \"{NAME}\"
	priority = 10
",
            capitals.len()
        )),
        "{}",
        &text[..400]
    );

    // 17 seats, the player's preferred: the setup's 13 empires fit under the 15
    // seats any empire may take, and its advanced and nomad counts stand as set.
    assert_eq!(capitals.len(), 17, "{capitals:?}");
    assert!(
        text.contains(
            "	num_empires = { min = 0 max = 16 }
	num_empire_default = 13
	advanced_empire_default = 0
	nomad_empire_default = 2
	nomad_empire_max = 16
"
        ),
        "{}",
        &text[..1200]
    );
    assert!(
        text.contains(
            "	fallen_empire_default = 3
	marauder_empire_default = 2
	crisis_strength = 1.0
	core_radius = 112.5
"
        ),
        "{}",
        &text[..1200]
    );
    assert_eq!(
        text.matches("value:painted_galaxy_spawn_weight|").count(),
        capitals.len()
    );

    let reopened = reopen(text.into_bytes());
    let missing = left_out(&save.graph, &reopened.graph);
    assert!(!missing.contains(&neighbour));
    let review: BTreeSet<u32> = report.home_initializers.iter().map(|h| h.system).collect();
    for (i, id) in capitals.iter().enumerate() {
        let system = &reopened.graph.systems[id];
        let player = report.player_seat == Some(*id);
        let kind = if player {
            PaintSpawnKind::Preferred
        } else {
            PaintSpawnKind::Enabled
        };
        assert_eq!(
            system.spawn_script,
            Some(SpawnScript::PaintAGalaxy {
                kind,
                random_value: (i % 10) as u8,
                player,
            }),
            "{id}"
        );
        assert!(!system.initializer.is_empty(), "{id}");
        let expected = match save.graph.systems[id].initializer.as_str() {
            own if own.is_empty() || review.contains(id) => {
                format!("random_empire_init_0{}", id % 6 + 1)
            }
            own => own.to_owned(),
        };
        assert_eq!(system.initializer, expected, "{id}");
    }

    let near = within(&save.graph, &capitals, 2);
    let mut filled = 0;
    for id in save.graph.order.iter().filter(|id| !missing.contains(id)) {
        let written = &reopened.graph.systems[id];
        let own = &save.graph.systems[id].initializer;
        let filler = own.is_empty() && near.contains(id) && !capitals.contains(id);
        assert_eq!(
            written.initializer == "painted_galaxy_rl_basic",
            filler,
            "{id}: {:?}",
            written.initializer
        );
        if filler {
            filled += 1;
            let (effect, _) = reopened.scenario_system_effect(*id).expect("a flag");
            assert!(
                effect.contains("set_star_flag = painted_galaxy_automatic_initializer"),
                "{id}: {effect}"
            );
        } else if !capitals.contains(id) {
            assert_eq!(written.initializer, *own, "{id}");
        }
        assert_eq!(
            written.spawn_script.is_some(),
            capitals.contains(id),
            "{id}"
        );
    }
    assert_eq!(filled, 1, "the one blanked neighbour is filled");

    let mut pairs = 0;
    for link in &save.graph.bypasses {
        let BypassLink::Wormhole { a, b } = link else {
            continue;
        };
        pairs += 1;
        for end in [a, b] {
            let (effect, _) = reopened
                .scenario_system_effect(*end)
                .expect("wormhole flags");
            assert!(
                effect.contains(&format!("set_star_flag = painted_galaxy_wormhole_{pairs} "))
                    && effect.contains("set_star_flag = empire_cluster"),
                "{end}: {effect}"
            );
        }
    }
    assert_eq!(pairs, 6);
}

#[test]
fn the_paint_a_galaxy_profile_places_only_the_saves_own_fallen_empires() {
    let save = common::open();
    let options = export::options_for(&save.graph, NAME);
    let (plain, report) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    );
    assert_eq!(report.fallen_empire_zones, 0);
    assert!(
        !String::from_utf8(plain)
            .unwrap()
            .contains("painted_galaxy_fe_spawn")
    );

    let (paint, report) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::PaintAGalaxy,
    );
    let text = String::from_utf8_lossy(&paint);
    let typed = report.fallen_empires.len() as u32;
    assert_eq!(typed, 3);
    assert_eq!(
        text.matches("set_star_flag = painted_galaxy_fe_spawn ")
            .count() as u32,
        report.fallen_empire_zones + typed
    );
    let fallen_max = (report.fallen_empire_zones + typed).min(6);
    assert!(
        text.contains(&format!("\tfallen_empire_max = {fallen_max}\n")),
        "{}",
        &text[..1200]
    );
    let reopened = reopen(paint.clone());
    let galaxy: &Galaxy = &reopened.graph;
    let anchors: BTreeSet<u32> = report
        .fallen_empires
        .iter()
        .filter_map(|f| f.anchor)
        .collect();
    let mut centres = Vec::new();
    for id in &galaxy.order {
        let anchor = &galaxy.systems[id];
        let Some(zone) = &anchor.fe_zone else {
            continue;
        };
        let centre = fe_zone::centre((anchor.x, anchor.y), zone);
        if anchors.contains(id) {
            assert!(zone.preferred, "{id}");
        } else {
            assert_eq!(zone.kind, FeKind::Random, "{id}");
            assert_eq!(zone.distance, 40, "{id}");
            assert!(!zone.preferred && !zone.fallback, "{id}");
            assert!(centre.0.hypot(centre.1) >= 130.0, "{id}: {centre:?}");
        }
        assert!(!fe_zone::is_off_map(centre), "{id}: {centre:?}");
        for system in galaxy.systems.values() {
            assert!(
                !fe_zone::inside(centre, (system.x, system.y)),
                "{id}: {} stands in the ring at {centre:?}",
                system.id
            );
        }
        for &(other, other_centre) in &centres {
            assert!(
                !fe_zone::overlaps(centre, other_centre),
                "{id} and {other} overlap at {centre:?} and {other_centre:?}"
            );
        }
        centres.push((*id, centre));
    }
    assert_eq!(centres.len() as u32, typed);
    assert_eq!(
        report.fallen_empire_zones, 0,
        "a save's export places only the zones its fallen empires ask for"
    );
    assert!(
        !fe_zone::candidates(&fe_zone::sites(galaxy)).is_empty(),
        "the mod's candidates stay available to Fit"
    );
    let issues = sgf_core::validate::validate(&reopened.graph);
    assert!(
        issues
            .iter()
            .all(|issue| !issue.code.as_str().starts_with("fe_zone"))
    );
    assert!(
        issues
            .iter()
            .all(|issue| issue.code != IssueCode::HeaderEmpireCount),
        "{issues:?}"
    );
}

#[test]
fn the_paint_a_galaxy_profile_writes_no_base_weight_on_a_home_that_is_no_capital() {
    let mut save = common::open();
    let capitals = default_capitals(&save);
    let country = save
        .graph
        .countries
        .iter_mut()
        .find(|c| c.country_type == "default" && c.capital_system.is_some())
        .expect("a playable country with a capital");
    let home = country.capital_system.take().expect("its capital");
    assert!(
        save.graph.systems[&home]
            .flags
            .iter()
            .any(|f| f == "empire_home_system")
    );
    assert_eq!(default_capitals(&save).len(), capitals.len() - 1);

    let options = export::options_for(&save.graph, NAME);
    assert_eq!(options.num_empires, (0, capitals.len() as u32 - 1));
    let (plain, _) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    );
    let plain = String::from_utf8(plain).expect("utf-8");
    assert_eq!(
        seated(&plain),
        capitals,
        "the plain profile still seats the flagged home"
    );

    let (paint, _) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::PaintAGalaxy,
    );
    let paint = String::from_utf8(paint).expect("utf-8");
    assert!(!paint.contains("spawn_weight = { base = 1 }"), "{paint}");
    assert_eq!(
        paint
            .matches("spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|")
            .count(),
        capitals.len() - 1
    );
    assert_eq!(
        paint.matches(" spawn_weight = {").count(),
        capitals.len() - 1
    );
    let reopened = reopen(paint.into_bytes());
    assert_eq!(reopened.graph.systems[&home].spawn_weight, None);
    assert_eq!(reopened.graph.systems[&home].spawn_script, None);
}

#[test]
fn a_scenario_name_that_cannot_be_quoted_is_refused_or_dropped() {
    for name in ["My \"Best\" Galaxy", "back\\slash", "two\nlines", ""] {
        let error = export::new_scenario(name, 0.0, ScenarioProfile::Plain).expect_err("refused");
        assert!(
            error.to_string().contains("scenario name"),
            "{name:?}: {error}"
        );
    }

    let save = common::open();
    let doc = document::Document::from_scenario_bytes(exported(&save, "My \"Best\" Galaxy").0)
        .expect("an exported scenario reads back");
    let scenario = Session::from_document(None, doc).expect("project the exported scenario");
    assert_eq!(scenario.title(), "My Best Galaxy");
    assert_eq!(scenario.graph.order, save.graph.order);
}

#[test]
fn writing_over_a_scenario_backs_the_old_one_up() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.txt");

    let first = export::write_scenario(&path, b"first").expect("write");
    assert_eq!(first.backup, None);

    let second = export::write_scenario(&path, b"second").expect("write over");
    let backup = second.backup.expect("a backup of the displaced file");
    assert!(
        backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains(".bak-"),
        "{}",
        backup.display()
    );
    assert_eq!(std::fs::read(&backup).unwrap(), b"first");
    assert_eq!(std::fs::read(&path).unwrap(), b"second");
}

fn backup_names(dir: &Path, prefix: &str) -> BTreeSet<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(prefix))
        .collect()
}

#[test]
fn pruning_keeps_the_original_the_newest_three_and_a_spread() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.txt");
    std::fs::write(&path, b"first").unwrap();
    let seeded = [
        "20260101-000000",
        "20260101-020000",
        "20260101-020005",
        "20260101-020005-1",
        "20260101-060000",
        "20260101-060003",
        "20260101-120000",
        "20260101-180000",
        "20260101-180010",
        "20260101-230000",
        "20260101-235959",
    ];
    for stamp in seeded {
        std::fs::write(dir.path().join(format!("target.txt.bak-{stamp}")), stamp).unwrap();
    }
    for name in ["other.txt.bak-20260101-000000", "target.txt.bak-junk"] {
        std::fs::write(dir.path().join(name), b"untouched").unwrap();
    }

    let outcome = export::write_scenario(&path, b"second").expect("write over");
    let newest = outcome.backup.expect("a backup of the displaced file");
    assert_eq!(std::fs::read(&newest).unwrap(), b"first");

    let expected: BTreeSet<String> = [
        "20260101-000000",
        "20260101-020005-1",
        "20260101-060003",
        "20260101-120000",
        "20260101-180000",
        "20260101-230000",
        "20260101-235959",
    ]
    .into_iter()
    .map(|stamp| format!("target.txt.bak-{stamp}"))
    .chain(std::iter::once(
        newest.file_name().unwrap().to_string_lossy().into_owned(),
    ))
    .collect();
    let mut remaining = backup_names(dir.path(), "target.txt.bak-");
    assert!(remaining.remove("target.txt.bak-junk"), "{remaining:?}");
    assert_eq!(remaining.len(), 8, "{remaining:?}");
    assert_eq!(remaining, expected);
    assert!(dir.path().join("other.txt.bak-20260101-000000").exists());
}

#[test]
fn writing_identical_bytes_makes_no_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.txt");

    export::write_scenario(&path, b"first").expect("write");
    let changed = export::write_scenario(&path, b"same").expect("write over");
    assert!(changed.backup.is_some());

    let unchanged = export::write_scenario(&path, b"same").expect("write the same again");
    assert_eq!(unchanged.backup, None);
    assert_eq!(std::fs::read(&path).unwrap(), b"same");
    assert_eq!(backup_names(dir.path(), "target.txt.bak-").len(), 1);
}
