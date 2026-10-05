//! CST node lookups, scalars, malformed input and script-mode parsing on the format
//! quirks (`tests/fixtures/`).

use std::path::Path;

use sgf_core::Span;
use sgf_core::cst::{self, Node};

fn read_fixture(name: &str) -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read(path).unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[test]
fn node_helpers_on_hyperlane_block() {
    let src = read_fixture("hyperlane_block.txt");
    let root = cst::parse(&src, 0).expect("parse");
    let hyperlane = root.find("hyperlane", &src).expect("hyperlane");
    assert_eq!(hyperlane.key_str(&src), Some("hyperlane"));
    assert!(hyperlane.scalar_span().is_none());
    let entries: Vec<&Node> = hyperlane.children().iter().collect();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|e| e.key.is_none()));
    let to: Vec<&str> = entries
        .iter()
        .filter_map(|e| e.find("to", &src)?.scalar_str(&src))
        .collect();
    assert_eq!(to, ["752", "200"]);
    assert!(entries[0].find("bridge", &src).is_none());
    assert_eq!(
        entries[1]
            .find("bridge", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("yes")
    );
    assert_eq!(root.find_all("hyperlane", &src).count(), 1);
    assert_eq!(root.find("missing", &src), None);

    let length = entries[1].find("length", &src).expect("length");
    let stmt = length.span();
    assert_eq!(stmt.slice(&src), b"length=27");
    assert_eq!(cst::indent_of(&src, stmt.start), b"\t\t\t\t");
    assert_eq!(cst::line_start(&src, stmt.start), stmt.start - 4);
    assert_eq!(cst::line_end(&src, stmt.start), stmt.end + 1);
    assert_eq!(
        &src[cst::line_start(&src, stmt.start)..cst::line_end(&src, stmt.start)],
        b"\t\t\t\tlength=27\n"
    );
    assert_eq!(cst::line_end(&src, src.len()), src.len());
    assert_eq!(cst::line_start(&src, 0), 0);
    assert_eq!(cst::indent_of(&src, 0), b"\t\t");
}

#[test]
fn quoted_and_empty_scalars() {
    let src = read_fixture("quoted_key.txt");
    let root = cst::parse(&src, 0).expect("parse");
    let node = root
        .find("tech_lasers_1", &src)
        .expect("quoted key matches unquoted lookup");
    assert_eq!(
        node.key.map(|k| k.slice(&src)),
        Some(&b"\"tech_lasers_1\""[..])
    );
    assert_eq!(node.scalar_str(&src), Some("1"));
    assert_eq!(
        node.scalar_span().map(|s| s.slice(&src)),
        Some(&b"\"1\""[..])
    );

    let src = read_fixture("empty_value.txt");
    let root = cst::parse(&src, 0).expect("parse");
    let key = root
        .find("entry", &src)
        .and_then(|e| e.find("key", &src))
        .expect("key");
    let span = key.scalar_span().expect("scalar");
    assert!(span.is_empty());
    assert_eq!(
        src[span.start - 1],
        b'=',
        "empty value sits right after '='"
    );
    assert_eq!(key.scalar_str(&src), Some(""));
    assert_eq!(key.span().slice(&src), b"key=");
}

#[test]
fn malformed_input_is_an_error() {
    let cases: [(&[u8], usize, &str); 5] = [
        (b"a=1 }", 4, "unbalanced '}'"),
        (b"a={ b=1", 2, "unclosed '{'"),
        (b"=1", 0, "'=' without a key"),
        (b"a==1", 2, "'=' after '='"),
        (b"{ x=1 } }", 8, "unbalanced '}'"),
    ];
    for (src, offset, reason) in cases {
        let err = cst::parse(src, 10).expect_err("must fail");
        assert_eq!(
            (err.offset, err.reason),
            (offset + 10, reason),
            "{:?}",
            String::from_utf8_lossy(src)
        );
    }
    assert_eq!(
        cst::parse(b"", 5).expect("empty is fine").span(),
        Span::new(5, 5)
    );
}

#[test]
fn script_comments_are_skipped() {
    let src = read_fixture("script_comments.txt");
    let root = cst::parse_script(&src, 0).expect("parse_script");
    assert_eq!(
        root.find("key", &src).and_then(|n| n.scalar_str(&src)),
        Some("value")
    );
    assert_eq!(
        root.find("quoted", &src).and_then(|n| n.scalar_str(&src)),
        Some("has # inside")
    );
    assert_eq!(root.children().len(), 2, "comments must not become nodes");

    // Save mode has no notion of comments: '#' is an ordinary scalar
    // character, so the "comment" text ends up in the tree as scalars.
    let saved = cst::parse(&src, 0).expect("parse");
    assert!(
        saved
            .children()
            .iter()
            .any(|c| c.scalar_str(&src) == Some("#")),
        "save-mode parse must not strip '#' as a comment"
    );
}

#[test]
fn script_comparison_operators_act_like_eq() {
    let src = read_fixture("script_ops.txt");
    let root = cst::parse_script(&src, 0).expect("parse_script");
    let modifier = root.find("modifier", &src).expect("modifier");
    assert_eq!(
        modifier
            .find("factor", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("0")
    );
    assert_eq!(
        modifier
            .find("num_systems", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("200")
    );
    assert_eq!(
        modifier
            .find("weight", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("5")
    );
    assert_eq!(
        modifier
            .find("species", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("ROBOT")
    );
    assert_eq!(
        modifier
            .find("has_flag", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("yes")
    );
}

#[test]
fn script_variables_are_plain_scalars() {
    let src = read_fixture("script_vars.txt");
    let root = cst::parse_script(&src, 0).expect("parse_script");
    assert_eq!(
        root.find("@planet_standard_scale", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("11")
    );
    assert_eq!(
        root.find("entity_scale", &src)
            .and_then(|n| n.scalar_str(&src)),
        Some("@planet_standard_scale")
    );
}

#[test]
fn script_hsv_and_rgb_become_keyed_blocks() {
    let src = read_fixture("script_colors.txt");
    let root = cst::parse_script(&src, 0).expect("parse_script");

    let color = root.find("color", &src).expect("color");
    let hsv = color.find("hsv", &src).expect("color's value is hsv={...}");
    assert_eq!(hsv.children().len(), 3);
    let hsv_values: Vec<&str> = hsv
        .children()
        .iter()
        .filter_map(|c| c.scalar_str(&src))
        .collect();
    assert_eq!(hsv_values, ["0.5", "0.4", "0.9"]);

    let c = root.find("c", &src).expect("c");
    let rgb = c.find("rgb", &src).expect("c's value is rgb={...}");
    let rgb_values: Vec<&str> = rgb
        .children()
        .iter()
        .filter_map(|c| c.scalar_str(&src))
        .collect();
    assert_eq!(rgb_values, ["22", "35", "102"]);
}

#[test]
fn script_bom_and_crlf_are_skipped() {
    // *.txt is forced LF by .gitattributes, so the CRLF bytes are built
    // here rather than committed as a fixture file.
    let mut src = vec![0xEF, 0xBB, 0xBF];
    src.extend_from_slice(b"# a comment\r\nkey = value\r\n");

    let root = cst::parse_script(&src, 0).expect("parse_script");
    assert_eq!(root.children().len(), 1);
    let key = root.find("key", &src).expect("key");
    assert_eq!(key.scalar_str(&src), Some("value"));
}
