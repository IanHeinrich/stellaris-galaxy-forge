//! The patch overlay on hand-picked cases: overlapping spans, restores, insertions at the
//! ends and beside a slot, and how insert sequence numbers count.

use sgf_core::Span;
use sgf_core::overlay::{Anchor, Overlay, OverlayError};

fn joined(overlay: &Overlay, orig: &[u8]) -> Vec<u8> {
    overlay.pieces(orig).flatten().copied().collect()
}

const ORIG: &[u8] = b"0123456789";

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
