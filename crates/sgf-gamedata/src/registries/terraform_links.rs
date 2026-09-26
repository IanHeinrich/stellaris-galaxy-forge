//! `common/terraform` joined with `common/game_rules`: which modifier lets a planet class
//! be terraformed. `common/game_rules`' `is_terraforming_candidate` rule lists the
//! candidate modifiers (an `OR` of `has_modifier` checks); a class's candidate is the
//! first of those a `terraform_link = { from = pc_x … potential = { … from = { has_modifier
//! = … } … } } }` block checks for it, inside a `from = { }` scope of `potential`, however
//! deeply nested under `AND`/`OR`. What a candidate needs besides is what those links'
//! `condition` asks of the country: techs and ascension perks.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use sgf_core::cst::Node;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;
use crate::registries::static_modifiers::StaticModifiers;

const TERRAFORM_DIR: &str = "common/terraform";
const GAME_RULES_DIR: &str = "common/game_rules";
const CANDIDATE_RULE: &str = "is_terraforming_candidate";
const HAS_MODIFIER: &str = "has_modifier";
/// What a link's `condition` asks of the country, techs before perks.
const REQUIREMENTS: [&str; 2] = ["has_technology", "has_ascension_perk"];

/// Keys by the class or modifier they belong to.
type ByKey = BTreeMap<String, Vec<String>>;

#[derive(Debug, Default)]
pub struct TerraformLinks {
    /// Every `has_modifier` a class's terraform links check in `potential`'s `from = { }`
    /// scope, by the class the link terraforms from, in file then document order.
    checked: ByKey,
    /// `common/game_rules`' `is_terraforming_candidate` rule's `has_modifier` values, in
    /// file order; empty without that rule (a total-conversion mod).
    candidates: Vec<String>,
    /// The tech and ascension perk keys most links that check a modifier ask for in their
    /// `condition`, by that modifier: the ordinary way, where a perk or an origin opens a
    /// rarer one with other terms.
    requires: ByKey,
}

impl TerraformLinks {
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let (checked, requires) = load_links(layout, diagnostics);
        Self {
            checked,
            candidates: load_candidates(layout, diagnostics),
            requires,
        }
    }

    /// `class`'s first checked modifier that `common/game_rules`' `is_terraforming_candidate`
    /// rule lists and the static modifiers registry defines; `None` without a terraform
    /// link, without that rule, or when none of its checked modifiers are a listed candidate.
    pub fn candidate(&self, class: &str, static_modifiers: &StaticModifiers) -> Option<String> {
        self.checked
            .get(class)?
            .iter()
            .find(|modifier| self.is_candidate(modifier, static_modifiers))
            .cloned()
    }

    /// Every modifier the `is_terraforming_candidate` rule lists and the static modifiers
    /// registry defines, in the rule's order, with the tech and ascension perk keys most
    /// terraform links that check it ask for: none when no link checks it.
    pub fn candidates<'a>(
        &'a self,
        static_modifiers: &'a StaticModifiers,
    ) -> impl Iterator<Item = (&'a str, &'a [String])> {
        self.candidates
            .iter()
            .filter(|modifier| self.is_candidate(modifier, static_modifiers))
            .map(|modifier| {
                let requires = self.requires.get(modifier).map_or(&[][..], Vec::as_slice);
                (modifier.as_str(), requires)
            })
    }

    fn is_candidate(&self, modifier: &str, static_modifiers: &StaticModifiers) -> bool {
        self.candidates.iter().any(|c| c == modifier) && static_modifiers.get(modifier).is_some()
    }
}

/// Every `has_modifier` each class's terraform links check inside `potential`'s `from = { }`,
/// and for each such modifier the requirements most of the links checking it ask for.
fn load_links(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> (ByKey, ByKey) {
    let mut checked = ByKey::new();
    let mut tallies: BTreeMap<String, Vec<(Vec<String>, usize)>> = BTreeMap::new();
    for file in layout.files_in(TERRAFORM_DIR) {
        let Some((root, src)) = script::parse_file(&file, diagnostics) else {
            continue;
        };
        for node in root.children() {
            if node.key_str(&src) != Some("terraform_link") {
                continue;
            }
            let Some(from_class) = node.find("from", &src).and_then(|n| n.scalar_str(&src)) else {
                continue;
            };
            let Some(potential) = node.find("potential", &src) else {
                continue;
            };
            let mut modifiers = Vec::new();
            collect(potential, &src, HAS_MODIFIER, Scope::InFrom, &mut modifiers);
            if modifiers.is_empty() {
                continue;
            }
            let link_requires = node
                .find("condition", &src)
                .map(|condition| requirements(condition, &src))
                .unwrap_or_default();
            for modifier in &modifiers {
                let tally = tallies.entry(modifier.clone()).or_default();
                match tally.iter_mut().find(|(keys, _)| *keys == link_requires) {
                    Some((_, links)) => *links += 1,
                    None => tally.push((link_requires.clone(), 1)),
                }
            }
            checked
                .entry(from_class.to_owned())
                .or_default()
                .extend(modifiers);
        }
    }
    let requires = tallies
        .into_iter()
        .map(|(modifier, tally)| (modifier, most_common(tally)))
        .collect();
    (checked, requires)
}

/// The requirements the most links share, the first seen of a tie.
fn most_common(tally: Vec<(Vec<String>, usize)>) -> Vec<String> {
    let most = tally.iter().map(|&(_, links)| links).max().unwrap_or(0);
    tally
        .into_iter()
        .find(|&(_, links)| links == most)
        .map(|(keys, _)| keys)
        .unwrap_or_default()
}

/// The tech and ascension perk keys `condition` checks, techs first, each once.
fn requirements(condition: &Node, src: &[u8]) -> Vec<String> {
    let mut keys = Vec::new();
    for key in REQUIREMENTS {
        collect(condition, src, key, Scope::Anywhere, &mut keys);
    }
    let mut seen = BTreeSet::new();
    keys.retain(|key| seen.insert(key.clone()));
    keys
}

/// `common/game_rules`' `is_terraforming_candidate` rule's `has_modifier` values, last file
/// (across layers) wins, as every directory here layers.
fn load_candidates(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Vec<String> {
    let mut rule: Option<(Node, Arc<[u8]>)> = None;
    for file in layout.files_in(GAME_RULES_DIR) {
        let Some((root, src)) = script::parse_file(&file, diagnostics) else {
            continue;
        };
        if let Some(node) = root.find(CANDIDATE_RULE, &src) {
            rule = Some((node.clone(), src));
        }
    }
    let Some((node, src)) = rule else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    collect(&node, &src, HAS_MODIFIER, Scope::Anywhere, &mut candidates);
    candidates
}

/// Where in a block a check counts.
#[derive(Clone, Copy)]
enum Scope {
    /// At any depth.
    Anywhere,
    /// Only inside a `from = { }` scope, at any depth below it.
    InFrom,
}

/// Walks `node` for the values of `key` that count in `scope`. A negated check (`NOT`,
/// `NOR`) never counts.
fn collect(node: &Node, src: &[u8], key: &str, scope: Scope, out: &mut Vec<String>) {
    for child in node.children() {
        let Some(child_key) = child.key_str(src) else {
            continue;
        };
        if child_key == key && matches!(scope, Scope::Anywhere) {
            if let Some(value) = child.scalar_str(src) {
                out.push(value.to_owned());
            }
            continue;
        }
        if child.scalar_span().is_some()
            || child_key.eq_ignore_ascii_case("NOT")
            || child_key.eq_ignore_ascii_case("NOR")
        {
            continue;
        }
        let inner = match child_key.eq_ignore_ascii_case("from") {
            true => Scope::Anywhere,
            false => scope,
        };
        collect(child, src, key, inner, out);
    }
}
