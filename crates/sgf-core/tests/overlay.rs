//! The patch overlay against a naive model: random originals, random spans (empty ones
//! included), random insert offsets (0 and `len` included), random
//! `replace`/`insert`/`restore` sequences; invariants checked after every step.

use std::collections::BTreeMap;

use proptest::prelude::*;
use sgf_core::Span;
use sgf_core::overlay::{Anchor, Overlay, OverlayError};

/// What the overlay should hold: anchor → current bytes, sorted by `(start, seq)`.
type Model = Vec<(Anchor, Vec<u8>)>;

fn key(anchor: Anchor) -> (usize, u32) {
    match anchor {
        Anchor::Original(span) => (span.start, 0),
        Anchor::Inserted { at, seq } => (at, seq),
    }
}

fn model_get(model: &Model, anchor: Anchor) -> Option<&Vec<u8>> {
    model.iter().find(|(a, _)| *a == anchor).map(|(_, b)| b)
}

fn model_set(model: &mut Model, anchor: Anchor, bytes: Vec<u8>) -> Option<Vec<u8>> {
    match model.iter_mut().find(|(a, _)| *a == anchor) {
        Some((_, current)) => Some(std::mem::replace(current, bytes)),
        None => {
            model.push((anchor, bytes));
            model.sort_by_key(|(a, _)| key(*a));
            None
        }
    }
}

fn model_remove(model: &mut Model, anchor: Anchor) {
    model.retain(|(a, _)| *a != anchor);
}

fn originals(model: &Model) -> impl Iterator<Item = Span> + '_ {
    model.iter().filter_map(|(a, _)| match a {
        Anchor::Original(span) => Some(*span),
        Anchor::Inserted { .. } => None,
    })
}

fn inserts(model: &Model) -> impl Iterator<Item = usize> + '_ {
    model.iter().filter_map(|(a, _)| match a {
        Anchor::Inserted { at, .. } => Some(*at),
        Anchor::Original(_) => None,
    })
}

/// Byte by byte: a replacement starting at an offset, then the inserts there in seq
/// order, then the original byte unless a replacement covers it.
fn rebuild(model: &Model, orig: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut covered_until = 0;
    for at in 0..=orig.len() {
        for (anchor, bytes) in model {
            if anchor.start() == at {
                out.extend_from_slice(bytes);
                covered_until = covered_until.max(anchor.end());
            }
        }
        if at < orig.len() && at >= covered_until {
            out.push(orig[at]);
        }
    }
    out
}

fn joined(overlay: &Overlay, orig: &[u8]) -> Vec<u8> {
    overlay.pieces(orig).flatten().copied().collect()
}

fn intersects(a: Span, b: Span) -> bool {
    a.start == b.start || (a.start < b.end && b.start < a.end)
}

/// The original slot the model holds that `span` collides with without equalling: the
/// one sharing its start, else the last one starting inside it (the one `Overlay` reports).
fn model_overlap(model: &Model, span: Span) -> Option<Span> {
    let hits: Vec<Span> = originals(model)
        .filter(|s| *s != span && intersects(*s, span))
        .collect();
    hits.iter()
        .copied()
        .find(|s| s.start == span.start)
        .or_else(|| hits.last().copied())
}

/// Why `replace(Original(span))` would be refused, if it would.
fn original_refusal(model: &Model, span: Span) -> Option<OverlayError> {
    if let Some(slot) = model_overlap(model, span) {
        return Some(OverlayError::Overlaps { span, slot });
    }
    if span.is_empty() {
        return None;
    }
    inserts(model)
        .find(|&at| span.start <= at && at < span.end)
        .map(|at| OverlayError::InsertInsideSlot { at, slot: span })
}

/// Why an insert at `at` would be refused, if it would.
fn insert_refusal(model: &Model, at: usize) -> Option<OverlayError> {
    originals(model)
        .find(|s| (s.start < at && at < s.end) || (s.start == at && !s.is_empty()))
        .map(|slot| OverlayError::InsertInsideSlot { at, slot })
}

fn assert_invariants(overlay: &Overlay, model: &Model, orig: &[u8]) {
    let slots: Vec<(Anchor, &[u8])> = overlay.slots().collect();
    for w in slots.windows(2) {
        let (a, b) = (w[0].0, w[1].0);
        assert!(key(a) < key(b), "slots not sorted: {a:?} then {b:?}");
    }
    let spans: Vec<Span> = slots
        .iter()
        .filter_map(|(a, _)| match a {
            Anchor::Original(span) => Some(*span),
            Anchor::Inserted { .. } => None,
        })
        .collect();
    for w in spans.windows(2) {
        assert!(
            !intersects(w[0], w[1]),
            "slots intersect: {:?} and {:?}",
            w[0],
            w[1]
        );
    }
    for span in &spans {
        assert!(span.start <= span.end, "inverted slot {span:?}");
        assert!(
            span.end <= orig.len(),
            "slot {span:?} outside {} bytes",
            orig.len()
        );
    }
    for (anchor, _) in &slots {
        if let Anchor::Inserted { at, seq } = anchor {
            assert!(*seq >= 1, "insert {anchor:?} with seq 0");
            assert_eq!((anchor.start(), anchor.end()), (*at, *at));
            for span in &spans {
                assert!(
                    !(span.start < *at && *at < span.end)
                        && !(span.start == *at && !span.is_empty()),
                    "insert at {at} inside slot {span:?}"
                );
            }
        }
    }
    let expected: Vec<(Anchor, &[u8])> = model.iter().map(|(a, b)| (*a, b.as_slice())).collect();
    assert_eq!(slots, expected, "slots differ from the model");
    assert_eq!(overlay.is_empty(), model.is_empty());
    assert_eq!(joined(overlay, orig), rebuild(model, orig));
    for (anchor, bytes) in model {
        assert_eq!(overlay.current(*anchor, orig), Ok(bytes.as_slice()));
    }
}

#[derive(Clone, Debug)]
enum Action {
    Replace(Vec<u8>),
    RestoreSome(Vec<u8>),
    RestoreNone,
    Insert(Vec<u8>),
    EditInsert(Vec<u8>),
    RestoreInsertSome(Vec<u8>),
    RestoreInsertNone,
}

#[derive(Clone, Debug)]
struct Case {
    orig: Vec<u8>,
    spans: Vec<Span>,
    offsets: Vec<usize>,
    ops: Vec<(usize, Action)>,
}

fn span_in(len: usize) -> impl Strategy<Value = Span> {
    (0..=len, 0..=len).prop_map(|(a, b)| Span::new(a.min(b), a.max(b)))
}

fn offset_in(len: usize) -> impl Strategy<Value = usize> {
    prop_oneof![1 => Just(0), 1 => Just(len), 4 => 0..=len]
}

fn action() -> impl Strategy<Value = Action> {
    let bytes = prop::collection::vec(any::<u8>(), 0..12);
    prop_oneof![
        3 => bytes.clone().prop_map(Action::Replace),
        1 => bytes.clone().prop_map(Action::RestoreSome),
        1 => Just(Action::RestoreNone),
        3 => bytes.clone().prop_map(Action::Insert),
        2 => bytes.clone().prop_map(Action::EditInsert),
        1 => bytes.prop_map(Action::RestoreInsertSome),
        1 => Just(Action::RestoreInsertNone),
    ]
}

fn case() -> impl Strategy<Value = Case> {
    prop::collection::vec(any::<u8>(), 0..200).prop_flat_map(|orig| {
        let len = orig.len();
        (
            Just(orig),
            prop::collection::vec(span_in(len), 1..8),
            prop::collection::vec(offset_in(len), 1..6),
            prop::collection::vec((0..8usize, action()), 0..40),
        )
            .prop_map(|(orig, spans, offsets, ops)| Case {
                orig,
                spans,
                offsets,
                ops,
            })
    })
}

proptest! {
    #[test]
    fn pieces_match_a_naive_model(case in case()) {
        let Case { orig, spans, offsets, ops } = case;
        let mut overlay = Overlay::new();
        let mut model = Model::new();
        let mut next_seq: BTreeMap<usize, u32> = BTreeMap::new();
        let mut inserted: Vec<Anchor> = Vec::new();
        assert_invariants(&overlay, &model, &orig);

        for (i, action) in ops {
            let span = spans[i % spans.len()];
            let at = offsets[i % offsets.len()];
            let insert = inserted.get(i % inserted.len().max(1)).copied();
            match action {
                Action::Replace(bytes) => {
                    let result = overlay.replace(span, bytes.clone());
                    match original_refusal(&model, span) {
                        Some(err) => {
                            prop_assert_eq!(result, Err(err.clone()));
                            prop_assert_eq!(overlay.current(span, &orig), Err(err));
                        }
                        None => {
                            let prev = model_set(&mut model, span.into(), bytes);
                            prop_assert_eq!(result, Ok(prev));
                        }
                    }
                }
                // `restore` presumes `prev` came from an earlier `replace` on `span`; only
                // issue it where that could have been true.
                Action::RestoreSome(bytes) => {
                    if original_refusal(&model, span).is_none() {
                        overlay.restore(span, Some(bytes.clone()));
                        model_set(&mut model, span.into(), bytes);
                    }
                }
                Action::RestoreNone => {
                    if original_refusal(&model, span).is_none() {
                        overlay.restore(span, None);
                        model_remove(&mut model, span.into());
                    }
                }
                Action::Insert(bytes) => {
                    let result = overlay.insert(at, bytes.clone());
                    match insert_refusal(&model, at) {
                        Some(err) => prop_assert_eq!(result, Err(err)),
                        None => {
                            let seq = next_seq.entry(at).or_default();
                            *seq += 1;
                            let anchor = Anchor::Inserted { at, seq: *seq };
                            prop_assert_eq!(result, Ok(anchor));
                            model_set(&mut model, anchor, bytes);
                            inserted.push(anchor);
                        }
                    }
                }
                Action::EditInsert(bytes) => {
                    if let Some(anchor) = insert {
                        let result = overlay.replace(anchor, bytes.clone());
                        let Anchor::Inserted { at, .. } = anchor else { unreachable!() };
                        match (model_get(&model, anchor).is_some(), insert_refusal(&model, at)) {
                            (false, Some(err)) => {
                                prop_assert_eq!(result, Err(err));
                                prop_assert_eq!(
                                    overlay.current(anchor, &orig),
                                    Err(OverlayError::MissingInsert { at, seq: key(anchor).1 })
                                );
                            }
                            _ => {
                                let prev = model_set(&mut model, anchor, bytes);
                                prop_assert_eq!(result, Ok(prev));
                            }
                        }
                    }
                }
                Action::RestoreInsertSome(bytes) => {
                    if let Some(anchor) = insert {
                        let Anchor::Inserted { at, .. } = anchor else { unreachable!() };
                        if insert_refusal(&model, at).is_none() {
                            overlay.restore(anchor, Some(bytes.clone()));
                            model_set(&mut model, anchor, bytes);
                        }
                    }
                }
                Action::RestoreInsertNone => {
                    if let Some(anchor) = insert {
                        overlay.restore(anchor, None);
                        model_remove(&mut model, anchor);
                    }
                }
            }
            assert_invariants(&overlay, &model, &orig);
        }

        // Untouched spans read through to the original; removed inserts are missing.
        for span in &spans {
            if model_get(&model, (*span).into()).is_none() && original_refusal(&model, *span).is_none() {
                prop_assert_eq!(overlay.current(*span, &orig), Ok(span.slice(&orig)));
            }
        }
        for anchor in inserted {
            if model_get(&model, anchor).is_none() {
                let Anchor::Inserted { at, seq } = anchor else { unreachable!() };
                prop_assert_eq!(
                    overlay.current(anchor, &orig),
                    Err(OverlayError::MissingInsert { at, seq })
                );
            }
        }
    }
}

const ORIG: &[u8] = b"0123456789";

#[test]
fn exact_span_reads_the_replacement() {
    let mut overlay = Overlay::new();
    let span = Span::new(2, 5);
    assert_eq!(overlay.current(span, ORIG), Ok(&b"234"[..]));
    assert_eq!(overlay.replace(span, b"ab".to_vec()), Ok(None));
    assert_eq!(overlay.current(span, ORIG), Ok(&b"ab"[..]));
    assert_eq!(
        overlay.replace(span, b"xyz".to_vec()),
        Ok(Some(b"ab".to_vec()))
    );
    assert_eq!(joined(&overlay, ORIG), b"01xyz56789");
    assert_eq!(
        overlay.slots().collect::<Vec<_>>(),
        vec![(Anchor::Original(span), &b"xyz"[..])]
    );
}

#[test]
fn overlapping_replace_is_an_error() {
    let mut overlay = Overlay::new();
    let slot = Span::new(2, 5);
    overlay.replace(slot, b"ab".to_vec()).unwrap();
    for span in [
        Span::new(0, 3),
        Span::new(3, 4),
        Span::new(4, 8),
        Span::new(2, 4),
        Span::new(2, 8),
        Span::new(0, 10),
        Span::new(3, 3),
        Span::new(2, 2),
    ] {
        assert_eq!(
            overlay.replace(span, b"no".to_vec()),
            Err(OverlayError::Overlaps { span, slot }),
            "{span:?}"
        );
        assert_eq!(
            overlay.current(span, ORIG),
            Err(OverlayError::Overlaps { span, slot }),
            "{span:?}"
        );
    }
    for span in [
        Span::new(0, 2),
        Span::new(5, 7),
        Span::new(5, 5),
        Span::new(0, 0),
    ] {
        assert_eq!(
            overlay.current(span, ORIG),
            Ok(span.slice(ORIG)),
            "{span:?}"
        );
    }
    assert_eq!(joined(&overlay, ORIG), b"01ab56789");
    assert_eq!(
        overlay.current(Span::new(8, 11), ORIG),
        Err(OverlayError::OutOfBounds {
            span: Span::new(8, 11),
            len: 10
        })
    );
}

#[test]
fn restore_none_returns_to_the_original() {
    let mut overlay = Overlay::new();
    let span = Span::new(4, 6);
    let prev = overlay.replace(span, b"XYZ".to_vec()).unwrap();
    assert!(!overlay.is_empty());
    assert_eq!(joined(&overlay, ORIG), b"0123XYZ6789");
    overlay.restore(span, prev);
    assert!(overlay.is_empty());
    assert_eq!(overlay.pieces(ORIG).collect::<Vec<_>>(), vec![ORIG]);

    let first = overlay.replace(span, b"a".to_vec()).unwrap();
    let second = overlay.replace(span, b"b".to_vec()).unwrap();
    overlay.restore(span, second);
    assert_eq!(joined(&overlay, ORIG), b"0123a6789");
    overlay.restore(span, first);
    assert_eq!(joined(&overlay, ORIG), ORIG);
}

#[test]
fn insertions_at_both_ends() {
    let mut overlay = Overlay::new();
    let head = Span::new(0, 0);
    let tail = Span::new(ORIG.len(), ORIG.len());
    assert_eq!(overlay.replace(head, b"<<".to_vec()), Ok(None));
    assert_eq!(overlay.replace(tail, b">>".to_vec()), Ok(None));
    assert_eq!(joined(&overlay, ORIG), b"<<0123456789>>");
    assert_eq!(overlay.current(head, ORIG), Ok(&b"<<"[..]));
    assert_eq!(overlay.current(tail, ORIG), Ok(&b">>"[..]));
    assert_eq!(overlay.current(Span::new(1, 9), ORIG), Ok(&b"12345678"[..]));
    // A span sharing the head slot's start collides with it, even though the slot is empty.
    assert_eq!(
        overlay.current(Span::new(0, 10), ORIG),
        Err(OverlayError::Overlaps {
            span: Span::new(0, 10),
            slot: head
        })
    );

    let mut deletion = Overlay::new();
    deletion.replace(Span::new(0, 10), Vec::new()).unwrap();
    assert_eq!(joined(&deletion, ORIG), b"");
}

#[test]
fn inserts_are_emitted_after_the_slot_at_their_offset() {
    let mut overlay = Overlay::new();
    overlay.replace(Span::new(2, 5), b"ab".to_vec()).unwrap();
    overlay.replace(Span::new(7, 7), b"_".to_vec()).unwrap();
    let a = overlay.insert(5, b"X".to_vec()).unwrap();
    let b = overlay.insert(5, b"Y".to_vec()).unwrap();
    let head = overlay.insert(0, b"<".to_vec()).unwrap();
    let tail = overlay.insert(ORIG.len(), b">".to_vec()).unwrap();
    let after_empty = overlay.insert(7, b"^".to_vec()).unwrap();
    assert_eq!(a, Anchor::Inserted { at: 5, seq: 1 });
    assert_eq!(b, Anchor::Inserted { at: 5, seq: 2 });
    assert_eq!((a.start(), a.end(), a.is_inserted()), (5, 5, true));
    assert_eq!(joined(&overlay, ORIG), b"<01abXY56_^789>");
    assert_eq!(
        overlay
            .slots()
            .map(|(anchor, _)| anchor)
            .collect::<Vec<_>>(),
        vec![
            head,
            Anchor::Original(Span::new(2, 5)),
            a,
            b,
            Anchor::Original(Span::new(7, 7)),
            after_empty,
            tail
        ]
    );
    assert_eq!(overlay.current(Span::new(6, 7), ORIG), Ok(&b"6"[..]));
    assert_eq!(
        overlay.current(Span::new(5, 7), ORIG),
        Err(OverlayError::InsertInsideSlot {
            at: 5,
            slot: Span::new(5, 7)
        })
    );
    assert_eq!(overlay.current(b, ORIG), Ok(&b"Y"[..]));
}

#[test]
fn inserted_slot_edit_undo_and_redo() {
    let mut overlay = Overlay::new();
    let anchor = overlay.insert(4, b"new".to_vec()).unwrap();
    assert_eq!(anchor, Anchor::Inserted { at: 4, seq: 1 });
    assert_eq!(joined(&overlay, ORIG), b"0123new456789");

    let prev = overlay.replace(anchor, b"edited".to_vec()).unwrap();
    assert_eq!(prev, Some(b"new".to_vec()));
    assert_eq!(overlay.current(anchor, ORIG), Ok(&b"edited"[..]));

    overlay.restore(anchor, prev);
    assert_eq!(overlay.current(anchor, ORIG), Ok(&b"new"[..]));

    overlay.restore(anchor, None);
    assert!(overlay.is_empty());
    assert_eq!(
        overlay.current(anchor, ORIG),
        Err(OverlayError::MissingInsert { at: 4, seq: 1 })
    );
    assert_eq!(overlay.pieces(ORIG).collect::<Vec<_>>(), vec![ORIG]);

    assert_eq!(overlay.replace(anchor, b"new".to_vec()), Ok(None));
    assert_eq!(joined(&overlay, ORIG), b"0123new456789");
    assert_eq!(
        overlay.slots().collect::<Vec<_>>(),
        vec![(anchor, &b"new"[..])]
    );
}

#[test]
fn inserts_and_replacements_refuse_to_swallow_each_other() {
    let mut overlay = Overlay::new();
    let slot = Span::new(2, 5);
    overlay.replace(slot, b"ab".to_vec()).unwrap();
    for at in [2, 3, 4] {
        assert_eq!(
            overlay.insert(at, b"no".to_vec()),
            Err(OverlayError::InsertInsideSlot { at, slot }),
            "{at}"
        );
        assert_eq!(
            overlay.replace(Anchor::Inserted { at, seq: 1 }, b"no".to_vec()),
            Err(OverlayError::InsertInsideSlot { at, slot }),
            "{at}"
        );
    }
    let after = overlay.insert(5, b"X".to_vec()).unwrap();
    assert_eq!(joined(&overlay, ORIG), b"01abX56789");

    for span in [Span::new(5, 7), Span::new(4, 8), Span::new(0, 10)] {
        let err = if span.start < slot.end && slot.start < span.end {
            OverlayError::Overlaps { span, slot }
        } else {
            OverlayError::InsertInsideSlot { at: 5, slot: span }
        };
        assert_eq!(
            overlay.replace(span, b"no".to_vec()),
            Err(err.clone()),
            "{span:?}"
        );
        assert_eq!(overlay.current(span, ORIG), Err(err), "{span:?}");
    }
    assert_eq!(overlay.current(Span::new(5, 5), ORIG), Ok(&b""[..]));
    assert_eq!(overlay.replace(Span::new(5, 5), b"_".to_vec()), Ok(None));
    assert_eq!(joined(&overlay, ORIG), b"01ab_X56789");
    overlay.restore(after, None);
    assert_eq!(joined(&overlay, ORIG), b"01ab_56789");
}

#[test]
fn seq_counts_up_per_offset_and_is_never_reused() {
    let mut overlay = Overlay::new();
    let first = overlay.insert(3, b"a".to_vec()).unwrap();
    let second = overlay.insert(3, b"b".to_vec()).unwrap();
    let elsewhere = overlay.insert(6, b"c".to_vec()).unwrap();
    assert_eq!(first, Anchor::Inserted { at: 3, seq: 1 });
    assert_eq!(second, Anchor::Inserted { at: 3, seq: 2 });
    assert_eq!(elsewhere, Anchor::Inserted { at: 6, seq: 1 });
    overlay.restore(second, None);
    assert_eq!(
        overlay.insert(3, b"d".to_vec()),
        Ok(Anchor::Inserted { at: 3, seq: 3 })
    );
    assert_eq!(joined(&overlay, ORIG), b"012ad345c6789");

    let mut replayed = Overlay::new();
    assert_eq!(
        replayed.replace(Anchor::Inserted { at: 3, seq: 5 }, b"e".to_vec()),
        Ok(None)
    );
    assert_eq!(
        replayed.insert(3, b"f".to_vec()),
        Ok(Anchor::Inserted { at: 3, seq: 6 })
    );
}

#[test]
fn insert_then_restore_is_byte_identical() {
    let mut overlay = Overlay::new();
    let head = overlay.insert(0, b"<".to_vec()).unwrap();
    let mid = overlay.insert(5, b"X".to_vec()).unwrap();
    let tail = overlay.insert(ORIG.len(), b">".to_vec()).unwrap();
    assert!(!overlay.is_empty());
    for anchor in [mid, head, tail] {
        overlay.restore(anchor, None);
    }
    assert!(overlay.is_empty());
    assert_eq!(overlay.pieces(ORIG).collect::<Vec<_>>(), vec![ORIG]);
}
