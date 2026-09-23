//! IPC view types for game data; `cargo test -p sgf-gamedata` writes their
//! TypeScript declarations to `app/src/generated/`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::initializers::{InitPlanet, Initializer, SpawnedCountry};
use crate::install::mods::{
    self, LOCAL_CLUSTER_WORKSHOP_ID, ModInfo, PAINT_MOD_WORKSHOP_ID, PaintModStatus,
    RESERVED_SPAWNS_WORKSHOP_ID,
};
use crate::install::scenarios::scenarios_dir;
use crate::registries::bypasses::BypassDef;
use crate::registries::colors::ColorDef;
use crate::registries::country_types::CountryType;
use crate::registries::defines::BorderDefines as BorderDefinesData;
use crate::registries::deposits::DepositDef;
use crate::registries::galaxy_shapes::GalaxyShape;
use crate::registries::galaxy_sizes::GalaxySize;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::ship_sizes::ShipSizeDef;
use crate::registries::star_classes::StarClass;
use crate::registries::starbase_levels::StarbaseLevelDef;
use crate::scripts::identity;
use crate::textures::TextureKey;
use crate::{Diagnostic, GameData};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModView {
    pub id: String,
    pub name: String,
    pub dir: Option<String>,
    /// `"loaded"` or `"missing"`.
    pub status: String,
}

impl From<&ModInfo> for ModView {
    fn from(m: &ModInfo) -> Self {
        Self {
            id: m.id.clone(),
            name: m.name.clone(),
            dir: m.dir.as_ref().map(|d| d.display().to_string()),
            status: m.status.as_str().to_owned(),
        }
    }
}

/// Where Paint a Galaxy keeps its scenarios on this machine, whether or not the
/// directory exists, whether the playset loads the mod, and whether it loads the
/// Reserved Spawns submod beside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaintModView {
    /// `None` when the launcher lists the mod but its files are gone.
    pub scenarios_dir: Option<String>,
    pub enabled: bool,
    /// The playset loads the Reserved Spawns submod, whose traits a reserved seat needs.
    pub reserved_spawns: bool,
    /// What reading the launcher's files ran into.
    #[serde(default)]
    #[ts(optional)]
    pub diagnostics: Option<Vec<String>>,
}

impl PaintModView {
    pub fn new(status: &PaintModStatus, diagnostics: &[Diagnostic]) -> Self {
        let m = &status.paint;
        Self {
            scenarios_dir: m
                .dir
                .as_deref()
                .map(|dir| scenarios_dir(dir).display().to_string()),
            enabled: m.enabled,
            reserved_spawns: status.reserved_spawns,
            diagnostics: Some(diagnostics.iter().map(ToString::to_string).collect()),
        }
    }
}

/// The Steam Workshop pages the app links to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkshopLinks {
    pub paint_a_galaxy: String,
    /// Reserved Spawns, whose "Reserved Spawn A"-"Z" traits a reserved seat's empire needs.
    pub reserved_spawns: String,
    /// Local Cluster, the usual workaround for Sol having no Sol-specific neighbours.
    pub local_cluster: String,
}

impl Default for WorkshopLinks {
    fn default() -> Self {
        Self {
            paint_a_galaxy: mods::workshop_url(PAINT_MOD_WORKSHOP_ID),
            reserved_spawns: mods::workshop_url(RESERVED_SPAWNS_WORKSHOP_ID),
            local_cluster: mods::workshop_url(LOCAL_CLUSTER_WORKSHOP_ID),
        }
    }
}

impl WorkshopLinks {
    pub fn contains(&self, url: &str) -> bool {
        [
            &self.paint_a_galaxy,
            &self.reserved_spawns,
            &self.local_cluster,
        ]
        .into_iter()
        .any(|link| link == url)
    }
}

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
    pub border: BorderDefines,
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
            colors: count(gd.colors.len()),
            deposits: count(gd.deposits.len()),
            planet_classes: count(gd.planet_classes.len()),
            starbase_levels: count(gd.starbase_levels.len()),
            border: BorderDefines::from(&*gd.border),
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

/// One galaxy size the new game screen offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GalaxySizeView {
    /// The `name` its `setup_scenario` gives (`huge`).
    pub name: String,
    /// What the new game screen calls it: the name's localisation, or the name capitalised.
    pub label: String,
    pub num_stars: u32,
}

impl GalaxySizeView {
    fn new(size: &GalaxySize, gd: &GameData) -> Self {
        let label = gd
            .loc
            .get(&size.name)
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| capitalised(&size.name));
        Self {
            name: size.name.clone(),
            label,
            num_stars: size.num_stars,
        }
    }
}

fn capitalised(name: &str) -> String {
    let mut chars = name.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarClassView {
    pub key: String,
    /// `star_class:<icon>`, the map's texture key.
    pub texture_key: String,
    pub icon_scale: f64,
}

impl From<&StarClass> for StarClassView {
    fn from(sc: &StarClass) -> Self {
        Self {
            key: sc.key.clone(),
            texture_key: TextureKey::StarClass {
                icon: sc.texture_icon().to_owned(),
            }
            .to_string(),
            icon_scale: sc.icon_scale,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitPlanetView {
    pub name: Option<String>,
    pub class: String,
    /// `(min, max)`, equal for a fixed size.
    pub size: Option<(u32, u32)>,
    pub orbit_distance: Option<f64>,
    pub has_ring: bool,
    pub count: u32,
    pub home_planet: bool,
    pub deposits: Vec<String>,
    pub moons: Vec<InitPlanetView>,
}

impl From<&InitPlanet> for InitPlanetView {
    fn from(p: &InitPlanet) -> Self {
        Self {
            name: p.name.clone(),
            class: p.class.clone(),
            size: p.size,
            orbit_distance: p.orbit_distance,
            has_ring: p.has_ring,
            count: p.count,
            home_planet: p.home_planet,
            deposits: p.deposits.clone(),
            moons: p.moons.iter().map(Self::from).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitializerView {
    pub name: String,
    /// The definition file it was read from.
    pub source: String,
    /// A localisation key the app resolves; most initializers name none.
    pub display_name: Option<String>,
    pub class: Option<String>,
    pub usage: Option<String>,
    /// Its `usage` is one a country starts in, so it needs a `spawn_weight`.
    pub empire_spawn: bool,
    pub max_instances: Option<u32>,
    pub flags: Vec<String>,
    /// The countries its `init_effect` creates.
    pub countries: Vec<SpawnedCountry>,
    pub spawns: Vec<String>,
    pub planets: Vec<InitPlanetView>,
    /// Every body `planets` spawns, moons included.
    pub planet_count: u32,
}

impl From<&Initializer> for InitializerView {
    fn from(i: &Initializer) -> Self {
        Self {
            name: i.name.clone(),
            source: i.source.display().to_string(),
            display_name: i.display_name.clone(),
            class: i.class.clone(),
            usage: i.usage.clone(),
            empire_spawn: identity::is_empire_spawn(i.usage.as_deref()),
            max_instances: i.max_instances,
            flags: i.flags.clone(),
            countries: i.countries.clone(),
            spawns: i.spawns.clone(),
            planets: i.planets.iter().map(InitPlanetView::from).collect(),
            planet_count: i.planets.iter().map(InitPlanet::total).sum(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MapColor {
    pub name: String,
    /// `"#rrggbb"`.
    pub map: String,
    pub flag: String,
    pub ship: String,
}

impl From<&ColorDef> for MapColor {
    fn from(c: &ColorDef) -> Self {
        Self {
            name: c.name.clone(),
            map: hex(c.map),
            flag: hex(c.flag),
            ship: hex(c.ship),
        }
    }
}

fn hex(rgb: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetClassView {
    pub key: String,
    pub icon_sprite: Option<String>,
    pub habitable: bool,
    pub star: bool,
}

impl From<&PlanetClassDef> for PlanetClassView {
    fn from(pc: &PlanetClassDef) -> Self {
        Self {
            key: pc.key.clone(),
            icon_sprite: pc.icon.clone(),
            habitable: pc.colonizable,
            star: pc.star,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarbaseLevelView {
    pub key: String,
    pub icon_frame: Option<u32>,
    pub empire_shield: bool,
}

impl From<&StarbaseLevelDef> for StarbaseLevelView {
    fn from(s: &StarbaseLevelDef) -> Self {
        Self {
            key: s.key.clone(),
            icon_frame: s.icon_frame,
            empire_shield: s.empire_shield,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BypassView {
    pub key: String,
    /// The `GFX_ship_class_small` frame the map draws this kind with.
    pub icon_frame: Option<u32>,
}

impl From<&BypassDef> for BypassView {
    fn from(b: &BypassDef) -> Self {
        Self {
            key: b.key.clone(),
            icon_frame: b.icon_frame,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShipSizeView {
    pub key: String,
    /// Bare `common/ship_sizes` icon key; the UI resolves `GFX_<icon>`.
    pub icon: Option<String>,
}

impl From<&ShipSizeDef> for ShipSizeView {
    fn from(s: &ShipSizeDef) -> Self {
        Self {
            key: s.key.clone(),
            icon: s.icon.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CountryTypeView {
    pub name: String,
    pub is_space_critter: bool,
    pub space_creatures: bool,
    pub generate_borders: bool,
    pub is_enclave: bool,
    pub fallen_empire: bool,
    pub playable: bool,
    pub leviathan: bool,
}

impl From<&CountryType> for CountryTypeView {
    fn from(ct: &CountryType) -> Self {
        Self {
            name: ct.name.clone(),
            is_space_critter: ct.is_space_critter,
            space_creatures: ct.space_creatures,
            generate_borders: ct.generate_borders,
            is_enclave: ct.is_enclave,
            fallen_empire: ct.fallen_empire,
            playable: ct.playable,
            leviathan: ct.is_leviathan(),
        }
    }
}

impl GameData {
    /// Every country type, sorted by name.
    pub fn country_type_views(&self) -> Vec<CountryTypeView> {
        self.country_types
            .iter()
            .map(CountryTypeView::from)
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceIcon {
    pub resource: String,
    /// `GFX_` sprite name, for the `sprite:` texture key.
    pub sprite: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BorderDefines {
    pub system_radius: f64,
    pub hyperlane_thickness: f64,
}

impl From<&BorderDefinesData> for BorderDefines {
    fn from(b: &BorderDefinesData) -> Self {
        Self {
            system_radius: b.system_radius,
            hyperlane_thickness: b.hyperlane_thickness,
        }
    }
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// One `map/galaxy` shape a scenario can list itself under with `supports_shape`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GalaxyShapeView {
    pub name: String,
    /// The definition file it was read from.
    pub source: String,
}

impl From<&GalaxyShape> for GalaxyShapeView {
    fn from(shape: &GalaxyShape) -> Self {
        Self {
            name: shape.name.clone(),
            source: shape.source.display().to_string(),
        }
    }
}

impl GameData {
    /// Every galaxy shape, in file order.
    pub fn galaxy_shape_views(&self) -> Vec<GalaxyShapeView> {
        self.galaxy_shapes
            .iter()
            .map(GalaxyShapeView::from)
            .collect()
    }
}
