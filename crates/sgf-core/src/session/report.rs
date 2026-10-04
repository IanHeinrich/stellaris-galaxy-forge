use std::collections::HashSet;

use super::{OpResult, Session};
use crate::archive;
use crate::document::SaveOutcome;
use crate::entity::views::{EntityAddr, EntityKind};
use crate::format::scenario::is_painted;
use crate::library;
use crate::ops::Subject;
use crate::projections::galaxy::{BypassLink, Wayline};
use crate::views::{
    Capabilities, DocumentKind, EditResult, GalaxyDelta, GalaxyView, OpenResult, SaveResult,
    SgfError,
};

impl Session {
    /// What opening the document reports to the app: where it is, what it is, its galaxy,
    /// its issues and what it supports.
    pub fn open_result(&self) -> Result<OpenResult, SgfError> {
        let (meta, painted) = match self.kind() {
            DocumentKind::Save => (Some(archive::parse_meta(self.doc.meta())?), false),
            DocumentKind::Scenario => (None, is_painted(self.doc.original())),
        };
        Ok(OpenResult {
            path: self.path.as_ref().map(|p| p.to_string_lossy().into_owned()),
            cloud: self.path.as_deref().is_some_and(library::is_cloud_save),
            kind: self.kind(),
            painted,
            title: self.title(),
            meta,
            galaxy: GalaxyView::from(&self.graph),
            issues: self.validate(),
            capabilities: Capabilities::of(&self.doc),
        })
    }

    /// What `apply_op`, `undo` and `redo` report to the app.
    pub fn edit_result(&self, result: OpResult) -> EditResult {
        let touched_entities = touched_entities(&result.touched, &result.subjects);
        EditResult {
            entry: result.entry,
            delta: self.delta(
                &result.subjects,
                result.waylines,
                result.bypasses,
                result.renumbered,
            ),
            issues: result.issues,
            history: self.history(),
            dirty: self.is_dirty(),
            touched_entities,
            details_stale: result.details_stale,
            reclassifies: result.reclassifies,
            title: self.title(),
        }
    }

    /// What `save` and `save_as` report to the app.
    pub fn save_result(&self, outcome: SaveOutcome) -> SaveResult {
        SaveResult {
            path: outcome.path.to_string_lossy().into_owned(),
            cloud: library::is_cloud_save(&outcome.path),
            backup_path: outcome.backup.map(|p| p.to_string_lossy().into_owned()),
            dirty: self.is_dirty(),
        }
    }

    /// What the map must replace after an edit of `subjects`: the systems and countries as
    /// they now project, and the systems the document no longer holds so the map drops them.
    fn delta(
        &self,
        subjects: &[Subject],
        waylines: Option<Vec<Wayline>>,
        bypasses: Option<Vec<BypassLink>>,
        renumbered: Vec<(u32, Option<u32>)>,
    ) -> GalaxyDelta {
        let mut delta = GalaxyDelta {
            waylines,
            bypasses,
            renumbered,
            ..GalaxyDelta::default()
        };
        let mut listed = HashSet::new();
        for subject in subjects {
            match *subject {
                Subject::Nebula(_) if delta.nebulae.is_none() => {
                    delta.nebulae = Some(self.graph.nebulae.clone());
                }
                Subject::Nebula(_) => {}
                Subject::Header(_) if delta.header.is_none() => {
                    delta.header = Some(self.graph.header.clone());
                }
                Subject::Header(_) => {}
                Subject::Flags => delta.lgate = self.graph.lgate,
                Subject::Country(id) => {
                    let country = self.graph.countries.iter().find(|c| c.id == id);
                    delta.countries.extend(country.cloned());
                }
                subject => {
                    for id in subject.systems() {
                        if !listed.insert(id) {
                            continue;
                        }
                        match self.system(id) {
                            Some(system) => delta.systems.push(system.clone()),
                            None => delta.removed.push(id),
                        }
                    }
                }
            }
        }
        delta
    }
}

/// The entities an edit rewrote, as the app addresses them: its `systems`, then the planets
/// and countries among its `subjects`.
fn touched_entities(systems: &[u32], subjects: &[Subject]) -> Vec<EntityAddr> {
    let systems = systems
        .iter()
        .map(|&id| EntityAddr::new(EntityKind::System, id));
    let others = subjects.iter().filter_map(|subject| match *subject {
        Subject::Planet { id, .. } => Some(EntityAddr::new(EntityKind::Planet, id)),
        Subject::Country(id) => Some(EntityAddr::new(EntityKind::Country, id)),
        _ => None,
    });
    systems.chain(others).collect()
}
