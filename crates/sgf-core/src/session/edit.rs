use std::sync::Arc;

use super::game_data::draw_scenario_stars_of;
use super::{OpResult, Session};
use crate::ops::{self, Applied, DetailsReach, Op, OpError, Subject};
use crate::projections::galaxy::{BypassLink, GalaxyGraph, Wayline};
use crate::views::{DocumentKind, HistoryEntry};

impl Session {
    /// Apply `op`, record it for undo and validate. The document is unchanged on error, and
    /// an op the document's kind does not take is refused before its format sees it. Built
    /// details are brought up to date before validating, so a finding that reads them (an
    /// overlap) is current. An op that is only an inverse is refused, alone or in a batch.
    pub fn apply(&mut self, op: Op) -> Result<OpResult, OpError> {
        op.check_sendable()?;
        self.apply_inverse(op)
    }

    /// Apply `op` as [`Self::apply`] does, taking an op that is only an inverse too: the
    /// inverse an earlier op returned.
    pub fn apply_inverse(&mut self, op: Op) -> Result<OpResult, OpError> {
        let before = Derived::of(&self.graph);
        let applied = ops::apply(self, op)?;
        self.draw_stars();
        let result = result(
            &self.graph,
            self.history.undo_len() + 1,
            &applied,
            &before,
            false,
        );
        if self.saved_at.is_some_and(|at| at > self.history.undo_len()) {
            self.saved_at = None;
        }
        let in_place = in_place(&applied.op);
        self.history.push(applied);
        Ok(self.finish(result, in_place))
    }

    /// Undo the last op; `None` when there is nothing to undo. The details are brought up
    /// to date before validating, as [`Self::apply`] does.
    pub fn undo(&mut self) -> Result<Option<OpResult>, OpError> {
        let seq = self.history.undo_len();
        let before = Derived::of(&self.graph);
        let Some(applied) = self.history.undo(&mut self.doc, &mut self.graph)? else {
            return Ok(None);
        };
        draw_scenario_stars_of(self.doc.kind(), &mut self.graph, &self.stars);
        let result = result(&self.graph, seq, applied, &before, true);
        let in_place = in_place(&applied.op);
        Ok(Some(self.finish(result, in_place)))
    }

    /// Redo the last undone op; `None` when there is nothing to redo. The details are
    /// brought up to date before validating, as [`Self::apply`] does.
    pub fn redo(&mut self) -> Result<Option<OpResult>, OpError> {
        let seq = self.history.undo_len() + 1;
        let before = Derived::of(&self.graph);
        let Some(applied) = self.history.redo(&mut self.doc, &mut self.graph)? else {
            return Ok(None);
        };
        draw_scenario_stars_of(self.doc.kind(), &mut self.graph, &self.stars);
        let result = result(&self.graph, seq, applied, &before, false);
        let in_place = in_place(&applied.op);
        Ok(Some(self.finish(result, in_place)))
    }

    /// Bring the details up to date with `result`, then validate: the tail of an apply, an
    /// undo and a redo.
    fn finish(&mut self, mut result: OpResult, in_place: bool) -> OpResult {
        self.update_details(in_place, &result);
        result.issues = self.validate();
        result
    }

    /// Bring a built details projection up to date with `result`: reread the planets and
    /// systems it rewrote when `in_place` says that is enough, else build it again.
    fn update_details(&mut self, in_place: bool, result: &OpResult) {
        if result.details_stale.is_empty() {
            return;
        }
        let Some(details) = self.details.get_mut() else {
            return;
        };
        if in_place {
            let planets = result.subjects.iter().filter_map(|s| match *s {
                Subject::Planet { id, system } => Some((id, system)),
                _ => None,
            });
            let systems = result.subjects.iter().filter_map(|s| s.system());
            let details = Arc::make_mut(details);
            let refreshed = details
                .refresh_planets(&self.doc, planets)
                .and_then(|()| details.refresh_systems(&self.doc, systems));
            if refreshed.is_ok() {
                return;
            }
        }
        self.details.take();
        // A projection that fails to build is left unbuilt, as on open.
        let _ = self.details();
    }
}

/// The lists the graph derives whole after an edit, as they stood before it, so a result
/// reports each only when the edit changed it.
struct Derived {
    waylines: Vec<Wayline>,
    bypasses: Vec<BypassLink>,
}

impl Derived {
    fn of(graph: &GalaxyGraph) -> Self {
        Self {
            waylines: graph.waylines.clone(),
            bypasses: graph.bypasses.clone(),
        }
    }
}

/// What `applied` did, or what undoing it did when `undone`. Its issues are left for
/// [`Session::finish`] to fill.
fn result(
    graph: &GalaxyGraph,
    seq: usize,
    applied: &Applied,
    before: &Derived,
    undone: bool,
) -> OpResult {
    let mut touched: Vec<u32> = applied.touched.iter().flat_map(|s| s.systems()).collect();
    touched.sort_unstable();
    touched.dedup();
    let renumbered = if undone {
        applied
            .renumbered
            .iter()
            .filter_map(|&(before, after)| Some((after?, Some(before))))
            .collect()
    } else {
        applied.renumbered.clone()
    };
    let mut details_stale = details_stale(graph.kind, &applied.op, &applied.touched);
    if !renumbered.is_empty() {
        let ids = applied
            .renumbered
            .iter()
            .flat_map(|&(old, new)| [Some(old), new]);
        details_stale.extend(ids.flatten());
        details_stale.sort_unstable();
        details_stale.dedup();
    }
    OpResult {
        details_stale,
        reclassifies: applied.op.reach().reclassifies,
        entry: HistoryEntry {
            seq,
            description: applied.description.clone(),
        },
        inverse: applied.inverse.clone(),
        subjects: applied.touched.clone(),
        touched,
        waylines: (graph.waylines != before.waylines).then(|| graph.waylines.clone()),
        bypasses: (graph.bypasses != before.bypasses).then(|| graph.bypasses.clone()),
        renumbered,
        issues: Vec::new(),
    }
}

/// Whether the details `op` stales come up to date by rereading them in place.
fn in_place(op: &Op) -> bool {
    op.reach().details == DetailsReach::InPlace
}

/// The systems `op` left the details of stale, ascending: those it rewrote and those
/// whose bodies it rewrote, or in a save only the latter when that is all it stales (see
/// [`DetailsReach::Bodies`]). The lane statements it also rewrote name no system of
/// their own.
fn details_stale(kind: DocumentKind, op: &Op, subjects: &[Subject]) -> Vec<u32> {
    let reach = op.reach().details;
    if !reach.stales() {
        return Vec::new();
    }
    if kind == DocumentKind::Scenario && reach == DetailsReach::SaveBodies {
        return Vec::new();
    }
    let bodies_only = kind == DocumentKind::Save
        && matches!(reach, DetailsReach::Bodies | DetailsReach::SaveBodies);
    let mut ids: Vec<u32> = subjects
        .iter()
        .filter_map(|s| match *s {
            Subject::System(id) if !bodies_only => Some(id),
            Subject::Planet { system: id, .. } => Some(id),
            _ => None,
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}
