//! The special-systems classifier on the sample save: flags only, then
//! with the real install when one exists.

use crate::common;

use std::sync::LazyLock;

use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_gamedata::special::{KIND_ORDER, SpecialKind, SpecialSystems, classify, classify_session};

/// The sample save's galaxy, parsed once for every test in this file.
static GRAPH: LazyLock<GalaxyGraph> = LazyLock::new(|| common::open_4_4().graph);

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
        (SpecialKind::HolyWorld, 4),
        (SpecialKind::Contingency, 4),
        (SpecialKind::HorizonSignal, 1),
        (SpecialKind::Cutholoid, 20),
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
    assert_eq!(result.systems.len(), 120);
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

/// Kinds galaxy generation places that wait for something to trigger them.
const HIDDEN: [SpecialKind; 3] = [
    SpecialKind::Contingency,
    SpecialKind::HorizonSignal,
    SpecialKind::Cutholoid,
];

#[test]
fn unique_applies_only_when_nothing_but_hidden_content_matched() {
    let result = classify(&GRAPH, None);
    for s in &result.systems {
        let unique = s.kinds.contains(&SpecialKind::Unique);
        let others: Vec<_> = s
            .kinds
            .iter()
            .filter(|&&k| k != SpecialKind::Unique)
            .collect();
        if unique {
            assert!(
                others.iter().all(|k| HIDDEN.contains(k)),
                "#{} {:?}",
                s.id,
                s.kinds
            );
            assert_eq!(s.primary, SpecialKind::Unique, "#{}", s.id);
        }
        assert_eq!(s.primary, s.kinds[0]);
    }
}

/// A scripted system that also hides a Cutholoid or the Horizon Signal stays a scripted
/// system first; a Contingency hub's own initializer does not make it one.
#[test]
fn hidden_content_leaves_a_scripted_system_unique() {
    let mut graph = GRAPH.clone();
    let scripted = classify(&graph, None)
        .systems
        .into_iter()
        .find(|s| s.kinds == [SpecialKind::Unique])
        .expect("a scripted system")
        .id;
    let flags = &mut graph.systems.get_mut(&scripted).unwrap().flags;
    flags.push("hidden_cutholoid".to_owned());
    flags.push("horizonsignal_spawn".to_owned());
    let result = classify(&graph, None);
    let system = result.systems.iter().find(|s| s.id == scripted).unwrap();
    assert_eq!(
        system.kinds,
        [
            SpecialKind::Unique,
            SpecialKind::HorizonSignal,
            SpecialKind::Cutholoid
        ]
    );
    assert_eq!(system.primary, SpecialKind::Unique);
    for hub in result
        .systems
        .iter()
        .filter(|s| s.initializer.starts_with("ai_system_"))
    {
        assert_eq!(hub.kinds, [SpecialKind::Contingency], "#{}", hub.id);
    }
}

#[test]
fn game_data_keeps_the_counts_and_adds_names() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let result = classify(&GRAPH, Some(gd));
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
    let session = common::open_4_4();
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
#[test]
fn a_salvager_enclaves_templated_country_name_resolves_and_is_flagged_generated() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let result = classify_session(&session, Some(gd));
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
    let sample_44 = common::open_4_4();
    let with_44_countries = classify_session(&sample_44, Some(gd));
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

/// What each sample's galaxy generation hid: four Contingency hubs whichever crisis comes, the
/// Holy Guardians' holy worlds inside their territory, hidden Cutholoids, and in the 4.4 save
/// the Horizon Signal's black hole.
#[test]
fn hidden_content_is_marked_by_the_flags_generation_set() {
    let primaries = |result: &SpecialSystems, kind: SpecialKind| -> Vec<u32> {
        result
            .systems
            .iter()
            .filter(|s| s.primary == kind)
            .map(|s| s.id)
            .collect()
    };
    for (label, session, horizon, cutholoids, shared) in [
        ("4.4", common::open_4_4(), 1, 20, 1),
        ("4.5", common::open_4_5(), 0, 15, 3),
    ] {
        let result = classify(&session.graph, None);
        let hubs: Vec<_> = result
            .systems
            .iter()
            .filter(|s| s.kinds.contains(&SpecialKind::Contingency))
            .collect();
        assert_eq!(hubs.len(), 4, "{label}");
        for hub in hubs {
            assert_eq!(hub.primary, SpecialKind::Contingency, "{label}");
            assert!(hub.initializer.starts_with("ai_system_"), "{label}");
        }
        let holy: Vec<_> = result
            .systems
            .iter()
            .filter(|s| s.kinds.contains(&SpecialKind::HolyWorld))
            .collect();
        assert_eq!(holy.len(), 4, "{label}");
        for world in holy {
            assert_eq!(
                world.kinds[..2],
                [SpecialKind::HolyWorld, SpecialKind::FallenEmpire],
                "{label}"
            );
        }
        assert_eq!(
            count(&result, SpecialKind::HorizonSignal),
            horizon,
            "{label}"
        );
        assert_eq!(
            count(&result, SpecialKind::Cutholoid),
            cutholoids,
            "{label}"
        );
        assert_eq!(
            primaries(&result, SpecialKind::Cutholoid).len(),
            cutholoids as usize - shared,
            "{label}: a system that is something else first keeps that badge"
        );
    }
}

#[test]
fn the_precedence_order_lists_every_kind_once() {
    let every = [
        SpecialKind::Leviathan,
        SpecialKind::Enclave,
        SpecialKind::Marauder,
        SpecialKind::HolyWorld,
        SpecialKind::FallenEmpire,
        SpecialKind::Landmark,
        SpecialKind::Unique,
        SpecialKind::Contingency,
        SpecialKind::HorizonSignal,
        SpecialKind::Cutholoid,
    ];
    for kind in every {
        match kind {
            SpecialKind::Leviathan
            | SpecialKind::Enclave
            | SpecialKind::Marauder
            | SpecialKind::HolyWorld
            | SpecialKind::FallenEmpire
            | SpecialKind::Landmark
            | SpecialKind::Unique
            | SpecialKind::Contingency
            | SpecialKind::HorizonSignal
            | SpecialKind::Cutholoid => {
                let listed = KIND_ORDER.iter().filter(|k| **k == kind).count();
                assert_eq!(listed, 1, "{kind:?}");
            }
        }
    }
    assert_eq!(KIND_ORDER.len(), every.len());
}
