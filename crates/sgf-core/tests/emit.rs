//! Emitted text against the file's own style: every coordinate in the sample re-emits
//! unchanged, a hyperlane block reproduces the fixture byte-for-byte, and a replaced
//! entity streams out in place.

use std::path::Path;

use sgf_core::cst::{self, Node, Value};
use sgf_core::emit::{coord, hyperlane_block, lane_entry};
use sgf_core::scan;

mod common;

#[test]
fn coord_matches_the_games_style() {
    for (value, text) in [
        (-333.0, "-333"),
        (-144.22, "-144.22"),
        (-339.74518, "-339.74518"),
        (0.0, "0"),
        (-0.0, "0"),
        (-0.000001, "0"),
        (0.000004, "0"),
        (10.0, "10"),
        (100.5, "100.5"),
        (1.23456789, "1.23457"),
        (499.9288, "499.9288"),
    ] {
        assert_eq!(coord(value), text, "{value}");
    }
}

/// Every `x=`/`y=` scalar anywhere inside `node`, as written.
fn xy_scalars<'a>(node: &Node, src: &'a [u8], out: &mut Vec<&'a str>) {
    for child in node.children() {
        match child.key_str(src) {
            Some("x" | "y") => {
                if let Some(text) = child.scalar_str(src) {
                    out.push(text);
                }
            }
            _ => xy_scalars(child, src, out),
        }
    }
}

#[test]
fn every_system_coordinate_in_the_sample_re_emits_unchanged() {
    let gamestate = common::gamestate();
    let src = gamestate.as_slice();
    let index = scan::scan(src).expect("scan sample");
    let mut seen = 0;
    for entity in index.entities("galactic_object") {
        let root = cst::parse(entity.stmt.slice(src), entity.stmt.start).expect("parse entity");
        let mut texts = Vec::new();
        xy_scalars(&root, src, &mut texts);
        for text in texts {
            let value: f64 = text.parse().unwrap_or_else(|e| panic!("{text}: {e}"));
            assert_eq!(coord(value), text, "system {}", entity.id);
            seen += 1;
        }
    }
    assert!(seen >= 2 * 791, "only {seen} coordinates seen");
}

#[test]
fn hyperlane_block_reproduces_the_fixture() {
    let fixture = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hyperlane_block.txt"),
    )
    .expect("read fixture");
    let key_indent = cst::indent_of(&fixture, 0);
    assert_eq!(key_indent, b"\t\t");
    let entry_indent = [key_indent, b"\t"].concat();

    let mut entries = lane_entry(&entry_indent, 752, 33, false);
    entries.extend(lane_entry(&entry_indent, 200, 27, true));
    let block = hyperlane_block(key_indent, &entries);

    assert_eq!(
        String::from_utf8_lossy(&block),
        String::from_utf8_lossy(&fixture)
    );
    assert_eq!(block, fixture);

    let root = cst::parse(&block, 0).expect("emitted block parses");
    let Value::Block { children, .. } = &root.children()[0].value else {
        panic!("hyperlane is a block");
    };
    assert_eq!(children.len(), 2);
    assert_eq!(
        children[1]
            .find("bridge", &block)
            .and_then(|n| n.scalar_str(&block)),
        Some("yes")
    );
}

#[test]
fn replacing_a_system_streams_it_in_place() {
    let mut doc = common::load();
    let original = doc.original().to_vec();
    let span = doc
        .index()
        .entity("galactic_object", 0)
        .expect("system 0")
        .stmt;
    let bytes = doc.current(span).expect("system 0 bytes").to_vec();
    assert!(
        bytes.starts_with(b"0="),
        "{:?}",
        String::from_utf8_lossy(&bytes[..16])
    );

    assert!(!doc.is_dirty());
    assert_eq!(doc.replace(span, bytes.clone()), Ok(None));
    assert!(doc.is_dirty());
    let joined: Vec<u8> = doc.pieces().flatten().copied().collect();
    assert_eq!(joined, original);

    let modified = [&bytes[..bytes.len() - 1], b"\tflags={ sgf_touched=1 }\n}"].concat();
    assert_eq!(doc.replace(span, modified.clone()), Ok(Some(bytes.clone())));
    assert_eq!(doc.current(span), Ok(modified.as_slice()));
    let joined: Vec<u8> = doc.pieces().flatten().copied().collect();
    assert_eq!(joined.len(), original.len() - span.len() + modified.len());
    assert_eq!(&joined[..span.start], &original[..span.start]);
    assert_eq!(
        &joined[span.start..span.start + modified.len()],
        modified.as_slice()
    );
    assert_eq!(
        &joined[span.start + modified.len()..],
        &original[span.end..]
    );

    doc.restore(span, Some(bytes));
    doc.restore(span, None);
    assert!(!doc.is_dirty());
    let joined: Vec<u8> = doc.pieces().flatten().copied().collect();
    assert_eq!(joined, original);
}
