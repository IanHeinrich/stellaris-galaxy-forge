//! Read-only view of the user's Stellaris install and active mod playset.
//!
//! Nothing from the game is bundled: definitions and localisation are read
//! from the install at runtime (`docs/adr/0002-definitions-from-install.md`),
//! layered vanilla-then-mods as the game does (`docs/game-data-notes.md`).
//! Without an install [`load`] fails with [`LoadError::NoInstall`] and the
//! caller degrades to raw keys.

pub mod deposit_roll;
pub mod details;
pub mod generate;
pub mod initializers;
pub mod install;
pub mod loc;
pub mod planet_views;
pub mod registries;
pub mod reload;
pub(crate) mod resolver;
pub mod scripts;
pub mod special;
pub mod textures;
pub mod views;

use std::path::PathBuf;
use std::sync::Arc;

use install::script::Variables;
use install::{discovery, mods};
use registries::defines::DefineFiles;
use registries::galaxy_sizes::GalaxySizes;
use registries::{colors, gfx, registry, starbase_levels};

pub use initializers::Initializers;
pub use install::layers::Layout;
pub use loc::localisation::Localisation;
pub use registries::bypasses::Bypasses;
pub use registries::colony_types::ColonyTypes;
pub use registries::colors::Colors;
pub use registries::country_types::CountryTypes;
pub use registries::defines::{BorderDefines, DepositDefines};
pub use registries::deposit_categories::DepositCategories;
pub use registries::deposits::Deposits;
pub use registries::galaxy_shapes::GalaxyShapes;
pub use registries::gfx::Sprites;
pub use registries::planet_classes::PlanetClasses;
pub use registries::planet_modifiers::PlanetModifiers;
pub use registries::registry::Registry;
pub use registries::scripted_triggers::ScriptedTriggers;
pub use registries::ship_sizes::ShipSizes;
pub use registries::star_classes::{StarClasses, StarLists};
pub use registries::starbase_levels::StarbaseLevels;
pub use registries::static_modifiers::StaticModifiers;
pub use reload::RegistryKind;
pub use resolver::{export_resolvers, resolver};
pub use scripts::ScriptIndex;

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
    pub sprites: Arc<Sprites>,
    pub colors: Arc<Colors>,
    pub deposits: Arc<Deposits>,
    pub deposit_categories: Arc<DepositCategories>,
    pub static_modifiers: Arc<StaticModifiers>,
    pub planet_modifiers: Arc<PlanetModifiers>,
    pub colony_types: Arc<ColonyTypes>,
    pub bypasses: Arc<Bypasses>,
    pub planet_classes: Arc<PlanetClasses>,
    pub starbase_levels: Arc<StarbaseLevels>,
    pub ship_sizes: Arc<ShipSizes>,
    pub galaxy_shapes: Arc<GalaxyShapes>,
    pub galaxy_sizes: Arc<GalaxySizes>,
    pub border: Arc<BorderDefines>,
    /// `NGameplay`'s deposit counts and Resource Abundance range.
    pub deposit_defines: Arc<DepositDefines>,
    /// `common/scripted_triggers`, which a deposit's `potential` and `drop_weight` call.
    pub scripted_triggers: Arc<ScriptedTriggers>,
    pub loc: Arc<Localisation>,
    pub diagnostics: Vec<Diagnostic>,
    /// What finding the mods raised, which a reread through the same layout keeps.
    discovery: Vec<Diagnostic>,
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
        let star_classes = registry::load(&layout, &vars, &mut diagnostics);
        // The same directory as the star classes, whose load has already reported its files.
        let star_lists = registry::load(&layout, &vars, &mut Vec::new());
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
        let colony_types = registry::load(&layout, &vars, &mut diagnostics);
        let bypasses = registry::load(&layout, &vars, &mut diagnostics);
        let planet_classes = registry::load(&layout, &vars, &mut diagnostics);
        let ship_sizes = registry::load(&layout, &vars, &mut diagnostics);
        let starbase_levels = starbase_levels::load(&layout, &ship_sizes, &vars, &mut diagnostics);
        let galaxy_shapes = GalaxyShapes::load(&layout, &mut diagnostics);
        let galaxy_sizes = GalaxySizes::load(&layout, &mut diagnostics);
        let sprites = gfx::load(&layout, &mut diagnostics);
        let colors = colors::load(&layout, &mut diagnostics);
        let define_files = DefineFiles::load(&layout, &mut diagnostics);
        let border = BorderDefines::load(&define_files);
        let deposit_defines = DepositDefines::load(&define_files);
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
            sprites: Arc::new(sprites),
            colors: Arc::new(colors),
            deposits: Arc::new(deposits),
            deposit_categories: Arc::new(deposit_categories),
            static_modifiers: Arc::new(static_modifiers),
            planet_modifiers: Arc::new(planet_modifiers),
            colony_types: Arc::new(colony_types),
            bypasses: Arc::new(bypasses),
            planet_classes: Arc::new(planet_classes),
            starbase_levels: Arc::new(starbase_levels),
            ship_sizes: Arc::new(ship_sizes),
            galaxy_shapes: Arc::new(galaxy_shapes),
            galaxy_sizes: Arc::new(galaxy_sizes),
            border: Arc::new(border),
            deposit_defines: Arc::new(deposit_defines),
            scripted_triggers: Arc::new(scripted_triggers),
            loc: Arc::new(loc),
            diagnostics,
            discovery,
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
