//! `common/terraform` joined with `common/game_rules`: which modifier lets a planet class
//! be terraformed. `common/game_rules`' `is_terraforming_candidate` rule lists the
//! candidate modifiers (an `OR` of `has_modifier` checks); a class's candidate is the
//! first of those a `terraform_link = { from = pc_x … potential = { … from = { has_modifier
//! = … } … } } }` block checks for it, inside a `from = { }` scope of `potential`, however
//! deeply nested under `AND`/`OR`.

use std::collections::BTreeMap;
use std::sync::Arc;

use sgf_core::cst::Node;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;
use crate::registries::static_modifiers::StaticModifiers;

const TERRAFORM_DIR: &str = "common/terraform";
const GAME_RULES_DIR: &str = "common/game_rules";
const CANDIDATE_RULE: &str = "is_terraforming_candidate";

#[derive(Debug, Default)]
pub struct TerraformLinks {
    /// Every `has_modifier` a class's terraform links check in `potential`'s `from = { }`
    /// scope, by the class the link terraforms from, in file then document order.
    checked: BTreeMap<String, Vec<String>>,
    /// `common/game_rules`' `is_terraforming_candidate` rule's `has_modifier` values, in
    /// file order; empty without that rule (a total-conversion mod).
    candidates: Vec<String>,
}

impl TerraformLinks {
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        Self {
            checked: load_checked(layout, diagnostics),
            candidates: load_candidates(layout, diagnostics),
        }
    }

    /// `class`'s first checked modifier that `common/game_rules`' `is_terraforming_candidate`
    /// rule lists and the static modifiers registry defines; `None` without a terraform
    /// link, without that rule, or when none of its checked modifiers are a listed candidate.
    pub fn candidate(&self, class: &str, static_modifiers: &StaticModifiers) -> Option<String> {
        self.checked
            .get(class)?
            .iter()
            .find(|modifier| {
                self.candidates.contains(modifier) && static_modifiers.get(modifier).is_some()
            })
            .cloned()
    }
}

/// Every `has_modifier` each class's terraform links check inside `potential`'s `from = { }`.
fn load_checked(
    layout: &Layout,
    diagnostics: &mut Vec<Diagnostic>,
) -> BTreeMap<String, Vec<String>> {
    let mut checked: BTreeMap<String, Vec<String>> = BTreeMap::new();
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
            collect_modifiers(potential, &src, false, true, "has_modifier", &mut modifiers);
            if !modifiers.is_empty() {
                checked
                    .entry(from_class.to_owned())
                    .or_default()
                    .extend(modifiers);
            }
        }
    }
    checked
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
    collect_modifiers(&node, &src, false, false, "has_modifier", &mut candidates);
    candidates
}

/// Walks `node` for `target_key` values. When `require_from`, a value counts only while
/// `in_from`, which turns (and stays) true on entering a `from` scope; otherwise every
/// occurrence, however nested, counts. A negated check (`NOT`, `NOR`) never counts.
fn collect_modifiers(
    node: &Node,
    src: &[u8],
    in_from: bool,
    require_from: bool,
    target_key: &str,
    out: &mut Vec<String>,
) {
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        if key == target_key && (!require_from || in_from) {
            if let Some(value) = child.scalar_str(src) {
                out.push(value.to_owned());
            }
            continue;
        }
        if child.scalar_span().is_some()
            || key.eq_ignore_ascii_case("NOT")
            || key.eq_ignore_ascii_case("NOR")
        {
            continue;
        }
        collect_modifiers(
            child,
            src,
            in_from || key.eq_ignore_ascii_case("from"),
            require_from,
            target_key,
            out,
        );
    }
}
