//! The deposit types a planet's page offers, on a hand-written install: the families that
//! collapse types differing only in amount, the category each is filed under, and which the
//! roll could place on the planet.

use crate::common;

use sgf_gamedata::deposit_choices::{DepositCategory, DepositChoice, deposit_choices};
use sgf_gamedata::deposit_roll::RollBody;

const FILES: [(&str, &str); 3] = [
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_rock = {\n\tplanet_size = { min = 10 max = 20 }\n}\n",
    ),
    (
        "common/deposit_categories/00_fx.txt",
        "deposit_cat_blockers = {\n\tblocker = yes\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_null_deposit = {\n\tis_null = yes\n}\n\
         d_fx_energy_1 = {\n\tresources = { produces = { energy = 1 } }\n}\n\
         d_fx_energy_2 = {\n\tresources = { produces = { energy = 2 } }\n\tpotential = { is_moon = yes }\n}\n\
         d_fx_energy_10 = {\n\tresources = { produces = { energy = 10 } }\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_mixed_1 = {\n\tresources = { produces = { minerals = 1 } }\n}\n\
         d_fx_mixed_2 = {\n\tresources = { produces = { food = 2 } }\n}\n\
         d_fx_gas_3 = {\n\tresources = { produces = { sr_exotic_gases = 3 } }\n}\n\
         d_fx_lab = {\n\tresources = { produces = { physics_research = 2 } }\n}\n\
         d_fx_alloys = {\n\tresources = { produces = { alloys = 5 sr_exotic_gases = 3 } }\n}\n\
         d_fx_mountains = {\n\tplanet_modifier = { district_mining_max_add = 1 }\n}\n\
         d_fx_relic = {\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_rising = {\n\tdrop_weight = { weight = 0 modifier = { add = 5 is_moon = yes } }\n}\n\
         d_fx_glacier = {\n\tcategory = deposit_cat_blockers\n\tis_for_colonizable = yes\n}\n",
    ),
];

fn choice<'a>(choices: &'a [DepositChoice], key: &str) -> &'a DepositChoice {
    choices
        .iter()
        .find(|c| c.key == key)
        .unwrap_or_else(|| panic!("{key} is offered"))
}

#[test]
fn every_type_but_the_null_one_is_offered_with_its_family_category_and_fit() {
    let (_dir, gd) = common::hand_written(&FILES);
    let rock = RollBody {
        class: "pc_fx_rock",
        size: 15,
        star: false,
        moon: false,
    };
    let choices = deposit_choices(&gd, &rock, &[]);
    assert!(choices.iter().all(|c| c.key != "d_null_deposit"));
    assert_eq!(choices.len(), 12);

    for (key, amount) in [
        ("d_fx_energy_1", 1.0),
        ("d_fx_energy_2", 2.0),
        ("d_fx_energy_10", 10.0),
    ] {
        let c = choice(&choices, key);
        assert_eq!((c.family.as_str(), c.amount), ("d_fx_energy", Some(amount)));
    }
    for key in ["d_fx_mixed_1", "d_fx_mixed_2", "d_fx_gas_3"] {
        let c = choice(&choices, key);
        assert_eq!(
            (c.family.as_str(), c.amount),
            (key, None),
            "a stem shared with other resources, or held by one type, is no family"
        );
    }

    let category = |key: &str| choice(&choices, key).category;
    assert_eq!(category("d_fx_energy_1"), DepositCategory::Energy);
    assert_eq!(category("d_fx_mixed_1"), DepositCategory::Minerals);
    assert_eq!(category("d_fx_mixed_2"), DepositCategory::Food);
    assert_eq!(category("d_fx_gas_3"), DepositCategory::Strategic);
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
    let moon = RollBody { moon: true, ..rock };
    let on_a_moon = deposit_choices(&gd, &moon, &[]);
    assert!(usual(&on_a_moon, "d_fx_energy_2"));
    assert!(usual(&on_a_moon, "d_fx_rising"));
}
