//! Search by id and name on the real sample save.
use sgf_core::projections::galaxy::display_name;
use sgf_core::session::Session;
use sgf_core::views::{SearchHit, SearchKind};

mod common;
use common::open;

/// Planets and fleets are searched only once the details projection is built.
fn warm() -> Session {
    let mut session = open();
    session.warm_details().expect("build details");
    session
}

fn no_loc(_: &str) -> Option<String> {
    None
}

/// What the palette shows without game data, as `app/src/lib/names.ts` resolves the template.
fn shown(h: &SearchHit) -> String {
    display_name(&h.name_key)
}

fn of_kind(hits: &[SearchHit], kind: SearchKind) -> Vec<SearchHit> {
    hits.iter().filter(|h| h.kind == kind).cloned().collect()
}

/// The fields the palette phrases.
fn fields(h: &SearchHit) -> String {
    let mut parts = Vec::new();
    if let Some(owner) = &h.owner {
        parts.push(format!("owner={}", display_name(&owner.stand_in())));
    }
    if let Some(country_type) = &h.country_type {
        parts.push(format!("type={country_type}"));
    }
    if let Some(count) = h.system_count {
        parts.push(format!("systems={count}"));
    }
    if let Some(class) = &h.planet_class {
        parts.push(format!("class={class}"));
    }
    if parts.is_empty() {
        "-".to_owned()
    } else {
        parts.join(" ")
    }
}

fn report(hits: &[SearchHit]) -> String {
    hits.iter()
        .map(|h| {
            let system = h
                .system_id
                .map_or_else(|| "-".to_owned(), |id| format!("#{id}"));
            let at = h
                .position
                .map_or_else(|| "nowhere".to_owned(), |[x, y]| format!("({x}, {y})"));
            format!(
                "{:?} #{} {} · {} → {} at {at}",
                h.kind,
                h.id,
                shown(h),
                fields(h),
                system
            )
        })
        .collect::<Vec<String>>()
        .join("\n")
}

#[test]
fn finds_systems_by_name_and_id() {
    let s = open();

    let hits = of_kind(&s.search("gamma", 10, &no_loc), SearchKind::System);
    assert_eq!(hits[0].id, 0, "{hits:?}");
    assert_eq!(hits[0].name_key, "NAME_Gamma_Refuge");
    assert_eq!(shown(&hits[0]), "Gamma Refuge");
    assert_eq!(hits[0].system_id, Some(0));
    assert_eq!(hits[0].position, Some([-144.22, 57.36]));
    assert!(hits.len() <= 10);

    // Exact display name, any case, with or without the prefix.
    assert_eq!(s.search("Gamma Refuge", 10, &no_loc)[0].id, 0);
    assert_eq!(s.search("  gamma refuge ", 10, &no_loc)[0].id, 0);
    assert_eq!(s.search("NAME_Gamma_Refuge", 10, &no_loc)[0].id, 0);

    // An id wins over any name match.
    let hits = of_kind(&s.search("0", 10, &no_loc), SearchKind::System);
    assert_eq!(hits[0].id, 0);
    assert!(hits.iter().filter(|h| h.id == 0).count() == 1);
    assert_eq!(s.search("790", 10, &no_loc)[0].id, 790);

    // A word-start match ranks above a mid-word substring, ties by id.
    let hits = of_kind(&s.search("refuge", 10, &no_loc), SearchKind::System);
    assert_eq!(hits[0].id, 0);
    let ids: Vec<u32> = hits.iter().map(|h| h.id).collect();
    let mut sorted = ids.clone();
    sorted.sort_unstable();
    assert_eq!(ids, sorted, "same rank, id ascending");

    assert!(s.search("", 10, &no_loc).is_empty());
    assert!(s.search("   ", 10, &no_loc).is_empty());
    assert!(s.search("no such system anywhere", 10, &no_loc).is_empty());
}

#[test]
fn matches_the_resolved_name_and_carries_the_template() {
    let s = open();
    let loc = |key: &str| (key == "NAME_Gamma_Refuge").then(|| "The Haven".to_owned());

    let hits = s.search("haven", 10, &loc);
    assert_eq!(hits[0].id, 0, "{hits:?}");
    assert_eq!(
        hits[0].name.key, "NAME_Gamma_Refuge",
        "the UI resolves the name"
    );
    assert_eq!(s.search("The Haven", 10, &loc)[0].id, 0);

    // The key still matches when the localised text does not.
    assert_eq!(s.search("gamma refuge", 10, &loc)[0].id, 0);

    // Unresolved systems fall back to the display form of the key.
    let other = s.search("790", 10, &loc);
    assert_eq!(other[0].id, 790);
    assert!(
        !shown(&other[0]).starts_with("NAME_"),
        "{}",
        shown(&other[0])
    );
}

#[test]
fn respects_the_limit_within_each_kind() {
    let s = warm();
    let all = of_kind(&s.search("a", 1000, &no_loc), SearchKind::System);
    assert!(all.len() > 3, "{}", all.len());
    let three = s.search("a", 3, &no_loc);
    assert_eq!(of_kind(&three, SearchKind::System).len(), 3);
    assert_eq!(of_kind(&three, SearchKind::Planet).len(), 3);
    assert_eq!(of_kind(&three, SearchKind::System), all[..3]);
    assert!(s.search("a", 0, &no_loc).is_empty());
}

#[test]
fn hits_come_back_grouped_by_kind() {
    let s = warm();
    let hits = s.search("a", 5, &no_loc);
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
    let s = warm();

    let earth = of_kind(&s.search("earth", 5, &no_loc), SearchKind::Planet);
    assert_eq!(shown(&earth[0]), "Earth");
    assert_eq!(earth[0].system_id, Some(217), "Earth is in Sol");
    common::snapshot("earth", &report(&s.search("earth", 5, &no_loc)));

    let man = of_kind(&s.search("commonwealth", 5, &no_loc), SearchKind::Country);
    assert_eq!(shown(&man[0]), "Commonwealth of Man");
    assert_eq!(man[0].system_id, Some(4), "its capital's system");
    assert_eq!(man[0].country_type.as_deref(), Some("default"));
    assert!(man[0].system_count.is_some_and(|n| n > 0));
    common::snapshot(
        "commonwealth",
        &report(&s.search("commonwealth", 5, &no_loc)),
    );

    let drake = of_kind(&s.search("ether drake", 5, &no_loc), SearchKind::Fleet);
    assert_eq!(shown(&drake[0]), "Ether Drake");
    assert!(drake[0].system_id.is_some(), "the system it sits in");
    assert!(drake[0].owner.is_some(), "the country running it");
    common::snapshot("ether_drake", &report(&s.search("ether drake", 5, &no_loc)));

    // A templated name travels whole, so the UI resolves it instead of showing the stand-in.
    let trans = of_kind(&s.search("commonwealth", 5, &no_loc), SearchKind::Fleet);
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

    let miasma = of_kind(&s.search("miasma", 5, &no_loc), SearchKind::Nebula);
    assert_eq!(shown(&miasma[0]), "Phantom Streak Miasma");
    assert_eq!(miasma[0].system_id, None, "a nebula has its own position");
    common::snapshot("miasma", &report(&s.search("miasma", 5, &no_loc)));
}

#[test]
fn search_never_builds_the_details_projection_and_warming_widens_it() {
    let mut s = open();
    let hits = s.search("earth", 5, &no_loc);
    assert!(s.built_details().is_none(), "search built the details");
    assert!(of_kind(&hits, SearchKind::Planet).is_empty());
    assert!(of_kind(&hits, SearchKind::Fleet).is_empty());
    // Systems, countries and nebulae come from the galaxy projection alone.
    assert!(!of_kind(&s.search("miasma", 5, &no_loc), SearchKind::Nebula).is_empty());
    let man = of_kind(&s.search("commonwealth", 5, &no_loc), SearchKind::Country);
    assert_eq!(shown(&man[0]), "Commonwealth of Man");

    s.warm_details().expect("build details");
    s.warm_details().expect("warming twice is a no-op");
    assert!(s.built_details().is_some());
    let hits = s.search("earth", 5, &no_loc);
    assert_eq!(shown(&of_kind(&hits, SearchKind::Planet)[0]), "Earth");
    assert!(!of_kind(&s.search("ether drake", 5, &no_loc), SearchKind::Fleet).is_empty());
}

#[test]
fn a_hit_with_nowhere_to_pan_has_no_position() {
    let s = warm();
    let marauders = of_kind(&s.search("marauders", 5, &no_loc), SearchKind::Country);
    let hit = marauders.first().expect("a marauder country");
    assert_eq!(hit.system_id, None, "{hit:?}");
    assert_eq!(hit.position, None, "not the galaxy centre");

    let sol = of_kind(&s.search("sol", 5, &no_loc), SearchKind::System);
    assert!(sol[0].position.is_some());

    // An unowned system carries no owner; the palette, not sgf-core, calls it unclaimed.
    let unowned = of_kind(&s.search("790", 5, &no_loc), SearchKind::System);
    assert_eq!(unowned[0].owner, None, "{:?}", unowned[0]);
}
