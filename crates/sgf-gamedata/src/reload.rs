//! Rereading one registry after a file under a layer root changed, without
//! reloading the rest: which registry a path belongs to, and the partial
//! rebuild that shares every other [`Arc`] with the old [`GameData`].

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

use crate::initializers::Initializer;
use crate::install::layers::Layout;
use crate::loc::localisation::Localisation;
use crate::registries::bypasses::BypassDef;
use crate::registries::colony_types::ColonyTypeDef;
use crate::registries::country_types::CountryType;
use crate::registries::deposit_categories::DepositCategory;
use crate::registries::deposits::DepositDef;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::planet_modifiers::PlanetModifierDef;
use crate::registries::registry::FromDef;
use crate::registries::scripted_triggers::ScriptedTrigger;
use crate::registries::ship_sizes::ShipSizeDef;
use crate::registries::star_classes::StarClass;
use crate::registries::static_modifiers::StaticModifierDef;
use crate::registries::{colors, registry, star_names};
use crate::scripts::ScriptIndex;
use crate::{Bypasses, Colors, CountryTypes, Diagnostic, GameData, Initializers};

/// A registry a watched file can belong to; the others are only rebuilt by
/// a full load.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RegistryKind {
    Initializers,
    Scripts,
    CountryTypes,
    Bypasses,
    Colors,
    Localisation,
    /// `common/scripted_variables`, which every definition can read: a change rereads all.
    Variables,
    /// The definitions the generator and the planet page read (deposits and their
    /// categories, star and planet classes and their lists, scripted triggers, modifiers,
    /// colony types, ship sizes, defines, random names). They feed one another and are
    /// never rebuilt apart: a change rereads all.
    Definitions,
}

const ALL: [RegistryKind; 8] = [
    RegistryKind::Initializers,
    RegistryKind::Scripts,
    RegistryKind::CountryTypes,
    RegistryKind::Bypasses,
    RegistryKind::Colors,
    RegistryKind::Localisation,
    RegistryKind::Variables,
    RegistryKind::Definitions,
];

/// The `.txt` directories each registry's loader reads, by path below a layer root.
const DIRS: [(&str, RegistryKind); 20] = [
    (Initializer::DIR, RegistryKind::Initializers),
    ("common/scripted_effects", RegistryKind::Scripts),
    ("events", RegistryKind::Scripts),
    ("common/on_actions", RegistryKind::Scripts),
    ("prescripted_countries", RegistryKind::Scripts),
    ("common/scripted_variables", RegistryKind::Variables),
    (CountryType::DIR, RegistryKind::CountryTypes),
    (BypassDef::DIR, RegistryKind::Bypasses),
    (DepositDef::DIR, RegistryKind::Definitions),
    (DepositCategory::DIR, RegistryKind::Definitions),
    (StarClass::DIR, RegistryKind::Definitions),
    (PlanetClassDef::DIR, RegistryKind::Definitions),
    (ScriptedTrigger::DIR, RegistryKind::Definitions),
    (StaticModifierDef::DIR, RegistryKind::Definitions),
    (PlanetModifierDef::DIR, RegistryKind::Definitions),
    (ColonyTypeDef::DIR, RegistryKind::Definitions),
    (ShipSizeDef::DIR, RegistryKind::Definitions),
    ("common/starbase_levels", RegistryKind::Definitions),
    ("common/defines", RegistryKind::Definitions),
    (star_names::DIR, RegistryKind::Definitions),
];

impl RegistryKind {
    /// The registry `path` feeds, by its path relative to the layer root it
    /// sits under. A path under no root, or one no loader reads, is `None`.
    pub fn classify(layout: &Layout, path: &Path) -> Option<Self> {
        let (_, rel) = layout.layer_of(path)?;
        Self::of_relative(&rel.to_ascii_lowercase())
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Initializers => "initializers",
            Self::Scripts => "scripts",
            Self::CountryTypes => "country_types",
            Self::Bypasses => "bypasses",
            Self::Colors => "colors",
            Self::Localisation => "localisation",
            Self::Variables => "variables",
            Self::Definitions => "definitions",
        }
    }

    fn of_relative(rel: &str) -> Option<Self> {
        if rel.ends_with(".txt")
            && let Some((_, kind)) = DIRS.iter().find(|(dir, _)| {
                rel.strip_prefix(dir)
                    .is_some_and(|below| below.starts_with('/'))
            })
        {
            return Some(*kind);
        }
        if rel
            .strip_prefix("flags/")
            .is_some_and(|under| under.rsplit('/').next() == Some("colors.txt"))
        {
            return Some(Self::Colors);
        }
        if rel.starts_with("localisation/") && rel.ends_with(".yml") {
            return Some(Self::Localisation);
        }
        None
    }

    /// `kinds` plus what they feed: the script index holds the initializer definitions.
    pub fn closure(kinds: &BTreeSet<Self>) -> BTreeSet<Self> {
        let mut all = kinds.clone();
        if all.contains(&Self::Initializers) {
            all.insert(Self::Scripts);
        }
        all
    }
}

impl GameData {
    /// Reread `kinds` from disk, sharing every other registry with `self`.
    /// A registry that comes back empty when the old one was not keeps the
    /// old one and raises [`Diagnostic::RebuildFailed`]. Diagnostics of the
    /// reread registries are replaced by what the reread found, kept or not,
    /// and the rest kept. Returns the registries actually replaced beside the
    /// result.
    pub fn rebuild(&self, kinds: &BTreeSet<RegistryKind>) -> (GameData, BTreeSet<RegistryKind>) {
        if kinds.contains(&RegistryKind::Variables) || kinds.contains(&RegistryKind::Definitions) {
            return (self.reread(), ALL.into_iter().collect());
        }
        let kinds = RegistryKind::closure(kinds);
        let mut fresh = Vec::new();
        let mut replaced = BTreeSet::new();
        let mut out = self.clone();

        if kinds.contains(&RegistryKind::Initializers) {
            let built = Initializers::load(&self.layout, &self.variables, &mut fresh);
            out.initializers = kept(
                RegistryKind::Initializers,
                &self.initializers,
                built,
                Initializers::is_empty,
                &mut replaced,
                &mut fresh,
            );
        }
        if kinds.contains(&RegistryKind::Scripts) {
            let built =
                ScriptIndex::load(&self.layout, &out.initializers, &self.variables, &mut fresh);
            out.scripts = kept(
                RegistryKind::Scripts,
                &self.scripts,
                built,
                ScriptIndex::is_empty,
                &mut replaced,
                &mut fresh,
            );
        }
        if kinds.contains(&RegistryKind::CountryTypes) {
            let built = registry::load(&self.layout, &self.variables, &mut fresh);
            out.country_types = kept(
                RegistryKind::CountryTypes,
                &self.country_types,
                built,
                CountryTypes::is_empty,
                &mut replaced,
                &mut fresh,
            );
        }
        if kinds.contains(&RegistryKind::Bypasses) {
            let built = registry::load(&self.layout, &self.variables, &mut fresh);
            out.bypasses = kept(
                RegistryKind::Bypasses,
                &self.bypasses,
                built,
                Bypasses::is_empty,
                &mut replaced,
                &mut fresh,
            );
        }
        if kinds.contains(&RegistryKind::Colors) {
            let built = colors::load(&self.layout, &mut fresh);
            out.colors = kept(
                RegistryKind::Colors,
                &self.colors,
                built,
                |colors: &Colors| colors.entries.is_empty(),
                &mut replaced,
                &mut fresh,
            );
        }
        if kinds.contains(&RegistryKind::Localisation) {
            let built = Localisation::load(&self.layout, &self.loc.language, &mut fresh);
            out.loc = kept(
                RegistryKind::Localisation,
                &self.loc,
                built,
                Localisation::is_empty,
                &mut replaced,
                &mut fresh,
            );
        }

        if !replaced.is_empty() {
            out.eligibility = Arc::default();
        }
        out.diagnostics
            .retain(|d| !superseded(d, &self.layout, &kinds));
        out.diagnostics.extend(fresh);
        (out, replaced)
    }
}

impl GameData {
    /// Everything read again through the same layout, as a full load would read it.
    fn reread(&self) -> GameData {
        GameData::read(
            self.layout.clone(),
            self.version.clone(),
            self.mods.clone(),
            &self.loc.language,
            self.discovery.clone(),
            &mut |_| {},
        )
    }
}

fn kept<T>(
    kind: RegistryKind,
    old: &Arc<T>,
    built: T,
    is_empty: impl Fn(&T) -> bool,
    replaced: &mut BTreeSet<RegistryKind>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Arc<T> {
    if is_empty(&built) && !is_empty(old) {
        diagnostics.push(Diagnostic::RebuildFailed {
            kind: kind.as_str().to_owned(),
            reason: "reread found nothing; the definitions already loaded stay in use".to_owned(),
        });
        return Arc::clone(old);
    }
    replaced.insert(kind);
    Arc::new(built)
}

/// Whether a diagnostic from the previous load speaks for a registry this
/// rebuild has just read again, whether or not it kept the reread.
fn superseded(d: &Diagnostic, layout: &Layout, kinds: &BTreeSet<RegistryKind>) -> bool {
    let of_file = |file| RegistryKind::classify(layout, file).is_some_and(|k| kinds.contains(&k));
    match d {
        Diagnostic::Override { to, .. } => of_file(to),
        Diagnostic::ParseError { file, .. } | Diagnostic::Unreadable { file, .. } => of_file(file),
        Diagnostic::RebuildFailed { kind, .. } => kinds.iter().any(|k| k.as_str() == kind),
        Diagnostic::ModMissing { .. } => false,
    }
}
