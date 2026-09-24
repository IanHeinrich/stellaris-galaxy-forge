//! The `# created by` line a scenario Forge or Paint a Galaxy wrote opens with. Each tool
//! that writes such a file wraps the line it found in its own, so the line names every
//! tool and version that wrote the file, the last one first:
//!
//! `# created by Stellaris Galaxy Forge 0.13.0 (imported from txt created by Paint a Galaxy 1.4.2 (imported from generic txt))`

use memchr::memchr;

use crate::VERSION;
use crate::document::Document;

/// A zero-width space follows the `#`, so a comment someone typed never reads as the line.
const PREFIX: &str = "#\u{200B} created by ";
const TOOL: &str = "Stellaris Galaxy Forge";
const BOM: &[u8] = b"\xEF\xBB\xBF";
/// How files an earlier Forge wrote open, before it wrote the line.
const EARLIER: [&str; 2] = [
    "# Exported by Stellaris Galaxy Forge",
    "# Written by Stellaris Galaxy Forge",
];
const EARLIER_WRITER: &str = "an earlier Stellaris Galaxy Forge";
const IMPORTED: &str = "imported from txt created by ";
/// What joins one writer to the one before it.
const LEVEL: &str = " (imported from txt created by ";
/// The most writers a line names, [`ELIDED`] counting as one.
const MAX_WRITERS: usize = 10;
/// The level standing for the writers cut from the middle of a long line.
const ELIDED: &str = "...";

/// Forge's line at this version, with `note` in brackets after it, without a line ending.
pub(crate) fn created(note: Option<&str>) -> String {
    match note {
        Some(note) => format!("{PREFIX}{TOOL} {VERSION} ({note})"),
        None => format!("{PREFIX}{TOOL} {VERSION}"),
    }
}

/// How saving `doc` rewrites the start of its file: how many of the original bytes to
/// drop and what to write in their place. An unedited document is written as it was
/// opened, so nothing is dropped and nothing written.
pub(crate) fn stamp(doc: &Document) -> (usize, Vec<u8>) {
    if !doc.is_dirty() {
        return (0, Vec::new());
    }
    let untouched = doc
        .overlay()
        .slots()
        .next()
        .map_or(doc.original().len(), |(anchor, _)| anchor.start());
    restamp(doc.original(), untouched).unwrap_or_default()
}

/// The first line of `original` rewritten to name this version of Forge as its latest
/// writer, as the bytes to drop and the bytes to write in their place; `None` when the
/// line already names it or neither tool wrote the file. The line is replaced only when
/// its first `untouched` bytes hold it whole; otherwise the new line goes above it.
pub(crate) fn restamp(original: &[u8], untouched: usize) -> Option<(usize, Vec<u8>)> {
    let bom = if original.starts_with(BOM) {
        BOM.len()
    } else {
        0
    };
    let rest = &original[bom..];
    let line = &rest[..memchr(b'\n', rest).unwrap_or(rest.len())];
    let (line, eol): (&[u8], &[u8]) = match line.strip_suffix(b"\r") {
        Some(line) => (line, b"\r\n"),
        None => (line, b"\n"),
    };
    let line = std::str::from_utf8(line).ok()?;
    let found = line.strip_prefix(PREFIX);
    let writer = match found {
        Some(writer) if names_this_version(writer) => return None,
        Some(writer) => writer,
        None if EARLIER.iter().any(|earlier| line.starts_with(earlier)) => EARLIER_WRITER,
        None => return None,
    };
    let mut head = original[..bom].to_vec();
    head.extend_from_slice(created(Some(&format!("{IMPORTED}{}", trimmed(writer)))).as_bytes());
    if found.is_some() && bom + line.len() <= untouched {
        return Some((bom + line.len(), head));
    }
    if bom > untouched {
        return None;
    }
    head.extend_from_slice(eol);
    Some((bom, head))
}

/// `writers`, the line being wrapped without its prefix, cut so that the line wrapping it
/// names at most [`MAX_WRITERS`]: the newest writers, one [`ELIDED`] level and the
/// original writer with its note. A line whose levels do not parse is kept whole.
fn trimmed(writers: &str) -> String {
    let levels: Vec<&str> = writers.split(LEVEL).collect();
    if levels.len() < MAX_WRITERS {
        return writers.to_owned();
    }
    let (last, newer) = levels.split_last().expect("split yields a level");
    let origin = last.strip_suffix(&")".repeat(newer.len()));
    let parses = origin.is_some_and(balanced) && !newer.iter().any(|w| w.contains(['(', ')']));
    let Some(origin) = origin.filter(|_| parses) else {
        return writers.to_owned();
    };
    let mut kept: Vec<&str> = newer
        .iter()
        .take(MAX_WRITERS - 3)
        .take_while(|&&writer| writer != ELIDED)
        .copied()
        .collect();
    kept.extend([ELIDED, origin]);
    format!("{}{}", kept.join(LEVEL), ")".repeat(kept.len() - 1))
}

fn balanced(text: &str) -> bool {
    let mut depth = 0usize;
    for c in text.chars() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => return false,
            ')' => depth -= 1,
            _ => {}
        }
    }
    depth == 0
}

fn names_this_version(writer: &str) -> bool {
    writer
        .strip_prefix(TOOL)
        .and_then(|rest| rest.strip_prefix(' '))
        .and_then(|rest| rest.strip_prefix(VERSION))
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(" ("))
}

/// `pieces` without their first `n` bytes.
pub(crate) fn skip<'a>(
    pieces: impl Iterator<Item = &'a [u8]>,
    n: usize,
) -> impl Iterator<Item = &'a [u8]> {
    let mut left = n;
    pieces.filter_map(move |piece| {
        let cut = left.min(piece.len());
        left -= cut;
        Some(&piece[cut..]).filter(|rest| !rest.is_empty())
    })
}
