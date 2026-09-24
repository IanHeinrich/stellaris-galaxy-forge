//! Rereading one registry after a file under a layer root changed, without
//! reloading the rest: which registry a path belongs to, and the partial
//! rebuild that shares every other [`Arc`] with the old [`GameData`].

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

use crate::install::layers::Layout;
use crate::loc::localisation::Localisation;
use crate::registries::{colors, registry};
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
}

const ALL: [RegistryKind; 7] = [
    RegistryKind::Initializers,
    RegistryKind::Scripts,
    RegistryKind::CountryTypes,
    RegistryKind::Bypasses,
    RegistryKind::Colors,
    RegistryKind::Localisation,
    RegistryKind::Variables,
];

impl RegistryKind {
    /// The registry `path` feeds, by its path relative to the layer root it
    /// sits under. A path under no root, or one no loader reads, is `None`.
    pub fn classify(layout: &Layout, path: &Path) -> Option<Self> {
        let path = lower(path);
        let rel = layout
            .layers
            .iter()
            .filter_map(|layer| {
                path.strip_prefix(lower(&layer.root).trim_end_matches('/'))?
                    .strip_prefix('/')
            })
            .min_by_key(|rel| rel.len())?;
        Self::of_relative(rel)
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
        }
    }

    fn of_relative(rel: &str) -> Option<Self> {
        let txt = |dir: &str| rel.ends_with(".txt") && rel.starts_with(dir);
        if txt("common/solar_system_initializers/") {
            return Some(Self::Initializers);
        }
        if txt("common/scripted_effects/")
            || txt("events/")
            || txt("common/on_actions/")
            || txt("prescripted_countries/")
        {
            return Some(Self::Scripts);
        }
        if txt("common/scripted_variables/") {
            return Some(Self::Variables);
        }
        if txt("common/country_types/") {
            return Some(Self::CountryTypes);
        }
        if txt("common/bypass/") {
            return Some(Self::Bypasses);
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
    /// rebuilt registries are replaced, the rest kept. Returns the registries
    /// actually replaced beside the result.
    pub fn rebuild(&self, kinds: &BTreeSet<RegistryKind>) -> (GameData, BTreeSet<RegistryKind>) {
        if kinds.contains(&RegistryKind::Variables) {
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
                Colors::is_empty,
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

        out.diagnostics
            .retain(|d| !superseded(d, &self.layout, &replaced));
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
/// rebuild has just read again.
fn superseded(d: &Diagnostic, layout: &Layout, kinds: &BTreeSet<RegistryKind>) -> bool {
    let of_file = |file| RegistryKind::classify(layout, file).is_some_and(|k| kinds.contains(&k));
    match d {
        Diagnostic::Override { to, .. } => of_file(to),
        Diagnostic::ParseError { file, .. } | Diagnostic::Unreadable { file, .. } => of_file(file),
        Diagnostic::RebuildFailed { kind, .. } => kinds.iter().any(|k| k.as_str() == kind),
        Diagnostic::ModMissing { .. } => false,
    }
}

fn lower(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}
