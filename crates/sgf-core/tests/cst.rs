//! Lexer/CST trees on the format quirks (`tests/fixtures/`) and on the whole sample save.

use std::path::{Path, PathBuf};
use std::time::Instant;

use sgf_core::Span;
use sgf_core::cst::{self, Node, Value};
use sgf_core::lexer::{self, TokenKind};

use crate::common;

const FIXTURES: &[(&str, &str)] = &[
    (
        "multi_pair_line.txt",
        "modules={\n  0=shipyard\n  1=solar_panel_network\n}\n",
    ),
    (
        "tabs_after_eq.txt",
        "last_bombardment=\\t\\t\\t\"0.01.01\"\n",
    ),
    (
        "block_next_line.txt",
        "coordinate={\n  x=-144.22\n  y=57.36\n  origin=4294967295\n}\n",
    ),
    ("inline_block.txt", "random={\n  0\n  3366986288\n}\n"),
    (
        "quoted_key.txt",
        "\"tech_lasers_1\"=\"1\"\n\"tech_industrial_storm_protection\"=\"1\"\n",
    ),
    (
        "mixed_list.txt",
        "intel={\n  {\n    24\n    {\n      intel=0\n      stale_intel={\n      }\n    }\n  }\n}\n",
    ),
    (
        "scalar_list_trailing_space.txt",
        "ambient_object={\n  54\n  55\n  56\n  57\n}\n",
    ),
    (
        "column0_key.txt",
        "a={\n  b={\n    21={\n      num_pops=9400\n    }\n    22={\n      num_pops=9400\n    }\n  }\n}\n",
    ),
    ("empty_block.txt", "stale_intel={\n}\n"),
    ("empty_value.txt", "entry={\n  key=\n}\n"),
    (
        "hyperlane_block.txt",
        "hyperlane={\n  {\n    to=752\n    length=33\n  }\n  {\n    to=200\n    length=27\n    bridge=yes\n  }\n}\n",
    ),
];

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn read_fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixture_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn text(span: Span, src: &[u8]) -> String {
    String::from_utf8_lossy(span.slice(src))
        .replace('\t', "\\t")
        .replace('\n', "\\n")
}

/// One line per node: a scalar statement re-sliced from `Node::span()`,
/// or `key={` ... `}` for a block, indented two spaces per depth.
fn dump(node: &Node, src: &[u8], depth: usize, out: &mut String) {
    for child in node.children() {
        let indent = "  ".repeat(depth);
        match &child.value {
            Value::Scalar(_) => {
                out.push_str(&indent);
                out.push_str(&text(child.span(), src));
                out.push('\n');
            }
            Value::Block { .. } => {
                out.push_str(&indent);
                if let Some(key) = child.key {
                    out.push_str(&text(key, src));
                    out.push('=');
                }
                out.push_str("{\n");
                dump(child, src, depth + 1, out);
                out.push_str(&indent);
                out.push_str("}\n");
            }
        }
    }
}

/// Structural facts that hold for every node regardless of the input.
fn check_invariants(node: &Node, src: &[u8], is_root: bool) {
    let stmt = node.span();
    if let Some(key) = node.key {
        assert!(!key.is_empty(), "key span is empty");
        assert!(
            stmt.slice(src).starts_with(key.slice(src)),
            "statement does not start with its key"
        );
        let between = &src[key.end..node.value_span().start];
        assert_eq!(
            between.iter().filter(|&&b| b == b'=').count(),
            1,
            "exactly one '=' between key and value"
        );
        assert!(
            between.iter().all(|b| b" \t\n\r=".contains(b)),
            "only whitespace around '='"
        );
    }
    match &node.value {
        Value::Scalar(span) => {
            let bytes = span.slice(src);
            if bytes.first() != Some(&b'"') {
                assert!(
                    bytes.iter().all(|b| !b" \t\n\r{}=\"".contains(b)),
                    "unquoted scalar contains a delimiter"
                );
            }
        }
        Value::Block {
            open,
            children,
            close,
        } => {
            if is_root {
                assert!(
                    open.is_empty() && close.is_empty(),
                    "root braces are synthetic"
                );
                assert_eq!(open.start, 0);
                assert_eq!(close.end, src.len());
            } else {
                assert_eq!(open.slice(src), b"{");
                assert_eq!(close.slice(src), b"}");
            }
            let mut cursor = open.end;
            for child in children {
                let child_span = child.span();
                assert!(
                    child_span.start >= cursor,
                    "children overlap or are out of order"
                );
                assert!(child_span.end <= close.start, "child escapes its block");
                cursor = child_span.end;
                check_invariants(child, src, false);
            }
        }
    }
}

/// Key, `=`, scalar and brace spans in file order: the CST's leaves. The
/// `=` is not stored on the node, so it is located between key and value.
fn leaves(node: &Node, src: &[u8], out: &mut Vec<Span>) {
    if let Some(key) = node.key {
        out.push(key);
        let eq = src[key.end..node.value_span().start]
            .iter()
            .position(|&b| b == b'=')
            .expect("'=' after key");
        out.push(Span::new(key.end + eq, key.end + eq + 1));
    }
    match &node.value {
        Value::Scalar(span) => out.push(*span),
        Value::Block {
            open,
            children,
            close,
        } => {
            out.push(*open);
            for child in children {
                leaves(child, src, out);
            }
            out.push(*close);
        }
    }
}

fn concat(spans: impl Iterator<Item = Span>, src: &[u8]) -> Vec<u8> {
    spans.flat_map(|s| s.slice(src).iter().copied()).collect()
}

/// `src` minus the whitespace between tokens; whitespace inside quotes stays.
fn without_whitespace(src: &[u8]) -> Vec<u8> {
    let mut in_quote = false;
    src.iter()
        .copied()
        .filter(|&b| {
            if b == b'"' {
                in_quote = !in_quote;
            }
            in_quote || !b" \t\n\r".contains(&b)
        })
        .collect()
}

/// Equality with a readable report: the first differing offset and a window around it.
fn assert_bytes_eq(got: &[u8], expected: &[u8], what: &str) {
    if got == expected {
        return;
    }
    let at = got
        .iter()
        .zip(expected)
        .position(|(a, b)| a != b)
        .unwrap_or(got.len().min(expected.len()));
    let window = |b: &[u8]| {
        String::from_utf8_lossy(&b[at.saturating_sub(20)..(at + 20).min(b.len())]).into_owned()
    };
    panic!(
        "{what} lose or duplicate bytes: first difference at {at} (got {} bytes, expected {}): {:?} vs {:?}",
        got.len(),
        expected.len(),
        window(got),
        window(expected)
    );
}

fn assert_nothing_lost(root: &Node, src: &[u8]) {
    let mut spans = Vec::new();
    leaves(root, src, &mut spans);
    let expected = without_whitespace(src);
    assert_bytes_eq(&concat(spans.into_iter(), src), &expected, "CST leaves");
    assert_bytes_eq(
        &concat(lexer::tokens(src, 0).map(|t| t.span), src),
        &expected,
        "lexer tokens",
    );
}

#[test]
fn fixtures_parse_to_expected_trees() {
    let listed: Vec<&str> = FIXTURES.iter().map(|(n, _)| *n).collect();
    // Script-mode fixtures (`script_*.txt`) are covered by their own tests,
    // parsed with `cst::parse_script`, not by this save-mode table.
    let mut on_disk: Vec<String> = std::fs::read_dir(fixture_dir())
        .expect("fixtures dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with("script_"))
        .collect();
    on_disk.sort();
    let mut expected = listed.clone();
    expected.sort_unstable();
    assert_eq!(
        on_disk, expected,
        "every fixture on disk must have an expected tree"
    );

    for (name, expected) in FIXTURES {
        let src = read_fixture(name);
        assert!(!src.contains(&b'\r'), "{name}: fixture has CR");
        let root = cst::parse(&src, 0).unwrap_or_else(|e| panic!("{name}: {e}"));

        let mut got = String::new();
        dump(&root, &src, 0, &mut got);
        assert_eq!(got, *expected, "{name}: tree differs");

        check_invariants(&root, &src, true);
        assert_nothing_lost(&root, &src);

        let first = src
            .iter()
            .position(|b| !b" \t\n".contains(b))
            .expect("non-empty fixture");
        let last = src
            .iter()
            .rposition(|b| !b" \t\n".contains(b))
            .expect("non-empty fixture");
        let children = root.children();
        assert_eq!(
            children.first().map(|c| c.span().start),
            Some(first),
            "{name}: first statement start"
        );
        assert_eq!(
            children.last().map(|c| c.span().end),
            Some(last + 1),
            "{name}: last statement end"
        );
    }
}

#[test]
fn fixtures_with_base_offset_report_absolute_spans() {
    let src = read_fixture("hyperlane_block.txt");
    let base = 1_000_000;
    let shifted = cst::parse(&src, base).expect("parse");
    let plain = cst::parse(&src, 0).expect("parse");
    assert_eq!(shifted, shift(&plain, base));
    assert_eq!(shifted.span(), Span::new(base, base + src.len()));
}

fn shift(node: &Node, base: usize) -> Node {
    Node {
        key: node.key.map(|k| k.offset(base)),
        value: match &node.value {
            Value::Scalar(span) => Value::Scalar(span.offset(base)),
            Value::Block {
                open,
                children,
                close,
            } => Value::Block {
                open: open.offset(base),
                children: children.iter().map(|c| shift(c, base)).collect(),
                close: close.offset(base),
            },
        },
    }
}

#[test]
fn whole_gamestate_parses() {
    let doc = common::load();
    let src = doc.original();
    assert_eq!(src.len(), 24_737_737);

    let started = Instant::now();
    let root = cst::parse(src, 0).expect("whole gamestate parses");
    let elapsed = started.elapsed();
    println!("parsed {} bytes in {elapsed:?}", src.len());

    assert_eq!(
        root.find("galaxy_radius", src)
            .and_then(|n| n.scalar_str(src)),
        Some("499.9288")
    );

    let systems = root
        .find("galactic_object", src)
        .expect("galactic_object section");
    assert_eq!(systems.children().len(), 791);
    for system in systems.children() {
        let id = system.key_str(src).expect("system id");
        let coordinate = system
            .find("coordinate", src)
            .unwrap_or_else(|| panic!("system {id}: no coordinate"));
        for axis in ["x", "y"] {
            let value = coordinate
                .find(axis, src)
                .and_then(|n| n.scalar_str(src))
                .unwrap_or_else(|| panic!("system {id}: no {axis}"));
            value
                .parse::<f64>()
                .unwrap_or_else(|e| panic!("system {id}: {axis}={value}: {e}"));
        }
    }

    let lane_entries: usize = systems
        .children()
        .iter()
        .filter_map(|s| s.find("hyperlane", src))
        .map(|h| h.children().len())
        .sum();
    assert_eq!(lane_entries, 2_188);

    assert_nothing_lost(&root, src);
    let scalars = lexer::tokens(src, 0)
        .filter(|t| matches!(t.kind, TokenKind::Scalar { .. }))
        .count();
    assert!(scalars > 1_000_000, "sample has {scalars} scalars");
}
