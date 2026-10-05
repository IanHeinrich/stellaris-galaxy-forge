use serde::{Deserialize, Serialize};
use sgf_core::ops::{ClassChange, PlanetClassRule};
use ts_rs::TS;

use super::hex;
use crate::registries::deposits::DepositDef;
use crate::registries::star_classes::StarClass;
use crate::textures::TextureKey;
use crate::{GameData, Localisation};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarClassView {
    pub key: String,
    /// `star_class:<icon>`, the map's texture key.
    pub texture_key: String,
    pub icon_scale: f64,
    /// The planet class of each star body, in the order the install's definition lists
    /// its `planet` entries.
    pub planet_keys: Vec<String>,
    /// The class the game swaps this one for during a crisis, when it has one.
    pub crisis_star_class: Option<String>,
    /// The weight a fresh galaxy draws this class with; `0` marks one the game only sets by
    /// script.
    pub spawn_odds: f64,
    /// Whether the localisation names the class itself.
    pub localised: bool,
}

impl StarClassView {
    pub fn new(sc: &StarClass, loc: &Localisation) -> Self {
        Self {
            key: sc.key.clone(),
            texture_key: TextureKey::StarClass {
                icon: sc.texture_icon().to_owned(),
            }
            .to_string(),
            icon_scale: sc.icon_scale,
            planet_keys: sc.planet_keys().map(str::to_owned).collect(),
            crisis_star_class: sc.crisis_star_class.clone(),
            spawn_odds: sc.spawn_odds,
            localised: loc.raw(&sc.key).is_some(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DepositView {
    pub key: String,
    pub icon: Option<String>,
    pub category: Option<String>,
    pub produces: Vec<(String, f64)>,
    pub is_for_colonizable: bool,
    pub station: Option<String>,
}

impl From<&DepositDef> for DepositView {
    fn from(d: &DepositDef) -> Self {
        Self {
            key: d.key.clone(),
            icon: d.icon.clone(),
            category: d.category.clone(),
            produces: d.produces.clone(),
            is_for_colonizable: d.is_for_colonizable,
            station: d.station.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceIcon {
    pub resource: String,
    /// `GFX_` sprite name, for the `sprite:` texture key.
    pub sprite: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetClassView {
    pub key: String,
    pub icon_sprite: Option<String>,
    /// The 76×76 sprite for a body drawn large.
    pub icon_large_sprite: Option<String>,
    /// `"#rrggbb"`; `None` for a class that draws no atmosphere rim.
    pub atmosphere_color: Option<String>,
    pub atmosphere_intensity: Option<f64>,
    pub atmosphere_width: Option<f64>,
    pub habitable: bool,
    pub star: bool,
    /// The modifier whose presence lets a planet of this class be terraformed, from the
    /// install's terraform links.
    pub terraform_candidate: Option<String>,
    /// `Some(true)` for an asteroid, drawn larger against its belt; `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub asteroid: Option<bool>,
    /// `Some(true)` for a ring world segment (`ringworld = yes`); `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ringworld: Option<bool>,
    /// `Some(true)` for a star class not drawn with the star shader (`star_gfx = no`; vanilla:
    /// `pc_t_star`, `pc_rift_star`, `pc_protostar`); `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub draws_as_planet: Option<bool>,
    /// `Some(true)` for a planet class with no surface map to bake into a disc, drawn from
    /// its icon alone (vanilla: habitats, ring world segments and broken worlds); `None`
    /// otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub flat_art: Option<bool>,
    /// `Some(true)` for a planet class whose model is a planet in pieces, drawn as the disc of
    /// `planet_disc_shattered:<class>:<planet id>` (vanilla: the shattered worlds and the
    /// cracked egg); `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub shattered: Option<bool>,
    /// `Some(true)` for a class a moon may not have (`can_be_moon = no`); `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub moonless: Option<bool>,
    /// `Some(true)` for a class mods only give a planet as its look, never offered as a
    /// class; `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub look_only: Option<bool>,
    /// `Some(true)` for a class whose model draws nothing, never offered as a class and
    /// drawn from its icon; `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hidden_model: Option<bool>,
    /// Which save planets may be changed to or from it.
    pub change: ClassChange,
    /// How many models the install numbers for it, `<model>_01_entity` on; 0 when it names
    /// none.
    pub models: u32,
}

/// A modifier that makes a planet a terraforming candidate, from the install's
/// `is_terraforming_candidate` rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TerraformCandidateView {
    pub modifier: String,
    /// What most terraform links checking the modifier ask for, by name: techs, then
    /// ascension perks, then each `OR` of them as one entry joined with "or", ending in
    /// "another condition" when the `OR` also allows something else.
    pub requires: Vec<String>,
}

/// `true` as `Some(true)`, the shape of a flag this view sends only when it matters.
fn marker(flag: bool) -> Option<bool> {
    flag.then_some(true)
}

impl GameData {
    /// Every planet class, each with the terraform candidate modifier the install's
    /// terraform links give it, if any.
    pub fn planet_class_views(&self) -> Vec<PlanetClassView> {
        self.planet_classes
            .iter()
            .map(|pc| PlanetClassView {
                key: pc.key.clone(),
                icon_sprite: pc.icon.clone(),
                icon_large_sprite: pc.icon_large.clone(),
                atmosphere_color: pc.atmosphere.map(|a| hex(a.colour)),
                atmosphere_intensity: pc.atmosphere.map(|a| a.intensity),
                atmosphere_width: pc.atmosphere.map(|a| a.width),
                habitable: pc.colonizable,
                star: pc.star,
                terraform_candidate: self
                    .terraform_links
                    .candidate(&pc.key, &self.static_modifiers),
                asteroid: marker(pc.asteroid),
                ringworld: marker(pc.ringworld),
                draws_as_planet: marker(pc.star && !pc.star_gfx),
                flat_art: marker(self.flat_art(&pc.key)),
                shattered: marker(self.shattered(&pc.key)),
                moonless: marker(!pc.can_be_moon),
                look_only: marker(pc.look_only),
                hidden_model: marker(pc.hidden_model),
                change: pc.change(),
                models: self.class_models(&pc.key),
            })
            .collect()
    }

    /// What changing a save planet's class needs to know of `class`; `None` when the install
    /// has no such class.
    pub fn planet_class_rule(&self, class: &str) -> Option<PlanetClassRule> {
        let def = self.planet_classes.get(class)?;
        Some(PlanetClassRule {
            class: def.key.clone(),
            change: def.change(),
            models: self.class_models(class),
        })
    }

    /// Every terraforming candidate modifier, in the install's rule order.
    pub fn terraform_candidate_views(&self) -> Vec<TerraformCandidateView> {
        self.terraform_links
            .candidates(&self.static_modifiers)
            .map(|(modifier, requires)| TerraformCandidateView {
                modifier: modifier.to_owned(),
                requires: requires
                    .iter()
                    .map(|requirement| {
                        let mut names: Vec<String> = requirement
                            .any_of
                            .iter()
                            .map(|key| self.loc.name_or_readable(key))
                            .collect();
                        if requirement.or_else {
                            names.push("another condition".to_owned());
                        }
                        names.join(" or ")
                    })
                    .collect(),
            })
            .collect()
    }
}
