//! `common/archaeological_site_types`: the dig sites a planet can hold, their stages, whether
//! the survey roll can pick one, and the text the game's site window describes one with.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};
use crate::weight::Weight;

pub type DigSiteTypes = Registry<DigSiteTypeDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigSiteTypeDef {
    pub key: String,
    /// Each `stage`'s `difficulty`, in order, one slot per stage; a `{ min max }` range as its
    /// midpoint, rounded, and `None` for one that cannot be read.
    pub difficulties: Vec<Option<i32>>,
    /// It has an `on_create` effect, which only the game's own creation of a site runs.
    pub on_create: bool,
    /// Its `weight` can come out above zero for some planet. The survey roll (`ancrel.9999`)
    /// creates a site with `create_archaeological_site = random`, which draws only such a type.
    pub rolled: bool,
    /// The localisation key its `desc` names: the key itself, or the first `desc = { trigger
    /// text }` block's `text`, as the triggers read a site the editor does not have.
    pub desc: Option<String>,
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
                .is_some_and(|weight| Weight::read(weight, def, 0.0).ever_positive()),
            desc: def.node.find("desc", src).and_then(|desc| {
                desc.scalar_str(src)
                    .or_else(|| desc.find("text", src)?.scalar_str(src))
                    .map(str::to_owned)
            }),
            key,
        }
    }
}
