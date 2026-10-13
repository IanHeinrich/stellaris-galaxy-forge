//! The megastructure types as the add dialog reads them: each registry type with its empire
//! effects and the modifiers and deposits its construction writes, named from the install's
//! localisation, and the picture and category line of the game's construction card.

use serde::{Deserialize, Serialize};
use sgf_core::ops::{NewRingWorld, RingQuadrant};
use ts_rs::TS;

use crate::GameData;
use crate::construction::habitat::habitat;
use crate::construction::ring_world::{RingStage, quadrants, ring_world};
use crate::construction::{SummaryKind, SummaryLine, SummaryOn};
use crate::planet_views::ModifierLineView;
use crate::registries::megastructures::{MegastructureDef, Placement, Unsupported};
use crate::textures::TextureKey;

/// How many whole-entry references a build tooltip is followed through, as Gigastructural
/// Engineering points a star class's stage at the plain stage's tooltip.
const MAX_ALIASES: usize = 8;

/// One modifier or deposit that adding a row of the type writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConstructionLineView {
    pub on: SummaryOn,
    pub kind: SummaryKind,
    pub key: String,
    /// The localised name of the modifier or deposit.
    pub name: String,
    /// A deposit, or a modifier with no end date.
    pub permanent: bool,
    /// It lands only on the bodies that pass a condition, or only when the structure has an
    /// owner.
    pub conditional: bool,
}

/// A megastructure type with the lines the registry leaves empty because they need the
/// localisation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MegastructureView {
    #[serde(flatten)]
    #[ts(flatten)]
    pub def: MegastructureDef,
    /// What the type gives its owner, named as the game's tooltip names it.
    #[serde(default)]
    pub country_effects: Vec<ModifierLineView>,
    /// What building the type adds to its system and bodies.
    #[serde(default)]
    pub construction_summary: Vec<ConstructionLineView>,
    /// Its finished stage is a habitat beside the body it is built at, which the editor adds
    /// as a planet in place of a row.
    #[serde(default)]
    pub habitat: bool,
    /// The habitat also comes with a major orbital at its host, which the editor adds where
    /// the host holds no megastructure.
    #[serde(default)]
    pub habitat_orbital: bool,
    /// For a ring world past its site, why the editor cannot add its chain's ring whole with
    /// every quadrant finished; `None` when it can, and for any other type.
    #[serde(default)]
    pub ring_world_refused: Option<String>,
    /// For a ring world past its site, how far from the star its chain's ring stands: the
    /// radius of its first section with every quadrant finished. `None` for any other type,
    /// and when the editor cannot add that ring.
    #[serde(default)]
    pub ring_world_radius: Option<f64>,
    /// For a ring world past its site, each stage no quadrant of its chain's ring can be
    /// added at, in the order [`RingStage`] lists them; empty for any other type.
    #[serde(default)]
    pub ring_world_refused_stages: Vec<RingStage>,
    /// The texture key of the picture the game's construction card shows for the type; `None`
    /// when it names none or the install has no file for it.
    #[serde(default)]
    pub portrait: Option<String>,
    /// The kind and categories its build tooltip opens with, such as "Kilostructure · Science
    /// Production"; `None` when the tooltip's first line is anything else.
    #[serde(default)]
    pub category: Option<String>,
}

/// Every stage a quadrant of a ring world can be asked for, in the order [`RingStage`] lists them.
const RING_STAGES: [RingStage; 5] = [
    RingStage::Finished,
    RingStage::Frame,
    RingStage::Ruined,
    RingStage::Damaged,
    RingStage::Restored,
];

/// What the add dialog reads of a ring world past its site.
#[derive(Default)]
struct RingFacts {
    refused: Option<String>,
    radius: Option<f64>,
    refused_stages: Vec<RingStage>,
}

/// The radius `ring`'s first section stands at.
fn radius(ring: &NewRingWorld) -> Option<f64> {
    match ring.quadrants.first()? {
        RingQuadrant::Finished { segments }
        | RingQuadrant::Restored { segments }
        | RingQuadrant::Damaged { segments } => segments.first().map(|s| s.planet.at.radius),
        RingQuadrant::Frame { row } | RingQuadrant::Ruined { row } => Some(row.at.radius),
    }
}

impl GameData {
    /// Every megastructure type in key order, with its effects and construction named.
    pub fn megastructure_views(&self) -> Vec<MegastructureView> {
        self.megastructures
            .iter()
            .map(|def| {
                let finished = habitat(self, &def.key, true, None);
                let ring = self.ring_facts(def);
                MegastructureView {
                    country_effects: modifier_lines(self, &def.country_modifier),
                    construction_summary: def
                        .construction
                        .summary()
                        .into_iter()
                        .map(|line| self.construction_line(line))
                        .collect(),
                    habitat: finished.is_some(),
                    habitat_orbital: finished.is_some_and(|habitat| habitat.orbital.is_some()),
                    ring_world_refused: ring.refused,
                    ring_world_radius: ring.radius,
                    ring_world_refused_stages: ring.refused_stages,
                    portrait: def
                        .portrait
                        .as_deref()
                        .and_then(|sprite| self.portrait(sprite)),
                    category: self.category(&def.key),
                    def: def.clone(),
                }
            })
            .collect()
    }

    fn ring_facts(&self, def: &MegastructureDef) -> RingFacts {
        let Placement::Unsupported {
            why: Unsupported::RingWorld,
        } = def.placement
        else {
            return RingFacts::default();
        };
        let count = quadrants(self, &def.key).unwrap_or(4);
        let all_at = |stage| ring_world(self, &def.key, &vec![stage; count], None, &[]);
        let finished = all_at(RingStage::Finished);
        let refused_stages = RING_STAGES
            .into_iter()
            .filter(|&stage| match stage {
                RingStage::Finished => finished.is_err(),
                _ => all_at(stage).is_err(),
            })
            .collect();
        RingFacts {
            radius: finished.as_ref().ok().and_then(radius),
            refused: finished.err(),
            refused_stages,
        }
    }

    fn construction_line(&self, line: SummaryLine) -> ConstructionLineView {
        ConstructionLineView {
            name: self.loc.name_or_readable(&line.key),
            on: line.on,
            kind: line.kind,
            key: line.key,
            permanent: line.permanent,
            conditional: line.conditional,
        }
    }

    /// `sprite` as a texture key, when the install has the file it names.
    fn portrait(&self, sprite: &str) -> Option<String> {
        let (file, _) = self.sprites.resolve(sprite, None)?;
        self.layout.resolve_file(&file)?;
        TextureKey::sprite(sprite, None).map(|key| key.to_string())
    }

    /// The first line of `key`'s build tooltip, `<key>_MEGASTRUCTURE_DETAILS`, when after any
    /// icons it is only references to upper-case words joined by ` - `, as Gigastructural
    /// Engineering opens its tooltips: each word in title case, joined by ` · `.
    fn category(&self, key: &str) -> Option<String> {
        let mut text = self.loc.raw(&format!("{key}_MEGASTRUCTURE_DETAILS"))?;
        for _ in 0..MAX_ALIASES {
            match reference(text.trim()) {
                Some(alias) => text = self.loc.raw(alias)?,
                None => break,
            }
        }
        let parts = after_icons(text.lines().next()?)
            .split(" - ")
            .map(|part| {
                let words = self.loc.name(reference(part.trim())?)?;
                (!words.chars().any(char::is_lowercase)).then(|| title_case(&words))
            })
            .collect::<Option<Vec<_>>>()?;
        Some(parts.join(" · "))
    }
}

/// The key of `text` when it is one `$key$` reference and nothing else.
fn reference(text: &str) -> Option<&str> {
    let key = text.strip_prefix('$')?.strip_suffix('$')?;
    let plain = !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    plain.then_some(key)
}

/// `line` without the `£icon£` codes it opens with.
fn after_icons(line: &str) -> &str {
    let mut rest = line.trim_start();
    while let Some(icon) = rest.strip_prefix('£') {
        let Some(end) = icon.find('£') else {
            break;
        };
        rest = icon[end + '£'.len_utf8()..].trim_start();
    }
    rest
}

/// `SCIENCE PRODUCTION` as `Science Production`.
fn title_case(words: &str) -> String {
    words
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| {
                    first
                        .to_uppercase()
                        .chain(chars.flat_map(char::to_lowercase))
                })
                .into_iter()
                .flatten()
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn modifier_lines(gd: &GameData, lines: &[(String, f64)]) -> Vec<ModifierLineView> {
    lines
        .iter()
        .map(|(key, value)| ModifierLineView {
            key: key.clone(),
            value: *value,
            text: gd.loc.modifier_line(key, *value),
        })
        .collect()
}
