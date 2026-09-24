//! The special-systems classifier on the sample save: flags only, then
//! with the real install when one exists.

use crate::common;

use std::sync::LazyLock;

use sgf_core::document::Document;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::session::Session;
use sgf_gamedata::special::{KIND_ORDER, SpecialKind, SpecialSystems, classify, classify_session};

use common::SAMPLE;

/// The sample save's galaxy, parsed once for every test in this file.
static GRAPH: LazyLock<GalaxyGraph> = LazyLock::new(|| {
    let doc = Document::load(SAMPLE).expect("sample save");
    GalaxyGraph::build(&doc).expect("galaxy graph")
});

fn count(result: &SpecialSystems, kind: SpecialKind) -> u32 {
    result
        .counts
        .iter()
        .find(|c| c.kind == kind)
        .map(|c| c.count)
        .unwrap_or(0)
}

fn assert_sample_counts(result: &SpecialSystems) {
    let expected = [
        (SpecialKind::Leviathan, 6),
        (SpecialKind::Enclave, 14),
        (SpecialKind::Marauder, 6),
        (SpecialKind::Landmark, 11),
    ];
    for (kind, n) in expected {
        assert_eq!(count(result, kind), n, "{kind:?}");
    }
}

#[test]
fn flags_only_counts_match_the_shipped_classifier() {
    let result = classify(&GRAPH, None);
    assert!(!result.with_game_data);
    assert_sample_counts(&result);
    assert_eq!(result.counts.len(), KIND_ORDER.len());
    assert_eq!(result.systems.len(), 100);
    let landmark = result
        .counts
        .iter()
        .find(|c| c.kind == SpecialKind::Landmark)
        .unwrap();
    assert_eq!(landmark.primary_count, 11);
}

#[test]
fn a_guardian_is_a_leviathan_and_labels_fall_back_to_the_name_key() {
    let result = classify(&GRAPH, None);
    let dragon = result
        .systems
        .iter()
        .find(|s| s.initializer == "guardians_init_dragon")
        .expect("the dragon's system");
    assert!(dragon.flags.iter().any(|f| f == "guardian"));
    assert_eq!(dragon.primary, SpecialKind::Leviathan);
    assert_eq!(dragon.kinds, [SpecialKind::Leviathan]);
    assert!(!dragon.initializer_known);
    assert_eq!(dragon.source_file, None, "no game data, no source file");
    assert!(dragon.countries.is_empty());
    assert!(!dragon.label.is_empty());
    assert!(!dragon.label.starts_with("NAME_"), "{}", dragon.label);
}

#[test]
fn unique_applies_only_when_nothing_else_matched() {
    let result = classify(&GRAPH, None);
    for s in &result.systems {
        let unique = s.kinds.contains(&SpecialKind::Unique);
        assert_eq!(
            unique,
            s.kinds == [SpecialKind::Unique],
            "#{} {:?}",
            s.id,
            s.kinds
        );
        assert_eq!(s.primary, s.kinds[0]);
    }
}

#[test]
fn game_data_keeps_the_counts_and_adds_names() {
    let Some(gd) = common::load_real() else {
        return;
    };
    let result = classify(&GRAPH, Some(&gd));
    assert!(result.with_game_data);
    assert_sample_counts(&result);
    let dragon = result
        .systems
        .iter()
        .find(|s| s.initializer == "guardians_init_dragon")
        .expect("the dragon's system");
    assert!(dragon.initializer_known);
    assert_eq!(
        dragon.source_file.as_deref(),
        Some("leviathans_system_initializers.txt")
    );
    assert_eq!(dragon.label, "Voidwyrm");
    assert_eq!(dragon.countries.len(), 1);
    assert_eq!(dragon.countries[0].country_type, "guardian_dragon");
    assert_eq!(dragon.countries[0].name.as_deref(), Some("Voidwyrm"));
    let known = result
        .systems
        .iter()
        .filter(|s| s.initializer_known)
        .count();
    assert!(
        known * 10 >= result.systems.len() * 9,
        "{known} of {} known",
        result.systems.len()
    );
}

#[test]
fn a_system_with_no_initializer_country_is_named_after_the_country_in_it() {
    let session = Session::open(SAMPLE).expect("sample save");
    let result = classify_session(&session, None);
    assert_sample_counts(&result);
    let shroudwalkers = result
        .systems
        .iter()
        .find(|s| s.initializer == "shroudwalker_enclave_init_01")
        .expect("the shroudwalker enclave");
    assert_eq!(shroudwalkers.primary, SpecialKind::Enclave);
    assert_eq!(shroudwalkers.countries.len(), 1);
    assert_eq!(shroudwalkers.countries[0].country_type, "enclave");
    assert_eq!(
        shroudwalkers.countries[0].name.as_deref(),
        Some("Covenant of the Shroud")
    );
    assert_eq!(shroudwalkers.label, "Covenant of the Shroud");
    let without = classify(&session.graph, None);
    let fallback = without
        .systems
        .iter()
        .find(|s| s.id == shroudwalkers.id)
        .expect("the same system");
    assert!(fallback.countries.is_empty());
    assert_ne!(fallback.label, shroudwalkers.label);
}

/// The 4.5 save's day-one Salvager Enclave: its country's name is a template
/// (`%ADJ%` over `Union_of` over `Scrappers`), unresolvable through a single localisation
/// lookup, and the shroudwalkers' `AofB` name shows the same is true of another enclave.
const SAMPLE_45: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2201.03.25.sav");

#[test]
fn a_salvager_enclaves_templated_country_name_resolves_and_is_flagged_generated() {
    let Some(gd) = common::load_real() else {
        return;
    };
    let session = Session::open(SAMPLE_45).expect("4.5 sample save");
    let result = classify_session(&session, Some(&gd));
    let salvager = result
        .systems
        .iter()
        .find(|s| s.initializer.starts_with("salvager_enclave_init") && !s.countries.is_empty())
        .expect("the salvager enclave's own system");
    assert_eq!(salvager.primary, SpecialKind::Enclave);
    assert_eq!(salvager.countries.len(), 1);
    assert_eq!(salvager.countries[0].country_type, "enclave");
    assert_eq!(
        salvager.countries[0].name.as_deref(),
        Some("Union of Scrappers")
    );
    assert!(salvager.countries[0].generated_name);
    assert_eq!(salvager.label, "Union of Scrappers");
    assert!(salvager.label_is_generated_name);

    // The 4.4 sample's own shroudwalker enclave is built the same way (a save-only
    // template, not a fixed key: `AofB` over "Covenant" and "the_Shroud"), so the
    // generated-name flag alone is not what keeps a shroudwalker badge showing its own
    // name; that is a choice the UI makes, not this classifier.
    let sample_44 = Session::open(SAMPLE).expect("4.4 sample save");
    let with_44_countries = classify_session(&sample_44, Some(&gd));
    let shroudwalkers = with_44_countries
        .systems
        .iter()
        .find(|s| s.initializer == "shroudwalker_enclave_init_01")
        .expect("the 4.4 sample's shroudwalker enclave");
    assert_eq!(shroudwalkers.label, "Covenant of the Shroud");
    assert!(shroudwalkers.label_is_generated_name);

    for kind in [
        "guardians_trader_init",
        "guardians_artist_init",
        "guardians_curator_init",
    ] {
        let system = result
            .systems
            .iter()
            .find(|s| s.initializer.starts_with(kind))
            .unwrap_or_else(|| panic!("a {kind} system"));
        assert!(
            !system.label_is_generated_name,
            "{kind} names its country from game data, not the save's own template"
        );
    }
}
