//! Index and document invariants on the real sample save.
use std::borrow::Cow;

use sgf_core::archive;
use sgf_core::scan::{Value, key_name};

mod common;
use common::load;

#[test]
fn index_partitions_the_sample_with_no_residue() {
    let doc = load();
    let gaps = doc.index().coverage_gaps(doc.original());
    assert!(gaps.is_empty(), "non-whitespace gaps: {gaps:?}");

    let sections = doc.index().sections();
    let mut pos = 0;
    let mut worst: (usize, Cow<str>) = (0, Cow::Borrowed("start of file"));
    for s in sections {
        let gap = s.stmt.start - pos;
        if gap > worst.0 {
            worst = (gap, key_name(doc.original(), s));
        }
        pos = s.stmt.end;
    }
    let trailing = doc.original().len() - pos;
    if trailing > worst.0 {
        worst = (trailing, Cow::Borrowed("end of file"));
    }

    let covered: usize = doc.section_sizes().iter().map(|(_, n)| n).sum();
    let total = doc.original().len();
    assert!(
        covered * 1000 >= total * 999,
        "covered {covered} of {total}; largest gap {} bytes before {}",
        worst.0,
        worst.1
    );
}

#[test]
fn galaxy_sections_match_the_measured_facts() {
    let doc = load();
    let index = doc.index();

    let ids: Vec<u64> = index
        .entities("galactic_object")
        .iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(ids.len(), 791);
    assert_eq!(ids, (0..=790).collect::<Vec<u64>>());
    assert!(index.entity("galactic_object", 790).is_some());
    assert!(index.entity("galactic_object", 791).is_none());

    assert_eq!(index.sections_named("nebula").count(), 9);

    let Some(Value::Scalar(span)) = index.section("galaxy_radius").map(|s| s.value) else {
        panic!("galaxy_radius should be a scalar");
    };
    let radius: f64 = std::str::from_utf8(span.slice(doc.original()))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(radius, 499.9288);
}

#[test]
fn pieces_stream_the_original_unchanged() {
    let doc = load();
    let joined: Vec<u8> = doc.pieces().flatten().copied().collect();
    assert_eq!(joined, doc.original());
}

#[test]
fn save_as_with_reports_progress_and_stays_byte_identical() {
    let doc = load();
    let dir = tempfile::tempdir().unwrap();
    let plain = dir.path().join("plain.sav");
    let reported = dir.path().join("reported.sav");
    doc.save_as(&plain).expect("save_as");

    let mut fractions = Vec::new();
    doc.save_as_with(&reported, |f| fractions.push(f))
        .expect("save_as_with");
    assert!(fractions.len() > 1, "{fractions:?}");
    assert!(
        fractions.windows(2).all(|p| p[0] <= p[1]),
        "not monotonic: {fractions:?}"
    );
    assert!(
        fractions.iter().all(|f| (0.0..=1.0).contains(f)),
        "{fractions:?}"
    );
    assert_eq!(fractions.last(), Some(&1.0));

    assert_eq!(
        std::fs::read(&reported).unwrap(),
        std::fs::read(&plain).unwrap(),
        "progress reporting changes the archive"
    );
    let written = archive::read_sav(&reported).expect("read back");
    assert_eq!(written.gamestate, doc.original());
    assert_eq!(written.meta, doc.meta());
}
