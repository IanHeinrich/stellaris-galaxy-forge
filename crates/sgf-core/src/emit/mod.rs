//! Text generation in the file's own style: pure functions, no I/O.
//!
//! The base indentation is copied: callers measure it from the entity the text is
//! inserted into (`cst::indent_of`) and pass it in. Depth below it is added in tabs, as
//! the game nests blocks.

pub mod system;

use crate::keys;

/// Decimals the game writes a coordinate with.
pub const COORD_DECIMALS: usize = 5;

/// A coordinate as the game writes it: up to five decimals, trailing zeros and a
/// trailing `.` stripped, `-0` written as `0` (`-333`, `-144.22`, `-339.74518`, `0`).
///
/// Non-finite values are a caller bug: ops reject them before they reach the emitter
/// (`"NaN"` and `"inf"` parse as `f64` from the command line and must never be written).
pub fn coord(v: f64) -> String {
    debug_assert!(v.is_finite(), "coord({v}) is not finite");
    let s = fixed(v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0" } else { s }.to_owned()
}

/// `text` between quotes, as the game writes a name or a key; nothing is escaped.
pub fn quoted(text: &str) -> String {
    format!("\"{text}\"")
}

/// `v` as it reads back once [`coord`] has written it.
pub fn rounded(v: f64) -> f64 {
    fixed(v).parse().unwrap_or(v)
}

fn fixed(v: f64) -> String {
    format!("{v:.decimals$}", decimals = COORD_DECIMALS)
}

/// What a new `nebula` section of a save holds.
#[derive(Debug, Clone, PartialEq)]
pub struct NebulaSection<'a> {
    /// The localisation key the `name` block carries, empty for an unnamed cloud.
    pub name: &'a str,
    /// `literal=yes`: `name` is shown as written rather than looked up.
    pub literal: bool,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    /// The member systems, ascending, as the game writes them.
    pub members: &'a [u32],
}

/// `randomized` and `visual_height` as the generator writes them on every cloud; a new
/// section copies them rather than inventing a shape the game has not been seen to write.
const NEBULA_RANDOMIZED: &str = "yes";
const NEBULA_VISUAL_HEIGHT: &str = "3.65056";

/// A whole `nebula={…}` section in the game's shape. `indent` is the `nebula` key's own
/// indentation; the section ends with the newline that separates it from what follows.
pub fn nebula_section(indent: &[u8], n: &NebulaSection<'_>) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, keys::NEBULA);
    w.open(1, keys::COORDINATE);
    w.pair(2, keys::X, &coord(n.x));
    w.pair(2, keys::Y, &coord(n.y));
    w.pair(2, keys::ORIGIN, &crate::NULL_ID.to_string());
    w.pair(2, keys::RANDOMIZED, NEBULA_RANDOMIZED);
    w.pair(2, keys::VISUAL_HEIGHT, NEBULA_VISUAL_HEIGHT);
    w.close(1);
    w.open(1, keys::NAME);
    w.pair(2, keys::KEY, &quoted(n.name));
    if n.literal {
        w.pair(2, keys::LITERAL, "yes");
    }
    w.close(1);
    w.pair(1, keys::RADIUS, &coord(n.radius));
    for &id in n.members {
        w.pair(1, keys::GALACTIC_OBJECT, &id.to_string());
    }
    w.close(0);
    w.into_bytes()
}

/// `n` in Roman numerals, as the game numbers a system's planets: `IV`.
pub fn roman(mut n: usize) -> String {
    const NUMERALS: [(usize, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (value, numeral) in NUMERALS {
        while n >= value {
            out.push_str(numeral);
            n -= value;
        }
    }
    out
}

/// A nebula's member line for system `id`.
pub fn member_line(indent: &[u8], id: u32) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.pair(0, keys::GALACTIC_OBJECT, &id.to_string());
    w.into_bytes()
}

/// `literal=yes`, the line that has a name shown as written rather than looked up.
pub fn literal_line(indent: &[u8]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.pair(0, keys::LITERAL, "yes");
    w.into_bytes()
}

/// One anonymous `{ to=N length=L [bridge=yes] }` entry followed by the
/// single-space line that separates list entries. `indent` is the entry's own
/// indentation: one tab deeper than the `hyperlane` key's.
pub fn lane_entry(indent: &[u8], to: u32, length: u32, bridge: bool) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.line(0, "{");
    w.pair(1, keys::TO, &to.to_string());
    w.pair(1, keys::LENGTH, &length.to_string());
    if bridge {
        w.pair(1, keys::BRIDGE, "yes");
    }
    w.line(0, "}");
    w.separator();
    w.into_bytes()
}

/// A whole `hyperlane=` block around already-emitted `entries` (see
/// [`lane_entry`]). `key_indent` is the indentation of the `hyperlane` key; the
/// line after `{` holds one tab more, as the game writes anonymous lists.
pub fn hyperlane_block(key_indent: &[u8], entries: &[u8]) -> Vec<u8> {
    let mut w = Lines::new(key_indent);
    w.open(0, keys::HYPERLANE);
    w.line(1, "");
    w.bytes(entries);
    w.close(0);
    w.into_bytes()
}

/// `text`, emitted at `indent`, as a statement written where another stands: without the
/// indentation of its first line, which that line already has, or its closing newline.
pub(crate) fn inline(indent: &[u8], text: &[u8]) -> String {
    let text = text.strip_suffix(b"\n").unwrap_or(text);
    String::from_utf8_lossy(text.strip_prefix(indent).unwrap_or(text)).into_owned()
}

/// Lines at a depth below the entry's own indentation.
pub(crate) struct Lines {
    base: String,
    out: String,
}

impl Lines {
    pub(crate) fn new(indent: &[u8]) -> Self {
        Self {
            base: String::from_utf8_lossy(indent).into_owned(),
            out: String::new(),
        }
    }

    pub(crate) fn indent(&self, depth: usize) -> String {
        format!("{}{}", self.base, "\t".repeat(depth))
    }

    pub(crate) fn line(&mut self, depth: usize, text: &str) {
        let indent = self.indent(depth);
        self.out.push_str(&format!("{indent}{text}\n"));
    }

    pub(crate) fn pair(&mut self, depth: usize, key: &str, value: &str) {
        self.line(depth, &format!("{key}={value}"));
    }

    /// `key=` and the opening brace below it.
    pub(crate) fn open(&mut self, depth: usize, key: &str) {
        self.line(depth, &format!("{key}="));
        self.line(depth, "{");
    }

    pub(crate) fn close(&mut self, depth: usize) {
        self.line(depth, "}");
    }

    /// `key={ a b }` as the game writes a list of ids: one line, a space after each.
    pub(crate) fn list(&mut self, depth: usize, key: &str, ids: &[u32]) {
        self.open(depth, key);
        let items: String = ids.iter().map(|id| format!("{id} ")).collect();
        self.line(depth + 1, &items);
        self.close(depth);
    }

    /// The single-space line the game writes after each entry of an anonymous list.
    pub(crate) fn separator(&mut self) {
        self.out.push_str(" \n");
    }

    pub(crate) fn bytes(&mut self, bytes: &[u8]) {
        self.out.push_str(&String::from_utf8_lossy(bytes));
    }

    pub(crate) fn into_bytes(self) -> Vec<u8> {
        self.out.into_bytes()
    }
}
