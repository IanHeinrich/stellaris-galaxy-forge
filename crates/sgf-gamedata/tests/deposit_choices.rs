//! The deposit types a planet's page offers, on a hand-written install: the families that
//! gather types yielding the same resources, the duplicates left out of them, the category
//! each is filed under, and which the roll could place on the planet.

use crate::common;

use sgf_gamedata::choices::AskedBody;
use sgf_gamedata::deposit_choices::{DepositCategory, DepositChoice};

const FILES: [(&str, &str); 4] = [
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_rock = {\n\tplanet_size = { min = 10 max = 20 }\n\tmoon_size = { min = 2 max = 6 }\n}\n",
    ),
    (
        "common/deposit_categories/00_fx.txt",
        "deposit_cat_blockers = {\n\tblocker = yes\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_null_deposit = {\n\tis_null = yes\n}\n\
         d_fx_energy_0old = {\n\tresources = { category = orbital_mining_deposits produces = { energy = 1 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_energy_1 = {\n\tresources = { category = orbital_mining_deposits produces = { energy = 1 } }\n}\n\
         d_fx_energy_2 = {\n\tresources = { category = orbital_mining_deposits produces = { energy = 2 } }\n\tpotential = { is_moon = yes }\n}\n\
         d_fx_energy_10 = {\n\tresources = { category = orbital_mining_deposits produces = { energy = 10 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_generator = {\n\tresources = { category = orbital_mining_deposits produces = { energy = 1 } }\n\tplanet_modifier = { district_generator_max_add = 1 }\n}\n\
         d_fx_artifacts_research_1 = {\n\tresources = { category = orbital_mining_deposits produces = { minor_artifacts = 1 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_artifacts_planet_1 = {\n\tresources = { category = orbital_mining_deposits produces = { minor_artifacts = 1 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_artifacts_mining_2 = {\n\tresources = { category = orbital_mining_deposits produces = { minor_artifacts = 2 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_nanite_small = {\n\tresources = { category = orbital_mining_deposits produces = { nanites = 0.1 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_nanite_large = {\n\tresources = { category = orbital_mining_deposits produces = { nanites = 25.6 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_minerals = {\n\tresources = { category = orbital_mining_deposits produces = { minerals = 1 } }\n}\n\
         d_fx_food = {\n\tresources = { category = orbital_mining_deposits produces = { food = 2 } }\n}\n\
         d_fx_gas = {\n\tresources = { category = orbital_mining_deposits produces = { sr_exotic_gases = 3 } }\n}\n\
         d_fx_lab = {\n\tresources = { category = orbital_mining_deposits produces = { physics_research = 2 } }\n}\n\
         d_fx_alloys = {\n\tresources = { category = orbital_mining_deposits produces = { alloys = 5 sr_exotic_gases = 3 } }\n}\n\
         d_fx_mountains = {\n\tplanet_modifier = { district_mining_max_add = 1 }\n}\n\
         d_fx_big = {\n\tpotential = { planet_size >= 18 }\n}\n\
         d_fx_small = {\n\tpotential = { planet_size < 12 }\n}\n\
         d_fx_huge = {\n\tpotential = { planet_size >= 25 }\n}\n\
         d_fx_relic = {\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_rising = {\n\tdrop_weight = { weight = 0 modifier = { add = 5 is_moon = yes } }\n}\n\
         d_fx_exotic_mountain = {
	is_for_colonizable = yes
	resources = { category = planet_deposits produces = { sr_exotic_gases = 3 } }
}
         d_fx_glacier = {\n\tcategory = deposit_cat_blockers\n\tis_for_colonizable = yes\n}\n",
    ),
    (
        "localisation/english/fx_l_english.yml",
        "l_english:\n d_fx_relic_desc:0 \"A relic of an older age.\"\n",
    ),
];

fn choice<'a>(choices: &'a [DepositChoice], key: &str) -> &'a DepositChoice {
    choices
        .iter()
        .find(|c| c.key == key)
        .unwrap_or_else(|| panic!("{key} is offered"))
}

fn rock() -> AskedBody<'static> {
    AskedBody {
        class: Some("pc_fx_rock"),
        size: Some(15),
        moon: false,
    }
}

#[test]
fn types_yielding_the_same_resources_share_a_family_with_one_button_per_amount() {
    let (_dir, gd) = common::hand_written(&FILES);
    let choices = gd.deposit_choices(&rock(), &[]);
    assert!(choices.iter().all(|c| c.key != "d_null_deposit"));
    let offered = |key: &str| choices.iter().any(|c| c.key == key);

    for (key, amount) in [
        ("d_fx_energy_1", 1.0),
        ("d_fx_energy_2", 2.0),
        ("d_fx_energy_10", 10.0),
    ] {
        let c = choice(&choices, key);
        assert_eq!(
            (c.family.as_str(), c.amount),
            ("yields:energy", Some(amount))
        );
    }
    assert!(
        !offered("d_fx_energy_0old"),
        "the same +1 Energy as d_fx_energy_1, which the roll could place here"
    );
    let generator = choice(&choices, "d_fx_generator");
    assert_ne!(
        generator.family, "yields:energy",
        "the same +1 Energy with a district of its own keeps a button of its own"
    );

    let artifacts = choice(&choices, "d_fx_artifacts_planet_1");
    assert_eq!(artifacts.family, "yields:minor_artifacts");
    assert!(
        !offered("d_fx_artifacts_research_1"),
        "the same +1 Minor Artifacts as the first by key"
    );
    assert_eq!(
        choice(&choices, "d_fx_artifacts_mining_2").family,
        "yields:minor_artifacts"
    );

    let nanites: Vec<Option<f64>> = ["d_fx_nanite_small", "d_fx_nanite_large"]
        .iter()
        .map(|key| {
            let c = choice(&choices, key);
            assert_eq!(c.family, "yields:nanites", "keys without a number join too");
            c.amount
        })
        .collect();
    assert_eq!(nanites, [Some(0.1), Some(25.6)]);

    let exotic = choice(&choices, "d_fx_exotic_mountain");
    assert_eq!(
        exotic.family, "d_fx_exotic_mountain",
        "a named feature keeps its own row though it yields what d_fx_gas does"
    );
    assert_eq!(
        choice(&choices, "d_fx_gas").family,
        "yields:sr_exotic_gases"
    );

    let mountains = choice(&choices, "d_fx_mountains");
    assert_eq!(
        (mountains.family.as_str(), mountains.amount),
        ("d_fx_mountains", None)
    );
    assert_eq!(
        choice(&choices, "d_fx_relic").description.as_deref(),
        Some("A relic of an older age.")
    );
    assert_eq!(mountains.description, None);
}

#[test]
fn each_type_is_filed_under_a_category_and_marked_where_the_roll_could_place_it() {
    let (_dir, gd) = common::hand_written(&FILES);
    let choices = gd.deposit_choices(&rock(), &[]);
    let category = |key: &str| choice(&choices, key).category;
    assert_eq!(category("d_fx_energy_1"), DepositCategory::Energy);
    assert_eq!(category("d_fx_minerals"), DepositCategory::Minerals);
    assert_eq!(category("d_fx_food"), DepositCategory::Food);
    assert_eq!(category("d_fx_gas"), DepositCategory::Strategic);
    assert_eq!(category("d_fx_lab"), DepositCategory::Research);
    assert_eq!(category("d_fx_alloys"), DepositCategory::Strategic);
    assert_eq!(category("d_fx_mountains"), DepositCategory::Features);
    assert_eq!(category("d_fx_energy_10"), DepositCategory::Special);
    assert_eq!(category("d_fx_relic"), DepositCategory::Special);
    assert_eq!(
        category("d_fx_rising"),
        DepositCategory::Features,
        "a weight a modifier can raise is rolled somewhere"
    );
    assert_eq!(category("d_fx_glacier"), DepositCategory::Blockers);
    assert!(!choice(&choices, "d_fx_glacier").event_only);
    assert!(choice(&choices, "d_fx_relic").event_only);

    let usual = |choices: &[DepositChoice], key: &str| choice(choices, key).usual;
    assert!(usual(&choices, "d_fx_energy_1"));
    assert!(
        !usual(&choices, "d_fx_energy_2"),
        "its potential wants a moon"
    );
    assert!(!usual(&choices, "d_fx_energy_10"), "it weighs nothing");
    assert!(
        !usual(&choices, "d_fx_rising"),
        "it weighs nothing on a planet"
    );
    assert!(
        !usual(&choices, "d_fx_glacier"),
        "the rock cannot be colonised"
    );
    let moon = AskedBody {
        moon: true,
        ..rock()
    };
    let on_a_moon = gd.deposit_choices(&moon, &[]);
    assert!(usual(&on_a_moon, "d_fx_energy_2"));
    assert!(usual(&on_a_moon, "d_fx_rising"));
}

fn keys(choices: &[DepositChoice]) -> Vec<&str> {
    choices.iter().map(|c| c.key.as_str()).collect()
}

#[test]
fn a_planet_of_no_class_offers_one_type_per_button_with_none_usual() {
    let (_dir, gd) = common::hand_written(&FILES);
    let shape = |choices: &[DepositChoice]| -> Vec<(String, Option<f64>)> {
        choices
            .iter()
            .map(|c| (c.family.clone(), c.amount))
            .collect()
    };
    let known = gd.deposit_choices(&rock(), &[]);
    let unknown = AskedBody {
        class: None,
        ..rock()
    };
    let choices = gd.deposit_choices(&unknown, &[]);
    assert_eq!(shape(&choices), shape(&known));
    assert!(choices.iter().all(|c| !c.usual));
    assert!(
        keys(&choices).contains(&"d_fx_energy_0old"),
        "with none usual, the first by key stands for its family"
    );
}

#[test]
fn the_real_install_offers_every_choice_of_a_class_at_no_size() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let asked = |class, size| AskedBody {
        class,
        size,
        moon: false,
    };
    let none = gd.deposit_choices(&asked(None, None), &[]);
    let any_size = gd.deposit_choices(&asked(Some("pc_arctic"), None), &[]);
    assert!(none.iter().all(|c| !c.usual));
    assert_eq!(keys(&none), keys(&any_size));
    let usual = |choices: &[DepositChoice], key: &str| choice(choices, key).usual;
    assert!(usual(&any_size, "d_massive_glacier"));

    let at_size = |size| gd.deposit_choices(&asked(Some("pc_arctic"), Some(size)), &[]);
    let range = gd
        .planet_classes
        .get("pc_arctic")
        .and_then(|c| c.planet_size)
        .expect("a size range");
    let every_size: Vec<Vec<DepositChoice>> = (range.min.round() as u32..=range.max.round() as u32)
        .map(at_size)
        .collect();
    for c in &any_size {
        let at_any = every_size.iter().any(|s| usual(s, &c.key));
        assert_eq!(c.usual, at_any, "{}", c.key);
    }
}

#[test]
fn a_planet_of_no_size_is_judged_at_every_size_its_class_draws() {
    let (_dir, gd) = common::hand_written(&FILES);
    let usual = |size| {
        let asked = AskedBody { size, ..rock() };
        let choices = gd.deposit_choices(&asked, &[]);
        ["d_fx_small", "d_fx_big", "d_fx_huge"].map(|key| choice(&choices, key).usual)
    };
    assert_eq!(usual(Some(15)), [false, false, false]);
    assert_eq!(usual(None), [true, true, false], "the rock draws 10 to 20");
    let any = gd.deposit_choices(
        &AskedBody {
            size: None,
            ..rock()
        },
        &[],
    );
    assert!(choice(&any, "d_fx_energy_1").usual);
}

#[test]
fn a_moon_of_no_size_is_judged_over_its_class_moon_sizes() {
    let (_dir, gd) = common::hand_written(&FILES);
    let moon = AskedBody {
        size: None,
        moon: true,
        ..rock()
    };
    let choices = gd.deposit_choices(&moon, &[]);
    let usual = ["d_fx_small", "d_fx_big", "d_fx_huge"].map(|key| choice(&choices, key).usual);
    assert_eq!(usual, [true, false, false], "the rock's moons draw 2 to 6");
}

#[test]
fn a_planet_of_an_unknown_class_and_no_size_has_none_usual() {
    let (_dir, gd) = common::hand_written(&FILES);
    let unknown = AskedBody {
        class: Some("pc_fx_unknown"),
        size: None,
        moon: false,
    };
    let choices = gd.deposit_choices(&unknown, &[]);
    assert!(!choices.is_empty() && choices.iter().all(|c| !c.usual));
}
