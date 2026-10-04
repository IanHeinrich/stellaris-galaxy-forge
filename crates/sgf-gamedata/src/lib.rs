//! Read-only view of the user's Stellaris install and active mod playset.
//!
//! Nothing from the game is bundled: definitions and localisation are read
//! from the install at runtime (`docs/adr/0002-definitions-from-install.md`),
//! layered vanilla-then-mods as the game does (`docs/game-data-notes.md`).
//! Without an install [`load`] fails with [`LoadError::NoInstall`] and the
//! caller degrades to raw keys.

pub mod anomaly_choices;
pub mod body_effects;
pub mod choices;
pub mod condition;
pub mod deposit_choices;
pub mod deposit_roll;
pub mod details;
pub mod dig_site_choices;
pub mod fonts;
pub mod generate;
pub mod initializers;
pub mod install;
pub mod layouts;
pub mod loc;
pub mod menu;
pub mod modifier_choices;
pub mod naming;
pub(crate) mod orbit_walk;
pub mod planet_models;
pub mod planet_views;
pub mod registries;
pub(crate) mod reload;
pub(crate) mod resolver;
pub mod rng;
pub mod scripts;
pub mod special;
pub mod summary;
pub mod textures;
pub mod views;
pub(crate) mod weight;

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use install::script::{ParsedDir, Variables};
use install::{discovery, mods, script};
use layouts::Eligibility;
use registries::galaxy_sizes::GalaxySizes;
use registries::planet_classes::PlanetClassDef;
use registries::registry::FromDef;
use registries::star_classes::StarClass;
use registries::{colors, flags, gfx, planet_lists, registry, star_names, starbase_levels};
use sgf_core::ops::SystemRadii;

pub use initializers::Initializers;
pub use install::layers::Layout;
pub use loc::localisation::Localisation;
pub use registries::anomalies::AnomalyCategories;
pub use registries::asteroid_belts::AsteroidBelts;
pub use registries::bypasses::Bypasses;
pub use registries::colony_types::ColonyTypes;
pub use registries::colors::Colors;
pub use registries::country_types::CountryTypes;
pub use registries::defines::{BorderDefines, DepositDefines};
pub use registries::deposit_categories::DepositCategories;
pub use registries::deposits::Deposits;
pub use registries::dig_site_types::DigSiteTypes;
pub use registries::flags::Flags;
pub use registries::galaxy_shapes::GalaxyShapes;
pub use registries::gfx::Sprites;
pub use registries::planet_classes::PlanetClasses;
pub use registries::planet_lists::PlanetLists;
pub use registries::planet_modifiers::PlanetModifiers;
pub use registries::precursors::PrecursorCivilizations;
pub use registries::registry::Registry;
pub use registries::scripted_triggers::ScriptedTriggers;
pub use registries::ship_sizes::ShipSizes;
pub use registries::star_classes::{StarClasses, StarLists};
pub use registries::starbase_levels::StarbaseLevels;
pub use registries::static_modifiers::StaticModifiers;
pub use registries::terraform_links::TerraformLinks;
pub use reload::RegistryKind;
pub use resolver::{export_resolvers, resolver};
pub use scripts::ScriptIndex;

pub(crate) const DEFINES_DIR: &str = "common/defines";

/// Every registry is an [`Arc`] so a partial rebuild
/// ([`GameData::rebuild`]) can replace one and share the rest.
#[derive(Debug, Clone)]
pub struct GameData {
    pub layout: Layout,
    pub version: Option<String>,
    /// Every enabled mod in load order, `Missing` ones included.
    pub mods: Vec<mods::ModInfo>,
    /// `common/scripted_variables`, which every definition's `@name` can refer to.
    pub variables: Arc<Variables>,
    pub initializers: Arc<Initializers>,
    pub scripts: Arc<ScriptIndex>,
    pub country_types: Arc<CountryTypes>,
    pub star_classes: Arc<StarClasses>,
    /// `common/star_classes/randomizers`: the `rl_` lists an initializer draws its star from.
    pub star_lists: Arc<StarLists>,
    /// `common/random_names`: every star name a galaxy can be named from, in file order.
    pub star_names: Arc<Vec<String>>,
    /// `common/random_names`: every nebula name a galaxy can be named from, in file order.
    pub nebula_names: Arc<Vec<String>>,
    /// `common/random_names`: every name a galaxy can give a black hole, in file order.
    pub black_hole_names: Arc<Vec<String>>,
    pub sprites: Arc<Sprites>,
    pub colors: Arc<Colors>,
    /// `flags/`: the emblem and background `.dds` files a flag can use.
    pub flags: Arc<Flags>,
    pub deposits: Arc<Deposits>,
    pub deposit_categories: Arc<DepositCategories>,
    pub static_modifiers: Arc<StaticModifiers>,
    pub planet_modifiers: Arc<PlanetModifiers>,
    /// `common/anomalies`: the categories a planet's `anomaly` names.
    pub anomaly_categories: Arc<AnomalyCategories>,
    pub colony_types: Arc<ColonyTypes>,
    /// `common/archaeological_site_types`: the dig sites a planet can hold.
    pub dig_site_types: Arc<DigSiteTypes>,
    pub asteroid_belts: Arc<AsteroidBelts>,
    pub bypasses: Arc<Bypasses>,
    pub planet_classes: Arc<PlanetClasses>,
    /// `common/planet_classes`' `rl_` lists an initializer's body draws its class from.
    pub planet_lists: Arc<PlanetLists>,
    /// `common/terraform`: the modifier that lets a planet class be terraformed, by class.
    pub terraform_links: Arc<TerraformLinks>,
    pub starbase_levels: Arc<StarbaseLevels>,
    pub ship_sizes: Arc<ShipSizes>,
    pub galaxy_shapes: Arc<GalaxyShapes>,
    pub galaxy_sizes: Arc<GalaxySizes>,
    /// `common/precursor_civilizations`: the star flags that mark each precursor's region.
    pub precursors: Arc<PrecursorCivilizations>,
    pub border: Arc<BorderDefines>,
    /// `NGameplay`'s deposit counts and Resource Abundance range.
    pub deposit_defines: Arc<DepositDefines>,
    /// `NGameplay`'s rules for how far out a system's inner and outer radii lie.
    pub system_radii: SystemRadii,
    /// `common/scripted_triggers`, which a deposit's `potential` and `drop_weight` call.
    pub scripted_triggers: Arc<ScriptedTriggers>,
    pub loc: Arc<Localisation>,
    pub diagnostics: Vec<Diagnostic>,
    /// What finding the mods raised, which a reread through the same layout keeps.
    discovery: Vec<Diagnostic>,
    /// What the generator makes of each layout, worked out once for these registries.
    eligibility: Arc<OnceLock<HashMap<String, Eligibility>>>,
    /// What `gfx/models/planets` says about each entity's surface, read once for this layout.
    surface_maps: Arc<OnceLock<textures::planet_disc::SurfaceMaps>>,
    /// The planet classes drawn from their icons alone, worked out once for this layout.
    flat_art: Arc<OnceLock<BTreeSet<String>>>,
    /// The planet classes drawn broken apart, worked out once for this layout.
    shattered: Arc<OnceLock<BTreeSet<String>>>,
}

#[derive(Debug, Clone)]
pub struct LoadOptions {
    /// The game root; discovered through Steam when `None`.
    pub install: Option<PathBuf>,
    /// The launcher's user data dir; the platform default when `None`.
    pub user_dir: Option<PathBuf>,
    /// Localisation language folder name, `"english"`.
    pub language: String,
    /// Layer the enabled mods from `dlc_load.json` over vanilla.
    pub mods: bool,
}

impl Default for LoadOptions {
    fn default() -> Self {
        Self {
            install: None,
            user_dir: None,
            language: "english".to_owned(),
            mods: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Discover,
    Definitions,
    Localisation,
}

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("no Stellaris install found; searched {}", join_paths(searched))]
    NoInstall { searched: Vec<PathBuf> },
}

/// Something worth telling the user that did not stop the load.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Diagnostic {
    /// `key` defined in `from` was replaced by a later definition in `to`.
    Override {
        key: String,
        from: PathBuf,
        to: PathBuf,
    },
    /// A definition file the script parser rejected; its keys are absent.
    ParseError {
        file: PathBuf,
        offset: usize,
        reason: String,
    },
    /// A file that could not be read or decoded; it contributes nothing.
    Unreadable { file: PathBuf, reason: String },
    /// An enabled mod whose directory exists nowhere; the layer is skipped.
    ModMissing { id: String, name: String },
    /// A registry a rebuild could not read; the previous one is still in use.
    RebuildFailed { kind: String, reason: String },
}

impl Diagnostic {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Override { .. } => "override",
            Self::ParseError { .. } => "parse_error",
            Self::Unreadable { .. } => "unreadable",
            Self::ModMissing { .. } => "mod_missing",
            Self::RebuildFailed { .. } => "rebuild_failed",
        }
    }
}

impl std::fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Override { key, from, to } => {
                write!(f, "{key}: {} overrides {}", to.display(), from.display())
            }
            Self::ParseError {
                file,
                offset,
                reason,
            } => write!(f, "{}: {reason} at byte {offset}", file.display()),
            Self::Unreadable { file, reason } => write!(f, "{}: {reason}", file.display()),
            Self::ModMissing { id, name } => write!(f, "{name} ({id}): directory not found"),
            Self::RebuildFailed { kind, reason } => write!(f, "{kind}: {reason}"),
        }
    }
}

/// Discover the install and mods, then read definitions and localisation.
pub fn load(opts: &LoadOptions, progress: &mut dyn FnMut(Phase)) -> Result<GameData, LoadError> {
    progress(Phase::Discover);
    let install = discovery::find_install(opts.install.as_deref())?;
    let version = discovery::install_version(&install);
    let user_dir = opts
        .user_dir
        .clone()
        .or_else(sgf_core::library::paradox_user_dir);
    let mut diagnostics = Vec::new();
    let mods = match (&user_dir, opts.mods) {
        (Some(dir), true) => {
            mods::enabled_mods(dir, &discovery::steam_libraries(), &mut diagnostics)
        }
        _ => Vec::new(),
    };
    let layout = Layout::new(install, user_dir, &mods);
    Ok(GameData::read(
        layout,
        version,
        mods,
        &opts.language,
        diagnostics,
        progress,
    ))
}

impl GameData {
    /// What the generator makes of each layout of the install, by key.
    pub(crate) fn eligibility(&self) -> &HashMap<String, Eligibility> {
        self.eligibility.get_or_init(|| {
            self.initializers
                .iter()
                .map(|init| (init.name.clone(), layouts::judge(self, init)))
                .collect()
        })
    }

    /// Every definition and the localisation, read through `layout`.
    pub(crate) fn read(
        layout: Layout,
        version: Option<String>,
        mods: Vec<mods::ModInfo>,
        language: &str,
        discovery: Vec<Diagnostic>,
        progress: &mut dyn FnMut(Phase),
    ) -> Self {
        let mut diagnostics = discovery.clone();
        progress(Phase::Definitions);
        let vars = Arc::new(Variables::load(&layout, &mut diagnostics));
        let initializers = Initializers::load(&layout, &vars, &mut diagnostics);
        let scripts = ScriptIndex::load(&layout, &initializers, &vars, &mut diagnostics);
        let country_types = registry::load(&layout, &vars, &mut diagnostics);
        let star_defs = script::parse_dir(&layout, StarClass::DIR, &vars, &mut diagnostics);
        let star_classes = registry::from_defs(&star_defs);
        let star_lists = registry::from_defs(&star_defs);
        let random_names = ParsedDir::load(&layout, star_names::DIR, &mut diagnostics);
        let star_names = star_names::names(&random_names, star_names::STARS);
        let nebula_names = star_names::names(&random_names, star_names::NEBULAE);
        let black_hole_names = star_names::names(&random_names, star_names::BLACK_HOLES);
        let deposits = registry::load(&layout, &vars, &mut diagnostics);
        let deposit_categories = registry::load(&layout, &vars, &mut diagnostics);
        // Vanilla defines a few static modifiers in two files, which is no one's mistake to report.
        let mut parsing = Vec::new();
        let static_modifiers = registry::load(&layout, &vars, &mut parsing);
        diagnostics.extend(
            parsing
                .into_iter()
                .filter(|d| !matches!(d, Diagnostic::Override { .. })),
        );
        let planet_modifiers = registry::load(&layout, &vars, &mut diagnostics);
        let anomaly_categories = registry::load(&layout, &vars, &mut diagnostics);
        let colony_types = registry::load(&layout, &vars, &mut diagnostics);
        let dig_site_types = registry::load(&layout, &vars, &mut diagnostics);
        let asteroid_belts = registry::load(&layout, &vars, &mut diagnostics);
        let bypasses = registry::load(&layout, &vars, &mut diagnostics);
        let planet_dir = ParsedDir::load(&layout, PlanetClassDef::DIR, &mut diagnostics);
        let planet_lists = planet_lists::read(&planet_dir);
        let mut overrides = Vec::new();
        let planet_classes = registry::from_defs(&planet_dir.into_defs(&vars, &mut overrides));
        diagnostics.extend(overrides.into_iter().filter(
            |d| !matches!(d, Diagnostic::Override { key, .. } if key == planet_lists::KEY),
        ));
        let terraform_links = TerraformLinks::load(&layout, &mut diagnostics);
        let ship_sizes = registry::load(&layout, &vars, &mut diagnostics);
        let starbase_levels = starbase_levels::load(&layout, &ship_sizes, &vars, &mut diagnostics);
        let galaxy_shapes = GalaxyShapes::load(&layout, &mut diagnostics);
        let galaxy_sizes = GalaxySizes::load(&layout, &mut diagnostics);
        let precursors = PrecursorCivilizations::load(&layout, &mut diagnostics);
        let sprites = gfx::load(&layout, &mut diagnostics);
        let colors = colors::load(&layout, &mut diagnostics);
        let flags = flags::Flags::load(&layout);
        let define_files = ParsedDir::load(&layout, DEFINES_DIR, &mut diagnostics);
        let border = BorderDefines::load(&define_files);
        let deposit_defines = DepositDefines::load(&define_files);
        let system_radii = registries::defines::system_radii(&define_files);
        let scripted_triggers = registry::load(&layout, &vars, &mut diagnostics);

        progress(Phase::Localisation);
        let loc = Localisation::load(&layout, language, &mut diagnostics);

        GameData {
            layout,
            version,
            mods,
            variables: vars,
            initializers: Arc::new(initializers),
            scripts: Arc::new(scripts),
            country_types: Arc::new(country_types),
            star_classes: Arc::new(star_classes),
            star_lists: Arc::new(star_lists),
            star_names: Arc::new(star_names),
            nebula_names: Arc::new(nebula_names),
            black_hole_names: Arc::new(black_hole_names),
            sprites: Arc::new(sprites),
            colors: Arc::new(colors),
            flags: Arc::new(flags),
            deposits: Arc::new(deposits),
            deposit_categories: Arc::new(deposit_categories),
            static_modifiers: Arc::new(static_modifiers),
            planet_modifiers: Arc::new(planet_modifiers),
            anomaly_categories: Arc::new(anomaly_categories),
            colony_types: Arc::new(colony_types),
            dig_site_types: Arc::new(dig_site_types),
            asteroid_belts: Arc::new(asteroid_belts),
            bypasses: Arc::new(bypasses),
            planet_classes: Arc::new(planet_classes),
            planet_lists: Arc::new(planet_lists),
            terraform_links: Arc::new(terraform_links),
            starbase_levels: Arc::new(starbase_levels),
            ship_sizes: Arc::new(ship_sizes),
            galaxy_shapes: Arc::new(galaxy_shapes),
            galaxy_sizes: Arc::new(galaxy_sizes),
            precursors: Arc::new(precursors),
            border: Arc::new(border),
            deposit_defines: Arc::new(deposit_defines),
            system_radii,
            scripted_triggers: Arc::new(scripted_triggers),
            loc: Arc::new(loc),
            diagnostics,
            discovery,
            eligibility: Arc::default(),
            surface_maps: Arc::default(),
            flat_art: Arc::default(),
            shattered: Arc::default(),
        }
    }
}

fn join_paths(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}
