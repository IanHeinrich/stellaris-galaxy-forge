use serde::{Deserialize, Serialize};
use sgf_core::ops::SystemRadii;
use ts_rs::TS;

use super::{GalaxySizeView, ModView};
use crate::GameData;
use crate::registries::asteroid_belts::{AsteroidBeltDef, BeltLook};
use crate::registries::defines::GraphicsDefines;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiagnosticView {
    /// `"override"`, `"parse_error"`, `"unreadable"`, `"mod_missing"` or `"rebuild_failed"`.
    pub kind: String,
    pub message: String,
}

/// What the auto-reload watcher is doing, and why it is doing less than all of it.
/// Only the shell knows any of this, so [`From`] leaves it at its default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WatchView {
    /// Roots the watcher holds, `0` when it is not running.
    pub watching: u32,
    /// Whether the auto-reload breaker has paused it.
    pub paused: bool,
    /// Why it watches none of the roots, or fewer than the loaded game data has,
    /// or why a reread was dropped; `None` when it is doing its whole job.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GameDataSummary {
    pub install: String,
    pub version: Option<String>,
    pub language: String,
    pub language_fell_back: bool,
    pub mods: Vec<ModView>,
    pub initializers: u32,
    pub country_types: u32,
    pub star_classes: u32,
    pub sprites: u32,
    pub colors: u32,
    pub deposits: u32,
    pub planet_classes: u32,
    pub starbase_levels: u32,
    pub border: GraphicsDefines,
    /// How far out a system's inner and outer radii lie, from `NGameplay`.
    pub system_radii: SystemRadii,
    pub belt_kinds: Vec<BeltKindView>,
    pub localisation_keys: u32,
    pub diagnostics: Vec<DiagnosticView>,
    /// The galaxy size with the most stars across the install and the enabled mods;
    /// `None` when no `setup_scenario` gives a `num_stars`.
    pub largest_galaxy: Option<GalaxySizeView>,
    /// Bumped by every load, every unload and every accepted rebuild. Counted
    /// by the shell, so [`From`] leaves it at `0`.
    #[ts(type = "number")]
    pub generation: u64,
    pub watch: WatchView,
}

/// An asteroid belt kind the install defines, with its localised name and how it looks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BeltKindView {
    pub key: String,
    pub name: String,
    pub look: BeltLook,
    pub emissive: bool,
    /// The band's width and how many pieces it has, against a plain belt's.
    pub width: f64,
    pub density: f64,
}

impl BeltKindView {
    fn new(belt: &AsteroidBeltDef, gd: &GameData) -> Self {
        Self {
            key: belt.key.clone(),
            name: gd.loc.name_or_readable(&belt.key),
            look: belt.look,
            emissive: belt.emissive,
            width: belt.width,
            density: belt.density,
        }
    }
}

/// A registry was reread, or the watcher paused or resumed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GameDataChanged {
    /// [`crate::RegistryKind::as_str`] of each registry rebuilt; empty for a
    /// pause or resume notice.
    pub registries: Vec<String>,
    #[ts(type = "number")]
    pub version: u64,
    pub watch: WatchView,
    /// The file that tripped the breaker, and how often it changed inside the
    /// breaker's window; `0` when nothing tripped it.
    pub hot_file: Option<String>,
    pub hot_count: u32,
}

impl From<&GameData> for GameDataSummary {
    fn from(gd: &GameData) -> Self {
        Self {
            install: gd.layout.install.display().to_string(),
            version: gd.version.clone(),
            language: gd.loc.language.clone(),
            language_fell_back: gd.loc.fell_back,
            mods: gd.mods.iter().map(ModView::from).collect(),
            initializers: count(gd.initializers.len()),
            country_types: count(gd.country_types.len()),
            star_classes: count(gd.star_classes.len()),
            sprites: count(gd.sprites.len()),
            colors: count(gd.colors.entries.len()),
            deposits: count(gd.deposits.len()),
            planet_classes: count(gd.planet_classes.len()),
            starbase_levels: count(gd.starbase_levels.len()),
            border: *gd.border,
            system_radii: gd.system_radii,
            belt_kinds: gd
                .asteroid_belts
                .iter()
                .map(|belt| BeltKindView::new(belt, gd))
                .collect(),
            localisation_keys: count(gd.loc.len()),
            largest_galaxy: gd
                .galaxy_sizes
                .largest()
                .map(|size| GalaxySizeView::new(size, gd)),
            generation: 0,
            watch: WatchView::default(),
            diagnostics: gd
                .diagnostics
                .iter()
                .map(|d| DiagnosticView {
                    kind: d.kind().to_owned(),
                    message: d.to_string(),
                })
                .collect(),
        }
    }
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
