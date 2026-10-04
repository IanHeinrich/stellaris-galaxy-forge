//! The terraforming candidate an install's game rules name for each planet class, and what
//! its terraform links ask for before a candidate world can be terraformed.

use crate::common;

use sgf_gamedata::views::TerraformCandidateView;

/// An install whose terraform links exercise the parser: `NOT`/`NOR` and checks outside
/// `from` are skipped, a later `game_rules` file's rule wins, a candidate the static
/// modifiers do not define is dropped, a candidate needs what most of its links ask for, and
/// an `OR` in a condition is one requirement, its alternatives in any order.
const TERRAFORM_FILES: [(&str, &str); 6] = [
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_rock = {}\npc_fx_ice = {}\npc_fx_old = {}\npc_fx_plain = {}\n",
    ),
    (
        "common/static_modifiers/00_fx.txt",
        "fx_candidate = { icon = x }\nfx_cold_candidate = { icon = x }\nfx_old_candidate = { icon = x }\n",
    ),
    (
        "common/game_rules/00_fx.txt",
        "is_terraforming_candidate = {\n\tOR = { has_modifier = fx_old_candidate }\n}\n",
    ),
    (
        "common/game_rules/01_fx.txt",
        "is_terraforming_candidate = {\n\tOR = {\n\t\thas_modifier = fx_candidate\n\t\thas_modifier = fx_undefined_candidate\n\t\thas_modifier = fx_cold_candidate\n\t}\n}\n",
    ),
    (
        "common/terraform/00_fx.txt",
        "terraform_link = {\n\tfrom = pc_fx_rock\n\tpotential = {\n\t\thas_modifier = fx_cold_candidate\n\t\tfrom = {\n\t\t\tNOT = { has_modifier = fx_cold_candidate }\n\t\t\tNOR = { has_modifier = fx_cold_candidate }\n\t\t\tAND = { has_modifier = fx_candidate }\n\t\t}\n\t}\n\tcondition = {\n\t\thas_ascension_perk = ap_fx_shaper\n\t\thas_technology = tech_fx_restore\n\t\tNOT = { has_technology = tech_fx_never }\n\t}\n}\n\
         terraform_link = {\n\tfrom = pc_fx_ice\n\tpotential = { from = { has_modifier = fx_undefined_candidate } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_ice\n\tpotential = { OR = { from = { has_modifier = fx_cold_candidate } } }\n\tcondition = { has_technology = tech_fx_restore has_ascension_perk = ap_fx_cold OR = { has_technology = tech_fx_alt has_ascension_perk = ap_fx_alt has_country_flag = fx_flag } NOT = { OR = { has_technology = tech_fx_never } } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_plain\n\tpotential = { from = { has_modifier = fx_cold_candidate } }\n\tcondition = { has_ascension_perk = ap_fx_cold has_technology = tech_fx_restore AND = { OR = { has_country_flag = fx_flag has_ascension_perk = ap_fx_alt has_technology = tech_fx_alt } } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_plain\n\tpotential = { has_ascension_perk = ap_fx_other from = { has_modifier = fx_cold_candidate } }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_old\n\tpotential = { from = { has_modifier = fx_old_candidate } }\n}\n",
    ),
    (
        "localisation/english/fx_l_english.yml",
        "l_english:\n tech_fx_restore:0 \"Fx Restoration\"\n ap_fx_cold:0 \"Cold Hands\"\n",
    ),
];

#[test]
fn terraform_links_read_the_candidate_rule_and_the_links_that_check_it() {
    let (_dir, gd) = common::hand_written(&TERRAFORM_FILES);
    let candidate = |class: &str| gd.terraform_links.candidate(class, &gd.static_modifiers);
    assert_eq!(candidate("pc_fx_rock"), Some("fx_candidate".to_owned()));
    assert_eq!(candidate("pc_fx_ice"), Some("fx_cold_candidate".to_owned()));
    assert_eq!(
        candidate("pc_fx_old"),
        None,
        "an earlier rule file's candidate"
    );

    let views: Vec<(String, Option<String>)> = gd
        .planet_class_views()
        .into_iter()
        .map(|v| (v.key, v.terraform_candidate))
        .collect();
    assert!(
        views.contains(&("pc_fx_rock".to_owned(), Some("fx_candidate".to_owned()))),
        "{views:?}"
    );

    let requires = |modifier: &str, names: &[&str]| TerraformCandidateView {
        modifier: modifier.to_owned(),
        requires: names.iter().map(|&n| n.to_owned()).collect(),
    };
    assert_eq!(
        gd.terraform_candidate_views(),
        [
            requires("fx_candidate", &["Fx Restoration", "Ap Fx Shaper"]),
            requires(
                "fx_cold_candidate",
                &[
                    "Fx Restoration",
                    "Cold Hands",
                    "Tech Fx Alt or Ap Fx Alt or another condition"
                ],
            ),
        ]
    );
}

/// Two links that check one candidate and ask for different techs, the second checking it
/// twice.
const TIED_FILES: [(&str, &str); 5] = [
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_a = {}\npc_fx_b = {}\n",
    ),
    (
        "common/static_modifiers/00_fx.txt",
        "fx_candidate = { icon = x }\n",
    ),
    (
        "common/game_rules/00_fx.txt",
        "is_terraforming_candidate = { OR = { has_modifier = fx_candidate } }\n",
    ),
    (
        "common/terraform/00_fx.txt",
        "terraform_link = {\n\tfrom = pc_fx_a\n\tpotential = { from = { has_modifier = fx_candidate } }\n\tcondition = { has_technology = tech_fx_first }\n}\n\
         terraform_link = {\n\tfrom = pc_fx_b\n\tpotential = {\n\t\tfrom = { has_modifier = fx_candidate }\n\t\tOR = { from = { has_modifier = fx_candidate } }\n\t}\n\tcondition = { has_technology = tech_fx_second }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

#[test]
fn a_tie_between_requirement_sets_goes_to_the_first_seen_and_a_link_votes_once() {
    let (_dir, gd) = common::hand_written(&TIED_FILES);
    assert_eq!(
        gd.terraform_candidate_views(),
        [TerraformCandidateView {
            modifier: "fx_candidate".to_owned(),
            requires: vec!["Tech Fx First".to_owned()],
        }]
    );
}
