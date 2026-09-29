//! `common/archaeological_site_types`: the dig sites a planet can hold, their stages, and
//! whether the survey roll can pick one.

use sgf_core::cst::Node;

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type DigSiteTypes = Registry<DigSiteTypeDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigSiteTypeDef {
    pub key: String,
    /// Each `stage`'s `difficulty`, in order, one slot per stage; a `{ min max }` range as its
    /// midpoint, rounded, and `None` for one that cannot be read.
    pub difficulties: Vec<Option<i32>>,
    /// It has an `on_create` effect, which only the game's own creation of a site runs.
    pub on_create: bool,
    /// Its `weight` can come out above zero: a number, or a block's `base` or any of its
    /// modifiers' `add`. The survey roll (`ancrel.9999`) creates a site with
    /// `create_archaeological_site = random`, which draws only such a type.
    pub rolled: bool,
}

impl FromDef for DigSiteTypeDef {
    const DIR: &'static str = "common/archaeological_site_types";

    fn read(key: String, def: &Def) -> Self {
        let src = &def.src;
        Self {
            difficulties: def
                .node
                .find_all("stage", src)
                .map(|stage| {
                    def.range_in(stage, "difficulty")
                        .map(|range| range.midpoint().round() as i32)
                })
                .collect(),
            on_create: def.node.find("on_create", src).is_some(),
            rolled: def
                .node
                .find("weight", src)
                .is_some_and(|weight| can_weigh(def, weight)),
            key,
        }
    }
}

fn can_weigh(def: &Def, weight: &Node) -> bool {
    let src = &def.src;
    let positive = |node: &Node, key: &str| def.range_in(node, key).is_some_and(|r| r.max > 0.0);
    if let Some(text) = weight.scalar_str(src) {
        return def.number_of(text).is_some_and(|n| n > 0.0);
    }
    positive(weight, "base")
        || weight
            .find_all("modifier", src)
            .any(|modifier| positive(modifier, "add"))
}
