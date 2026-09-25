//! Search by id, name and what a system holds, on the real sample save.
use sgf_core::projections::galaxy::display_name;
use sgf_core::search::NameResolver;
use sgf_core::session::Session;
use sgf_core::views::{SearchHit, SearchKind};

use crate::common;
use common::open;

fn no_loc(_: &str) -> Option<String> {
    None
}

fn no_special(_: u32) -> Vec<&'static str> {
    Vec::new()
}

fn find(s: &Session, query: &str, limit: usize, loc: NameResolver<'_>) -> Vec<SearchHit> {
    s.search(query, limit, loc, &no_special).hits
}

/// What the palette shows without game data, as `app/src/lib/names.ts` resolves the template.
fn shown(h: &SearchHit) -> String {
    display_name(&h.name_key)
}

fn of_kind(hits: &[SearchHit], kind: SearchKind) -> Vec<SearchHit> {
    hits.iter().filter(|h| h.kind == kind).cloned().collect()
}

/// Each hit on a line of its own, every field as the app receives it.
fn report(hits: &[SearchHit]) -> String {
    hits.iter()
        .map(|h| serde_json::to_string(h).expect("a hit as JSON"))
        .collect::<Vec<String>>()
        .join("\n")
}

#[test]
fn finds_systems_by_name_and_id() {
    let s = open();

    let hits = of_kind(&find(&s, "gamma", 10, &no_loc), SearchKind::System);
    assert_eq!(hits[0].id, 0, "{hits:?}");
    assert_eq!(hits[0].name_key, "NAME_Gamma_Refuge");
    assert_eq!(shown(&hits[0]), "Gamma Refuge");
    assert_eq!(hits[0].system_id, Some(0));
    assert_eq!(hits[0].position, Some([-144.22, 57.36]));
    assert!(hits.len() <= 10);

    // Exact display name, any case, with or without the prefix.
    assert_eq!(find(&s, "Gamma Refuge", 10, &no_loc)[0].id, 0);
    assert_eq!(find(&s, "  gamma refuge ", 10, &no_loc)[0].id, 0);
    assert_eq!(find(&s, "NAME_Gamma_Refuge", 10, &no_loc)[0].id, 0);

    // An id wins over any name match.
    let hits = of_kind(&find(&s, "0", 10, &no_loc), SearchKind::System);
    assert_eq!(hits[0].id, 0);
    assert!(hits.iter().filter(|h| h.id == 0).count() == 1);
    assert_eq!(find(&s, "790", 10, &no_loc)[0].id, 790);

    // A word-start match ranks above a mid-word substring, ties by id.
    let hits = of_kind(&find(&s, "refuge", 10, &no_loc), SearchKind::System);
    assert_eq!(hits[0].id, 0);
    let ids: Vec<u32> = hits.iter().map(|h| h.id).collect();
    let mut sorted = ids.clone();
    sorted.sort_unstable();
    assert_eq!(ids, sorted, "same rank, id ascending");

    assert!(find(&s, "", 10, &no_loc).is_empty());
    assert!(find(&s, "   ", 10, &no_loc).is_empty());
    assert!(find(&s, "no such system anywhere", 10, &no_loc).is_empty());
}

#[test]
fn matches_the_resolved_name_and_carries_the_template() {
    let s = open();
    let loc = |key: &str| (key == "NAME_Gamma_Refuge").then(|| "The Haven".to_owned());

    let hits = find(&s, "haven", 10, &loc);
    assert_eq!(hits[0].id, 0, "{hits:?}");
    assert_eq!(
        hits[0].name.key, "NAME_Gamma_Refuge",
        "the UI resolves the name"
    );
    assert_eq!(find(&s, "The Haven", 10, &loc)[0].id, 0);

    // The key still matches when the localised text does not.
    assert_eq!(find(&s, "gamma refuge", 10, &loc)[0].id, 0);

    // Unresolved systems fall back to the display form of the key.
    let other = find(&s, "790", 10, &loc);
    assert_eq!(other[0].id, 790);
    assert!(
        !shown(&other[0]).starts_with("NAME_"),
        "{}",
        shown(&other[0])
    );
}

#[test]
fn respects_the_limit_within_each_kind() {
    let s = common::warmed();
    let all = of_kind(&find(&s, "a", 1000, &no_loc), SearchKind::System);
    assert!(all.len() > 3, "{}", all.len());
    let three = find(&s, "a", 3, &no_loc);
    assert_eq!(of_kind(&three, SearchKind::System).len(), 3);
    assert_eq!(of_kind(&three, SearchKind::Planet).len(), 3);
    assert_eq!(of_kind(&three, SearchKind::System), all[..3]);
    assert!(find(&s, "a", 0, &no_loc).is_empty());
}

#[test]
fn hits_come_back_grouped_by_kind() {
    let s = common::warmed();
    let hits = find(&s, "a", 5, &no_loc);
    let kinds: Vec<SearchKind> = hits.iter().map(|h| h.kind).collect();
    let mut grouped = kinds.clone();
    grouped.sort();
    assert_eq!(
        kinds, grouped,
        "systems first, then countries, planets, fleets, nebulae"
    );
    for kind in [
        SearchKind::System,
        SearchKind::Country,
        SearchKind::Planet,
        SearchKind::Fleet,
        SearchKind::Nebula,
    ] {
        assert!(!of_kind(&hits, kind).is_empty(), "no {kind:?} hit");
    }
}

#[test]
fn finds_a_planet_a_country_a_fleet_and_a_nebula() {
    let s = common::warmed();

    let earth = of_kind(&find(&s, "earth", 5, &no_loc), SearchKind::Planet);
    assert_eq!(shown(&earth[0]), "Earth");
    assert_eq!(earth[0].system_id, Some(217), "Earth is in Sol");
    common::snapshot("earth", &report(&find(&s, "earth", 5, &no_loc)));

    let man = of_kind(&find(&s, "commonwealth", 5, &no_loc), SearchKind::Country);
    assert_eq!(shown(&man[0]), "Commonwealth of Man");
    assert_eq!(man[0].system_id, Some(4), "its capital's system");
    assert_eq!(man[0].country_type.as_deref(), Some("default"));
    assert!(man[0].system_count.is_some_and(|n| n > 0));
    common::snapshot(
        "commonwealth",
        &report(&find(&s, "commonwealth", 5, &no_loc)),
    );

    let drake = of_kind(&find(&s, "ether drake", 5, &no_loc), SearchKind::Fleet);
    assert_eq!(shown(&drake[0]), "Ether Drake");
    assert!(drake[0].system_id.is_some(), "the system it sits in");
    assert!(drake[0].owner.is_some(), "the country running it");
    common::snapshot("ether_drake", &report(&find(&s, "ether drake", 5, &no_loc)));

    // A templated name travels whole, so the UI resolves it instead of showing the stand-in.
    let trans = of_kind(&find(&s, "commonwealth", 5, &no_loc), SearchKind::Fleet);
    assert_eq!(trans[0].name.key, "TRANS_FLEET_NAME");
    assert_eq!(
        trans[0]
            .name
            .variables
            .iter()
            .map(|v| v.name.as_str())
            .collect::<Vec<&str>>(),
        ["COUNTRY", "NUMBER"]
    );

    let miasma = of_kind(&find(&s, "miasma", 5, &no_loc), SearchKind::Nebula);
    assert_eq!(shown(&miasma[0]), "Phantom Streak Miasma");
    assert_eq!(miasma[0].system_id, None, "a nebula has its own position");
    common::snapshot("miasma", &report(&find(&s, "miasma", 5, &no_loc)));
}

#[test]
fn search_never_builds_the_details_projection_and_warming_widens_it() {
    let mut s = open();
    let hits = find(&s, "earth", 5, &no_loc);
    assert!(s.built_details().is_none(), "search built the details");
    assert!(of_kind(&hits, SearchKind::Planet).is_empty());
    assert!(of_kind(&hits, SearchKind::Fleet).is_empty());
    // Systems, countries and nebulae come from the galaxy projection alone.
    assert!(!of_kind(&find(&s, "miasma", 5, &no_loc), SearchKind::Nebula).is_empty());
    let man = of_kind(&find(&s, "commonwealth", 5, &no_loc), SearchKind::Country);
    assert_eq!(shown(&man[0]), "Commonwealth of Man");

    s.warm_details().expect("build details");
    s.warm_details().expect("warming twice is a no-op");
    assert!(s.built_details().is_some());
    let hits = find(&s, "earth", 5, &no_loc);
    assert_eq!(shown(&of_kind(&hits, SearchKind::Planet)[0]), "Earth");
    assert!(!of_kind(&find(&s, "ether drake", 5, &no_loc), SearchKind::Fleet).is_empty());
}

#[test]
fn an_empire_without_a_capital_goes_where_its_fleet_is() {
    let mut s = common::open_4_5();
    s.warm_details().expect("build details");
    let hits = find(&s, "automated dreadnought", 5, &no_loc);
    let empire = &of_kind(&hits, SearchKind::Country)[0];
    let fleet = &of_kind(&hits, SearchKind::Fleet)[0];
    assert_eq!(empire.system_count, Some(0), "a guardian owns no system");
    assert_eq!(empire.system_id, fleet.system_id);
    assert!(empire.position.is_some());
}

#[test]
fn a_hit_carries_the_position_of_what_it_locates() {
    let s = common::warmed();
    let sol = of_kind(&find(&s, "sol", 5, &no_loc), SearchKind::System);
    assert!(sol[0].position.is_some());

    // An unowned system carries no owner; the palette, not sgf-core, calls it unclaimed.
    let unowned = of_kind(&find(&s, "790", 5, &no_loc), SearchKind::System);
    assert_eq!(unowned[0].owner, None, "{:?}", unowned[0]);
}

#[test]
fn finds_systems_by_what_they_hold() {
    let s = common::warmed();
    let systems = |query: &str| of_kind(&find(&s, query, 20, &no_loc), SearchKind::System);
    let matched = |hits: &[SearchHit]| -> Vec<Option<String>> {
        hits.iter().map(|h| h.matched_on.clone()).collect()
    };

    let salvager = systems("salvager");
    assert_eq!(salvager[0].id, 17, "{salvager:?}");
    assert_eq!(
        salvager[0].matched_on.as_deref(),
        Some("salvager_enclave_init_01")
    );
    common::snapshot("salvager", &report(&salvager));

    let gaia = systems("gaia");
    assert!(!gaia.is_empty());
    assert!(
        gaia.iter()
            .all(|h| h.matched_on.as_deref() == Some("pc_gaia"))
    );
    let loc = |key: &str| (key == "pc_gaia").then(|| "Gaia World".to_owned());
    let localised = of_kind(&find(&s, "gaia world", 20, &loc), SearchKind::System);
    assert_eq!(localised.len(), gaia.len());
    assert_eq!(localised[0].matched_on.as_deref(), Some("Gaia World"));

    let lgates = systems("l-gate");
    assert!(!lgates.is_empty());
    assert!(
        lgates
            .iter()
            .all(|h| h.matched_on.as_deref() == Some("L-Gate"))
    );
    assert!(
        lgates
            .iter()
            .all(|h| h.matched_bypass.as_deref() == Some("l_gate"))
    );
    assert_eq!(salvager[0].matched_bypass, None);
    let wormholes = systems("wormhole");
    assert!(
        [788, 789]
            .iter()
            .all(|id| wormholes.iter().any(|h| h.id == *id)),
        "both ends of the pair"
    );
    assert!(!systems("gateway").is_empty());

    // Filler words and mid-word hits match nothing by content.
    for query in ["system", "age", "init", "01", "star", "g"] {
        assert!(
            systems(query).iter().all(|h| h.matched_on.is_none()),
            "{query}"
        );
    }

    // Every name match ranks before every content match.
    let black = systems("black");
    let first_content = black.iter().position(|h| h.matched_on.is_some());
    let first_content = first_content.expect("a black hole with another name");
    assert!(first_content > 0);
    assert!(matched(&black[first_content..]).iter().all(Option::is_some));
    common::snapshot("black", &report(&black[..first_content + 3]));
}

#[test]
fn a_special_kind_matches_only_when_game_data_names_it() {
    let s = open();
    let without = of_kind(&find(&s, "leviathan", 50, &no_loc), SearchKind::System);
    assert!(without.iter().all(|h| h.id != 31), "{without:?}");

    let lair = |id: u32| {
        if id == 31 {
            vec!["Leviathan"]
        } else {
            Vec::new()
        }
    };
    let with = of_kind(
        &s.search("leviathan", 50, &no_loc, &lair).hits,
        SearchKind::System,
    );
    let hit = with.iter().find(|h| h.id == 31).expect("the lair");
    assert_eq!(hit.matched_on.as_deref(), Some("Leviathan"));
}

#[test]
fn every_located_system_is_returned_beyond_the_limit() {
    let s = common::warmed();
    let all = s.search("gaia", 100, &no_loc, &no_special);
    let few = s.search("gaia", 2, &no_loc, &no_special);
    assert_eq!(of_kind(&few.hits, SearchKind::System).len(), 2);
    assert_eq!(few.systems, all.systems);
    assert!(
        few.systems.windows(2).all(|w| w[0] < w[1]),
        "ascending, no repeats"
    );

    // A planet locates its system; a nebula locates none.
    let earth = s.search("earth", 5, &no_loc, &no_special);
    assert!(earth.systems.contains(&217), "{:?}", earth.systems);
    let miasma = s.search("miasma", 5, &no_loc, &no_special);
    assert!(miasma.systems.is_empty(), "{:?}", miasma.systems);
}
