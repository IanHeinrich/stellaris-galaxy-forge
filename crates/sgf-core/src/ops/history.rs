//! Undo/redo stacks of [`Applied`] records. Undo and redo put recorded bytes back
//! and re-project the touched systems; they never re-run an op.

use crate::document::Document;
use crate::ops::{Applied, OpError, refresh};
use crate::projections::galaxy::GalaxyGraph;
use crate::views::{HistoryEntry, HistoryView};

#[derive(Debug, Default)]
pub struct History {
    undo: Vec<Applied>,
    redo: Vec<Applied>,
}

impl History {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a committed op; a new edit discards the redo stack.
    pub fn push(&mut self, applied: Applied) {
        self.undo.push(applied);
        self.redo.clear();
    }

    /// Restore the bytes the last op displaced, most recent replacement first, and
    /// re-project its systems. `None` when there is nothing to undo.
    pub fn undo(
        &mut self,
        doc: &mut Document,
        graph: &mut GalaxyGraph,
    ) -> Result<Option<&Applied>, OpError> {
        let Some(applied) = self.undo.pop() else {
            return Ok(None);
        };
        restore_before(doc, &applied);
        if let Err(e) = refresh(doc, graph, &applied.touched) {
            let _ = replay_after(doc, &applied);
            let _ = refresh(doc, graph, &applied.touched);
            self.undo.push(applied);
            return Err(e);
        }
        self.redo.push(applied);
        Ok(self.redo.last())
    }

    /// Re-apply the bytes of the last undone op and re-project its systems.
    pub fn redo(
        &mut self,
        doc: &mut Document,
        graph: &mut GalaxyGraph,
    ) -> Result<Option<&Applied>, OpError> {
        let Some(applied) = self.redo.pop() else {
            return Ok(None);
        };
        let replayed = replay_after(doc, &applied);
        if let Err(e) = replayed.and_then(|()| refresh(doc, graph, &applied.touched)) {
            restore_before(doc, &applied);
            let _ = refresh(doc, graph, &applied.touched);
            self.redo.push(applied);
            return Err(e);
        }
        self.undo.push(applied);
        Ok(self.undo.last())
    }

    /// Applied ops waiting to be undone.
    pub fn undo_len(&self) -> usize {
        self.undo.len()
    }

    /// Undone ops waiting to be redone.
    pub fn redo_len(&self) -> usize {
        self.redo.len()
    }

    /// The change log: applied ops oldest first, then undone ops next-to-redo first.
    /// `seq` numbers ops from 1 in the order they were applied.
    pub fn entries(&self) -> HistoryView {
        let entry = |seq: usize, a: &Applied| HistoryEntry {
            seq,
            description: a.description.clone(),
            inverse: a.inverse.clone(),
        };
        let undo: Vec<_> = self
            .undo
            .iter()
            .enumerate()
            .map(|(i, a)| entry(i + 1, a))
            .collect();
        let redo: Vec<_> = self
            .redo
            .iter()
            .rev()
            .enumerate()
            .map(|(i, a)| entry(self.undo.len() + i + 1, a))
            .collect();
        HistoryView { undo, redo }
    }
}

/// Put back what the op displaced, most recent replacement first.
fn restore_before(doc: &mut Document, applied: &Applied) {
    for (anchor, prev) in applied.before.iter().rev() {
        doc.restore(*anchor, prev.clone());
    }
}

fn replay_after(doc: &mut Document, applied: &Applied) -> Result<(), OpError> {
    for (anchor, bytes) in &applied.after {
        doc.replace(*anchor, bytes.clone())?;
    }
    Ok(())
}
