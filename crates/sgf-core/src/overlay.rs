//! Patch overlay: one slot per edited statement, keyed to original offsets.
//!
//! The original bytes are never modified. An original slot records the bytes that
//! currently stand for one original span; an inserted slot records text that has no
//! home in the original and is emitted at an original offset. Slots are keyed by
//! `(start, seq)` (originals have `seq == 0`, inserts at one offset count from 1)
//! and that order is the emission order, so saving is a single pass streaming
//! original gaps and slot contents (see `docs/adr/0001-document-model.md`).

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::collections::btree_map;

use crate::span::Span;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum OverlayError {
    /// `span` intersects an existing original slot without equalling it.
    #[error("span {}..{} partially overlaps slot {}..{}", span.start, span.end, slot.start, slot.end)]
    Overlaps { span: Span, slot: Span },
    /// `span` reaches past the end of the original bytes.
    #[error("span {}..{} lies outside the original ({len} bytes)", span.start, span.end)]
    OutOfBounds { span: Span, len: usize },
    /// An insert at `at` and a replacement of `slot` cannot coexist: `at` lies strictly
    /// inside `slot`, or at the start of a non-empty `slot`.
    #[error("insert at {at} lies inside slot {}..{}", slot.start, slot.end)]
    InsertInsideSlot { at: usize, slot: Span },
    /// No inserted slot `seq` exists at `at`.
    #[error("no insert {seq} at offset {at}")]
    MissingInsert { at: usize, seq: u32 },
}

/// Where a slot sits relative to the original bytes.
///
/// Anchors order by `(start, seq)`, which is the emission order: at one offset the
/// original slot (if any) comes first, then the inserts in `seq` order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Anchor {
    /// A span of the original bytes, replaced by the slot's content.
    Original(Span),
    /// Text inserted at original offset `at`; several inserts at one offset are
    /// ordered by `seq` (from 1).
    Inserted { at: usize, seq: u32 },
}

impl Anchor {
    pub fn start(self) -> usize {
        match self {
            Anchor::Original(span) => span.start,
            Anchor::Inserted { at, .. } => at,
        }
    }

    pub fn end(self) -> usize {
        match self {
            Anchor::Original(span) => span.end,
            Anchor::Inserted { at, .. } => at,
        }
    }

    pub fn is_inserted(self) -> bool {
        matches!(self, Anchor::Inserted { .. })
    }

    fn key(self) -> Key {
        match self {
            Anchor::Original(span) => (span.start, 0),
            Anchor::Inserted { at, seq } => (at, seq),
        }
    }

    fn from_key((start, seq): Key, end: usize) -> Self {
        if seq == 0 {
            Anchor::Original(Span::new(start, end))
        } else {
            Anchor::Inserted { at: start, seq }
        }
    }
}

impl From<Span> for Anchor {
    fn from(span: Span) -> Self {
        Anchor::Original(span)
    }
}

impl PartialOrd for Anchor {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Anchor {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.key(), self.end()).cmp(&(other.key(), other.end()))
    }
}

/// `(start, seq)`: originals have `seq == 0`, inserts at one offset count from 1.
type Key = (usize, u32);

/// The bytes currently standing for one anchor (the key holds `start` and `seq`).
#[derive(Clone, Debug, PartialEq, Eq)]
struct Slot {
    end: usize,
    current: Vec<u8>,
}

/// Slots keyed by `(start, seq)`.
///
/// Invariants: original slots are pairwise disjoint (two never share a start, even
/// when zero-length) with `end >= start`; an inserted slot has `end == start` and
/// its offset lies neither strictly inside an original slot nor at the start of a
/// non-empty one, so emission is a single forward pass. Every slot lies within
/// `0..=original.len()`; `Document` enforces that bound because the overlay does not
/// hold the original. `next_seq` never decreases, so a seq freed by `restore` is
/// never reused.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Overlay {
    slots: BTreeMap<Key, Slot>,
    next_seq: BTreeMap<usize, u32>,
}

impl Overlay {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// Bytes currently standing for `anchor`. For an original span: the slot's content
    /// when the span equals a slot exactly, the original bytes when no slot touches it,
    /// else `Err(Overlaps)` or `Err(InsertInsideSlot)`. For an insert: its content or
    /// `Err(MissingInsert)`.
    pub fn current<'a>(
        &'a self,
        anchor: impl Into<Anchor>,
        orig: &'a [u8],
    ) -> Result<&'a [u8], OverlayError> {
        let anchor = anchor.into();
        match anchor {
            Anchor::Original(span) => {
                if let Some(slot) = self.slots.get(&anchor.key()) {
                    return if slot.end == span.end {
                        Ok(&slot.current)
                    } else {
                        Err(OverlayError::Overlaps {
                            span,
                            slot: Span::new(span.start, slot.end),
                        })
                    };
                }
                self.check_original(span)?;
                if span.end > orig.len() {
                    return Err(OverlayError::OutOfBounds {
                        span,
                        len: orig.len(),
                    });
                }
                Ok(span.slice(orig))
            }
            Anchor::Inserted { at, seq } => self
                .slots
                .get(&anchor.key())
                .map(|slot| slot.current.as_slice())
                .ok_or(OverlayError::MissingInsert { at, seq }),
        }
    }

    /// Insert `bytes` at original offset `at`, after any original slot and earlier
    /// inserts there. Returns the new slot's anchor.
    pub fn insert(&mut self, at: usize, bytes: Vec<u8>) -> Result<Anchor, OverlayError> {
        self.check_insert(at)?;
        let seq = self.next_seq.entry(at).or_default();
        *seq += 1;
        let anchor = Anchor::Inserted { at, seq: *seq };
        self.slots.insert(
            anchor.key(),
            Slot {
                end: at,
                current: bytes,
            },
        );
        self.debug_check(anchor.key());
        Ok(anchor)
    }

    /// Replace the bytes standing for `anchor`. Returns the previous replacement if
    /// the slot existed. An original span may be empty (a pure insertion at that
    /// offset); an absent inserted slot is created with exactly that `(at, seq)`,
    /// which is how a recorded insertion is replayed. Conflicts with existing slots
    /// are errors (an invariant violation by the caller), not panics.
    pub fn replace(
        &mut self,
        anchor: impl Into<Anchor>,
        bytes: Vec<u8>,
    ) -> Result<Option<Vec<u8>>, OverlayError> {
        let anchor = anchor.into();
        let key = anchor.key();
        let prev = match self.slots.get_mut(&key) {
            Some(slot) if slot.end == anchor.end() => {
                Some(std::mem::replace(&mut slot.current, bytes))
            }
            Some(slot) => {
                return Err(OverlayError::Overlaps {
                    span: Span::new(anchor.start(), anchor.end()),
                    slot: Span::new(anchor.start(), slot.end),
                });
            }
            None => {
                match anchor {
                    Anchor::Original(span) => self.check_original(span)?,
                    Anchor::Inserted { at, seq } => {
                        self.check_insert(at)?;
                        self.reserve_seq(at, seq);
                    }
                }
                self.slots.insert(
                    key,
                    Slot {
                        end: anchor.end(),
                        current: bytes,
                    },
                );
                None
            }
        };
        self.debug_check(key);
        Ok(prev)
    }

    /// Undo helper: put back `prev` (a previous replacement) or remove the slot when
    /// `None`. `anchor` must be a slot or conflict with none, as it was when the value
    /// being undone was recorded.
    pub fn restore(&mut self, anchor: impl Into<Anchor>, prev: Option<Vec<u8>>) {
        let anchor = anchor.into();
        let key = anchor.key();
        match prev {
            Some(bytes) => {
                debug_assert!(
                    match self.slots.get(&key) {
                        Some(slot) => slot.end == anchor.end(),
                        None => match anchor {
                            Anchor::Original(span) => self.check_original(span).is_ok(),
                            Anchor::Inserted { at, .. } => self.check_insert(at).is_ok(),
                        },
                    },
                    "restore of {anchor:?} would conflict with an existing slot"
                );
                if let Anchor::Inserted { at, seq } = anchor {
                    self.reserve_seq(at, seq);
                }
                self.slots.insert(
                    key,
                    Slot {
                        end: anchor.end(),
                        current: bytes,
                    },
                );
            }
            None => {
                let removed = self.slots.remove(&key);
                debug_assert!(
                    removed.is_none_or(|s| s.end == anchor.end()),
                    "restore of {anchor:?} removed a slot with a different end"
                );
            }
        }
        self.debug_check(key);
    }

    /// The original slot that has swallowed `span` whole without being `span` itself.
    ///
    /// A removal replaces the line a statement stood on, so the statement's own span is
    /// no longer a slot of its own: a reader that still names it learns from this that
    /// the bytes now standing for it are the enclosing slot's.
    pub fn enclosing(&self, span: Span) -> Option<&[u8]> {
        self.slots
            .range(..=(span.start, 0))
            .rev()
            .find(|(key, _)| key.1 == 0)
            .filter(|(key, slot)| {
                (key.0, slot.end) != (span.start, span.end)
                    && key.0 <= span.start
                    && slot.end >= span.end
            })
            .map(|(_, slot)| slot.current.as_slice())
    }

    /// Whether a replacement of `span` would swallow an insert: one strictly inside it,
    /// or at the start of a non-empty `span`.
    pub(crate) fn has_insert_within(&self, span: Span) -> bool {
        self.insert_within(span).is_some()
    }

    /// Whether an original slot starts at `start`.
    pub fn has_original_at(&self, start: usize) -> bool {
        self.slots.contains_key(&(start, 0))
    }

    /// Whether the statement at `anchor` is gone: the bytes now standing for it, whether
    /// that is its own slot or the bigger slot that swallowed it when a removal took the
    /// whole line, are blank.
    pub(crate) fn removed(&self, anchor: Anchor, original: &[u8]) -> bool {
        let Anchor::Original(span) = anchor else {
            return false;
        };
        match self.current(anchor, original) {
            Ok(bytes) => blank_slot(bytes),
            Err(_) => self.enclosing(span).is_some_and(blank_slot),
        }
    }

    /// Every slot in emission order with its current bytes.
    pub fn slots(&self) -> impl Iterator<Item = (Anchor, &[u8])> {
        self.slots
            .iter()
            .map(|(&key, slot)| (Anchor::from_key(key, slot.end), slot.current.as_slice()))
    }

    /// Original gaps and slot contents in emission order, for streaming to the archive
    /// writer. With no slots this yields exactly one piece: the whole original.
    /// Empty gaps and empty contents are skipped.
    pub fn pieces<'a>(&'a self, orig: &'a [u8]) -> impl Iterator<Item = &'a [u8]> {
        Pieces {
            orig,
            slots: self.slots.iter(),
            pos: 0,
            pending: None,
            finished: false,
        }
    }

    /// Whether a new original slot for `span` would conflict with an existing slot,
    /// given that no slot starts at `span.start` with `seq == 0`.
    fn check_original(&self, span: Span) -> Result<(), OverlayError> {
        if let Some(slot) = self.overlapping(span) {
            return Err(OverlayError::Overlaps { span, slot });
        }
        if let Some(at) = self.insert_within(span) {
            return Err(OverlayError::InsertInsideSlot { at, slot: span });
        }
        Ok(())
    }

    /// Whether a new insert at `at` would conflict with an original slot.
    fn check_insert(&self, at: usize) -> Result<(), OverlayError> {
        let point = Span::new(at, at);
        let slot = self
            .slots
            .get(&(at, 0))
            .filter(|slot| slot.end > at)
            .map(|slot| Span::new(at, slot.end))
            .or_else(|| self.overlapping(point));
        match slot {
            Some(slot) => Err(OverlayError::InsertInsideSlot { at, slot }),
            None => Ok(()),
        }
    }

    fn reserve_seq(&mut self, at: usize, seq: u32) {
        let next = self.next_seq.entry(at).or_default();
        *next = (*next).max(seq);
    }

    /// The original slot that intersects `span` without sharing its start, if any.
    ///
    /// Original slots are disjoint and sorted, so only the last one starting before
    /// `span.end` can reach into `span`. A slot at `span.start` itself is the
    /// caller's business (it may be an exact match).
    fn overlapping(&self, span: Span) -> Option<Span> {
        self.slots
            .range(..(span.end, 0))
            .rev()
            .find(|(key, _)| key.1 == 0)
            .map(|(&(start, _), slot)| Span::new(start, slot.end))
            .filter(|slot| slot.start != span.start && intersects(*slot, span))
    }

    /// The offset of the first insert that a replacement of `span` would swallow:
    /// strictly inside it, or at the start of a non-empty `span`.
    fn insert_within(&self, span: Span) -> Option<usize> {
        if span.is_empty() {
            return None;
        }
        self.slots
            .range((span.start, 1)..(span.end, 0))
            .map(|(&key, _)| key)
            .find(|&(_, seq)| seq != 0)
            .map(|(at, _)| at)
    }

    /// The invariants a write of the slot at `key` could have broken: its own shape, the
    /// last original slot before it, and the slots its span reaches.
    fn debug_check(&self, key: Key) {
        if !cfg!(debug_assertions) {
            return;
        }
        let Some(slot) = self.slots.get(&key) else {
            return;
        };
        let prev = self
            .slots
            .range(..key)
            .rev()
            .find(|(k, _)| k.1 == 0)
            .map(|(&(start, _), s)| Span::new(start, s.end));
        match Anchor::from_key(key, slot.end) {
            Anchor::Original(span) => {
                debug_assert!(
                    span.start <= span.end,
                    "slot {span:?} ends before it starts"
                );
                if let Some(p) = prev {
                    debug_assert!(!intersects(p, span), "slots {p:?} and {span:?} intersect");
                }
                if span.end > span.start {
                    let inside = self.slots.range((span.start, 1)..(span.end, 0)).next();
                    debug_assert!(
                        inside.is_none(),
                        "slot {:?} lies inside slot {span:?}",
                        inside.map(|(k, _)| k)
                    );
                }
            }
            anchor @ Anchor::Inserted { at, seq } => {
                debug_assert!(
                    self.next_seq.get(&at).is_some_and(|&next| seq <= next),
                    "insert {anchor:?} beyond its offset's counter"
                );
                if let Some(p) = prev {
                    debug_assert!(
                        !(p.start < at && at < p.end) && !(p.start == at && p.end > at),
                        "insert at {at} lies inside slot {p:?}"
                    );
                }
            }
        }
    }
}

/// Half-open intersection, with two spans sharing a start always counting as
/// intersecting so that zero-length spans cannot pile up at one offset.
fn intersects(a: Span, b: Span) -> bool {
    a.start == b.start || (a.start < b.end && b.start < a.end)
}

struct Pieces<'a> {
    orig: &'a [u8],
    slots: btree_map::Iter<'a, Key, Slot>,
    /// Bytes of `orig` before this offset have been yielded or replaced.
    pos: usize,
    /// Slot content to yield once the gap before it has gone out.
    pending: Option<&'a [u8]>,
    finished: bool,
}

impl<'a> Iterator for Pieces<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        loop {
            if let Some(content) = self.pending.take().filter(|c| !c.is_empty()) {
                return Some(content);
            }
            if self.finished {
                return None;
            }
            match self.slots.next() {
                Some((&(start, _), slot)) => {
                    let gap = &self.orig[self.pos..start];
                    self.pos = slot.end;
                    self.pending = Some(&slot.current);
                    if !gap.is_empty() {
                        return Some(gap);
                    }
                }
                None => {
                    self.finished = true;
                    let tail = &self.orig[self.pos..];
                    if !tail.is_empty() || self.pos == 0 {
                        return Some(tail);
                    }
                }
            }
        }
    }
}

/// What stands beside a statement on its line without being text: a space, a tab, or
/// the carriage return of a CRLF line end.
pub(crate) fn is_blank(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r')
}

/// Whether a slot holds nothing but blanks and line ends: a statement emptied there.
pub(crate) fn blank_slot(bytes: &[u8]) -> bool {
    bytes.iter().all(|&b| is_blank(b) || b == b'\n')
}
