//! Line diffs of a whole document that read only the lines around its edits.
use std::fmt::Write as _;

use similar::{Algorithm, TextDiff};

/// The unified diff (3 lines of context) of `old` against `new`, as `similar` writes it for
/// the whole of both texts.
pub fn line_diff(old: &str, new: &str, (from, to): (&str, &str)) -> String {
    let (old, new, skipped) = middle(old, new, 3);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(old, new);
    let text = diff
        .unified_diff()
        .context_radius(3)
        .header(from, to)
        .to_string();
    renumbered(&text, skipped)
}

/// How many lines past its context [`middle`] keeps at either end: a diff may slide a change
/// along lines that repeat, and the hunk takes its context from where the change lands.
const SLIDE: usize = 100;

/// `old` and `new` without the whole lines they share at either end, except `context` lines
/// and some room for a change to slide on each side, and how many lines came off the front.
/// The diff trims the shared ends itself before it compares anything, so a line diff of
/// what is left has the hunks of the whole, numbered from that many lines on (see
/// [`renumbered`]).
pub fn middle<'a>(old: &'a str, new: &'a str, context: usize) -> (&'a str, &'a str, usize) {
    let (a, b) = (old.as_bytes(), new.as_bytes());
    let shared = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let front = line_start(a, shared);
    let mut start = front;
    for _ in 0..context + SLIDE {
        if start == 0 {
            break;
        }
        start = line_start(a, start - 1);
    }
    let room = a.len().min(b.len()) - front;
    let shared_back = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take(room)
        .take_while(|(x, y)| x == y)
        .count();
    let mut end = next_line(a, a.len() - shared_back);
    for _ in 0..context + SLIDE {
        end = next_line(a, end);
    }
    let cut = a.len() - end;
    let skipped = a[..start].iter().filter(|&&c| c == b'\n').count();
    (&old[start..end], &new[start..new.len() - cut], skipped)
}

/// The start of the line that holds byte `at` of `bytes`.
fn line_start(bytes: &[u8], at: usize) -> usize {
    bytes[..at]
        .iter()
        .rposition(|&c| c == b'\n')
        .map_or(0, |newline| newline + 1)
}

/// The start of the first line to begin at or after byte `at` of `bytes`, past a newline
/// at or after `at`; the end of `bytes` when there is none.
fn next_line(bytes: &[u8], at: usize) -> usize {
    bytes[at..]
        .iter()
        .position(|&c| c == b'\n')
        .map_or(bytes.len(), |newline| at + newline + 1)
}

/// `diff`, a unified diff of [`middle`]'s texts, with each hunk header's line numbers moved
/// on by the `skipped` lines the cut took off the front.
pub fn renumbered(diff: &str, skipped: usize) -> String {
    if skipped == 0 {
        return diff.to_owned();
    }
    let shift = |range: &str| match range.split_once(',') {
        Some((line, len)) => format!("{},{len}", line.parse::<usize>().unwrap() + skipped),
        None => (range.parse::<usize>().unwrap() + skipped).to_string(),
    };
    let mut out = String::with_capacity(diff.len());
    for line in diff.split_inclusive('\n') {
        let header = line
            .strip_prefix("@@ -")
            .and_then(|rest| rest.split_once(" @@"))
            .and_then(|(ranges, after)| Some((ranges.split_once(" +")?, after)));
        match header {
            Some(((old, new), after)) => {
                write!(out, "@@ -{} +{} @@{after}", shift(old), shift(new)).unwrap();
            }
            None => out.push_str(line),
        }
    }
    out
}
