//! Text generation in the file's own style: pure functions, no I/O.
//!
//! Indentation is never computed; callers measure it from the entity the text is
//! inserted into (`cst::indent_of`) and pass it in.

pub mod system;

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
    let i = String::from_utf8_lossy(indent).into_owned();
    let mut out = String::with_capacity(256 + n.members.len() * 24);
    out.push_str(&format!("{i}nebula=\n{i}{{\n"));
    out.push_str(&format!("{i}\tcoordinate=\n{i}\t{{\n"));
    out.push_str(&format!("{i}\t\tx={}\n", coord(n.x)));
    out.push_str(&format!("{i}\t\ty={}\n", coord(n.y)));
    out.push_str(&format!("{i}\t\torigin={}\n", crate::NULL_ID));
    out.push_str(&format!("{i}\t\trandomized={NEBULA_RANDOMIZED}\n"));
    out.push_str(&format!("{i}\t\tvisual_height={NEBULA_VISUAL_HEIGHT}\n"));
    out.push_str(&format!("{i}\t}}\n"));
    out.push_str(&format!("{i}\tname=\n{i}\t{{\n"));
    out.push_str(&format!("{i}\t\tkey=\"{}\"\n", n.name));
    if n.literal {
        out.push_str(&format!("{i}\t\tliteral=yes\n"));
    }
    out.push_str(&format!("{i}\t}}\n"));
    out.push_str(&format!("{i}\tradius={}\n", coord(n.radius)));
    for id in n.members {
        out.push_str(&format!("{i}\tgalactic_object={id}\n"));
    }
    out.push_str(&format!("{i}}}\n"));
    out.into_bytes()
}

/// One anonymous `{ to=N length=L [bridge=yes] }` entry followed by the
/// single-space line that separates list entries. `indent` is the entry's own
/// indentation: one tab deeper than the `hyperlane` key's.
pub fn lane_entry(indent: &[u8], to: u32, length: u32, bridge: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(indent.len() * 5 + 48);
    out.extend_from_slice(indent);
    out.extend_from_slice(b"{\n");
    out.extend_from_slice(indent);
    out.extend_from_slice(b"\tto=");
    out.extend_from_slice(to.to_string().as_bytes());
    out.push(b'\n');
    out.extend_from_slice(indent);
    out.extend_from_slice(b"\tlength=");
    out.extend_from_slice(length.to_string().as_bytes());
    out.push(b'\n');
    if bridge {
        out.extend_from_slice(indent);
        out.extend_from_slice(b"\tbridge=yes\n");
    }
    out.extend_from_slice(indent);
    out.extend_from_slice(b"}\n \n");
    out
}

/// A whole `hyperlane=` block around already-emitted `entries` (see
/// [`lane_entry`]). `key_indent` is the indentation of the `hyperlane` key; the
/// line after `{` holds one tab more, as the game writes anonymous lists.
pub fn hyperlane_block(key_indent: &[u8], entries: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(key_indent.len() * 4 + entries.len() + 20);
    out.extend_from_slice(key_indent);
    out.extend_from_slice(b"hyperlane=\n");
    out.extend_from_slice(key_indent);
    out.extend_from_slice(b"{\n");
    out.extend_from_slice(key_indent);
    out.extend_from_slice(b"\t\n");
    out.extend_from_slice(entries);
    out.extend_from_slice(key_indent);
    out.extend_from_slice(b"}\n");
    out
}
