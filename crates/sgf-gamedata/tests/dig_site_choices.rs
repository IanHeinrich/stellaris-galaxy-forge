//! The dig site types a planet's page knows: on a hand-written install, what each reads of its
//! stages, weight and description and which the picker leaves out, and on the real one, how many
//! it offers and what one says.

use crate::common;
use common::by_key;

use sgf_gamedata::dig_site_choices::DigSiteChoice;

const FILES: [(&str, &str); 3] = [
    (
        "common/scripted_variables/00_fx.txt",
        "@fx_site_weight = 20\n",
    ),
    (
        "common/archaeological_site_types/00_fx.txt",
        "random = {\n\tvisible = { OR = { } }\n}\n\
         site_fx_rolled = {\n\tdesc = \"site_fx_rolled_intro\"\n\tstages = 2\n\tweight = {\n\t\tbase = 0\n\t\tmodifier = { add = 50 is_planet_class = pc_tropical }\n\t}\n\
         \tstage = { difficulty = 3 icon = x }\n\tstage = { difficulty = 5 icon = y }\n}\n\
         site_fx_event = {\n\tdesc = { trigger = { is_colony = yes } text = site_fx_event_colony }\n\
         \tdesc = { trigger = { is_colony = no } text = site_fx_event_wild }\n\tstages = 1\n\tweight = 0\n\tstage = { difficulty = { min = 1 max = 3 } }\n}\n\
         site_fx_unweighted = {\n\tstages = 1\n\tweight = { base = 0 }\n\tstage = { difficulty = 2 }\n}\n\
         site_fx_variable = {\n\tstages = 1\n\tweight = @fx_site_weight\n\tstage = { difficulty = 4 }\n}\n\
         site_fx_created = {\n\tstages = 1\n\tweight = 10\n\ton_create = { remove_deposit = yes }\n\tstage = { difficulty = 1 }\n}\n\
         site_fx_unreadable = {\n\tstages = 2\n\tstage = { difficulty = @fx_missing }\n\tstage = { difficulty = 4 }\n}\n",
    ),
    (
        "localisation/english/fx_l_english.yml",
        "l_english:\n site_fx_rolled:0 \"Rolled Ruins\"\n\
         site_fx_rolled_intro:0 \"£minerals£ Ruins of §Ygreat§! age.\"\n\
         site_fx_event_colony:0 \"Found by colonists.\"\n\
         site_fx_event_wild:0 \"Found in the wild.\"\n\
         site_fx_variable_desc:0 \"Named for its key.\"\n",
    ),
];

#[test]
fn each_type_starts_at_its_first_stage_and_says_whether_a_survey_finds_it() {
    let (_dir, gd) = common::hand_written(&FILES);
    let choices = gd.dig_site_choices();
    let keys: Vec<&str> = choices.iter().map(|c| c.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "site_fx_created",
            "site_fx_event",
            "site_fx_rolled",
            "site_fx_unreadable",
            "site_fx_unweighted",
            "site_fx_variable"
        ],
        "random has no stage"
    );
    assert_eq!(
        by_key(&choices, "site_fx_rolled"),
        &DigSiteChoice {
            key: "site_fx_rolled".to_owned(),
            name: "Rolled Ruins".to_owned(),
            description: Some("Ruins of great age.".to_owned()),
            difficulty: 3,
            stages: 2,
            rolled: true,
            offered: true,
        }
    );
    let event = by_key(&choices, "site_fx_event");
    assert_eq!(
        (event.difficulty, event.rolled),
        (2, false),
        "a range's midpoint"
    );
    assert_eq!(event.name, "Site Fx Event", "no localisation");
    assert_eq!(
        event.description.as_deref(),
        Some("Found by colonists."),
        "the first triggered desc"
    );
    assert_eq!(
        by_key(&choices, "site_fx_variable").description.as_deref(),
        Some("Named for its key."),
        "no desc, so <key>_desc"
    );
    assert_eq!(by_key(&choices, "site_fx_created").description, None);
    assert!(!by_key(&choices, "site_fx_unweighted").rolled);
    assert!(by_key(&choices, "site_fx_variable").rolled);

    let created = by_key(&choices, "site_fx_created");
    assert_eq!((created.stages, created.offered), (1, false), "on_create");
    let unreadable = by_key(&choices, "site_fx_unreadable");
    assert_eq!(
        (unreadable.stages, unreadable.difficulty, unreadable.offered),
        (2, 0, false),
        "the unreadable first stage keeps its slot"
    );
    let def = gd
        .dig_site_types
        .get("site_fx_unreadable")
        .expect("defined");
    assert_eq!(def.difficulties, [None, Some(4)]);
}

#[test]
fn the_install_offers_every_site_type_but_the_two_with_on_create() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let choices = gd.dig_site_choices();
    let unlisted: Vec<&str> = gd
        .dig_site_types
        .iter()
        .filter(|def| !choices.iter().any(|c| c.key == def.key))
        .map(|def| def.key.as_str())
        .collect();
    assert_eq!(unlisted, ["random"]);
    let left_out: Vec<&str> = choices
        .iter()
        .filter(|c| !c.offered)
        .map(|c| c.key.as_str())
        .collect();
    assert_eq!(
        left_out,
        ["site_percussive_maintenance", "site_the_library"]
    );
    assert_eq!(
        by_key(&choices, "site_bury_the_hatchet").difficulty,
        -1,
        "a first stage below 1 is the game's own"
    );
    assert!(by_key(&choices, "site_the_library").stages > 0);
    let lost = by_key(&choices, "site_lost_moments");
    assert_eq!(
        (lost.name.as_str(), lost.difficulty, lost.rolled),
        ("Never Forget", 1, true)
    );
    let repowered = by_key(&choices, "site_repowered_complex");
    assert_eq!((repowered.difficulty, repowered.rolled), (2, false));
    assert_eq!(by_key(&choices, "site_krazura_dig").difficulty, 3);
    let shanty = by_key(&choices, "site_space_shanty_dig");
    assert!(
        shanty.description.as_deref().is_some_and(
            |text| text.starts_with("We have found the wreckage of an archaic spaceship")
        ),
        "the first of its triggered descs: {:?}",
        shanty.description
    );
    let shallash = by_key(&choices, "site_ruins_of_shallash");
    assert!(
        shallash
            .description
            .as_deref()
            .is_some_and(|text| text.starts_with("This planet was clearly once home")),
        "the planet it names: {:?}",
        shallash.description
    );
    let undescribed: Vec<&str> = choices
        .iter()
        .filter(|c| c.description.is_none())
        .map(|c| c.key.as_str())
        .collect();
    assert_eq!(undescribed, Vec::<&str>::new());
    let rolled = gd.dig_site_types.iter().filter(|def| def.rolled).count();
    assert_eq!(
        rolled, 49,
        "the survey roll's types, the two left out among them"
    );
    let offered: Vec<&DigSiteChoice> = choices.iter().filter(|c| c.offered).collect();
    assert_eq!(offered.len(), 121);
    assert_eq!(offered.iter().filter(|c| c.rolled).count(), 47);
}
