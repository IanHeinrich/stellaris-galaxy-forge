//! Index and document invariants on the sample saves.
use std::borrow::Cow;

use sgf_core::archive;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::scan::{Value, key_name};
use sgf_core::validate::{Severity, validate};

use crate::common;
use common::{load, load_3_4, load_4_5};

/// Each sample save, with the version and date its meta holds and how many issues the
/// validator raises on it, none of them an error.
#[test]
fn each_sample_is_partitioned_with_no_residue_and_saves_back_byte_for_byte() {
    let dir = tempfile::tempdir().unwrap();
    for (doc, version, date, raised) in [
        (load(), "Pegasus v4.4.6", "2206.11.16", 3),
        (load_4_5(), "Cygnus v4.5.0", "2201.03.25", 3),
        (load_3_4(), "Cepheus v3.4.5", "2200.04.11", 3),
    ] {
        let gaps = doc.index().coverage_gaps(doc.original());
        assert!(gaps.is_empty(), "{version}: non-whitespace gaps: {gaps:?}");

        let mut pos = 0;
        let mut worst: (usize, Cow<str>) = (0, Cow::Borrowed("start of file"));
        for s in doc.index().sections() {
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
            "{version}: covered {covered} of {total}; largest gap {} bytes before {}",
            worst.0,
            worst.1
        );

        let joined: Vec<u8> = doc.pieces().flatten().copied().collect();
        assert_eq!(joined, doc.original(), "{version}");
        let path = dir.path().join(format!("{date}.sav"));
        doc.save_as(&path).expect("save_as");
        let written = archive::read_sav(&path).expect("read back");
        assert_eq!(written.gamestate, doc.original(), "{version}");
        assert_eq!(written.meta, doc.meta(), "{version}");
        let meta = archive::parse_meta(doc.meta()).expect("meta header");
        assert_eq!((meta.version.as_str(), meta.date.as_str()), (version, date));

        let issues = validate(&GalaxyGraph::build(&doc).expect("build galaxy"));
        assert!(
            issues.iter().all(|i| i.severity != Severity::Error),
            "{version}: {issues:#?}"
        );
        assert_eq!(issues.len(), raised, "{version}: {issues:#?}");
    }
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
