//! The Source tab: the entity's current bytes and the lines an op changed.
//!
//! No op records sub-statement spans, so the changed ranges are derived here by diffing
//! the entity's original bytes against its current ones. Both are skipped while the
//! entity has no overlay slot, so the common case costs nothing.

use crate::entity::views::{EntityAddr, EntitySource};

/// The Source tab shows at most this much; the sample's largest entity is 618 KB.
const CAP: usize = 1 << 20;

/// Above this many cells the line diff would cost more than the tab is worth, and the
/// whole differing middle is reported as one range.
const CELLS: usize = 1 << 20;

pub(crate) fn source(
    addr: EntityAddr,
    original: &[u8],
    current: &[u8],
    dirty: bool,
) -> EntitySource {
    let truncated = current.len() > CAP;
    let shown = &current[..current.len().min(CAP)];
    let changed = if dirty {
        changed_ranges(original, current)
            .into_iter()
            .filter(|r| r[0] <= shown.len())
            .map(|r| [r[0], r[1].min(shown.len())])
            .collect()
    } else {
        Vec::new()
    };
    EntitySource {
        addr,
        // Ranges are byte offsets; `gamestate` is ASCII, so lossy decoding keeps them.
        text: String::from_utf8_lossy(shown).into_owned(),
        changed,
        truncated,
    }
}

/// Byte ranges of `current` whose lines are not in `original`, ascending.
fn changed_ranges(original: &[u8], current: &[u8]) -> Vec<[usize; 2]> {
    if original == current {
        return Vec::new();
    }
    let (was, now) = (lines(original), lines(current));
    let same = |x: &[usize; 2], y: &[usize; 2]| original[x[0]..x[1]] == current[y[0]..y[1]];
    let head = was.iter().zip(&now).take_while(|(x, y)| same(x, y)).count();
    let tail = was[head..]
        .iter()
        .rev()
        .zip(now[head..].iter().rev())
        .take_while(|(x, y)| same(x, y))
        .count();
    let a = &was[head..was.len() - tail];
    let b = &now[head..now.len() - tail];
    let Some((first, last)) = b.first().zip(b.last()) else {
        let at = now.get(head).map_or(current.len(), |line| line[0]);
        return vec![[at, at]];
    };
    if a.is_empty() || a.len() * b.len() > CELLS {
        return vec![[first[0], last[1]]];
    }
    runs(b, &matched(a, b, original, current))
}

/// Line starts and ends, terminator included.
fn lines(src: &[u8]) -> Vec<[usize; 2]> {
    let mut lines = Vec::new();
    let mut start = 0;
    while start < src.len() {
        let end = memchr::memchr(b'\n', &src[start..]).map_or(src.len(), |i| start + i + 1);
        lines.push([start, end]);
        start = end;
    }
    lines
}

/// Which lines of `b` a longest common subsequence keeps.
fn matched(a: &[[usize; 2]], b: &[[usize; 2]], left: &[u8], right: &[u8]) -> Vec<bool> {
    let (n, m) = (a.len(), b.len());
    let same = |i: usize, j: usize| left[a[i][0]..a[i][1]] == right[b[j][0]..b[j][1]];
    let mut table = vec![0u32; (n + 1) * (m + 1)];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            table[i * (m + 1) + j] = if same(i, j) {
                table[(i + 1) * (m + 1) + j + 1] + 1
            } else {
                table[(i + 1) * (m + 1) + j].max(table[i * (m + 1) + j + 1])
            };
        }
    }
    let mut kept = vec![false; m];
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if same(i, j) {
            kept[j] = true;
            i += 1;
            j += 1;
        } else if table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    kept
}

/// Consecutive unkept lines as one range each.
fn runs(b: &[[usize; 2]], kept: &[bool]) -> Vec<[usize; 2]> {
    let mut ranges: Vec<[usize; 2]> = Vec::new();
    for (line, _) in b.iter().zip(kept).filter(|(_, kept)| !**kept) {
        match ranges.last_mut() {
            Some(last) if last[1] == line[0] => last[1] = line[1],
            _ => ranges.push(*line),
        }
    }
    if ranges.is_empty() {
        let at = b.first().map_or(0, |l| l[0]);
        ranges.push([at, at]);
    }
    ranges
}
