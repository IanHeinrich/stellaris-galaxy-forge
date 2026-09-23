//! The edit primitive every op is planned in terms of: one statement's current bytes,
//! their CST, and the splices to make in them.
//!
//! A [`Subject`] names what the statement stands for so that an error reads as the op's
//! caller expects; [`splice`] applies the planned ranges to a copy of the bytes.
//!
//! Ops reach the bytes through three primitives: [`Edit::set_scalar`] rewrites a value,
//! [`Edit::insert_lines`] adds whole lines at a line boundary, and
//! [`Edit::remove_lines`] deletes them. Structure comes from the CST and indentation is
//! copied from the line the text lands beside, never computed.

use std::ops::Range;

use crate::Span;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::format;
use crate::keys;
use crate::ops::OpError;
use crate::overlay::Anchor;

/// One local splice: replace `range` of the statement's current bytes with the text.
pub(crate) type Splice = (Range<usize>, Vec<u8>);

/// What an [`Edit`] stands for: a `galactic_object` entity, a save's `planets.planet`
/// entity with the system it is a body of, the `index`th `nebula` section, one statement
/// that is nobody's entity (a scenario's standalone `add_hyperlane`, which belongs to the
/// two systems it names rather than to either), one of a scenario header's statements,
/// which belongs to no system at all, a save's top-level `flags` section, or a save's
/// `country` entity.
///
/// The order is the order edits are committed in: every system, then every planet, then
/// every nebula, then every standalone statement, then the header, then the flags, then
/// every country.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Subject {
    System(u32),
    Planet { id: u32, system: u32 },
    Nebula(usize),
    Statement { anchor: Anchor, ends: (u32, u32) },
    Header(Anchor),
    Flags,
    Country(u32),
}

impl Subject {
    /// The system id, when this subject names a system.
    pub const fn system(self) -> Option<u32> {
        match self {
            Self::System(id) => Some(id),
            Self::Planet { .. }
            | Self::Nebula(_)
            | Self::Statement { .. }
            | Self::Header(_)
            | Self::Flags
            | Self::Country(_) => None,
        }
    }

    /// Every system this subject re-projects: itself, the system a planet is a body of, or
    /// both ends of a lane statement.
    pub fn systems(self) -> impl Iterator<Item = u32> {
        let ids = match self {
            Self::System(id) | Self::Planet { system: id, .. } => vec![id],
            Self::Nebula(_) | Self::Header(_) | Self::Flags | Self::Country(_) => Vec::new(),
            Self::Statement { ends, .. } => vec![ends.0, ends.1],
        };
        ids.into_iter()
    }

    pub fn parse_error(self, offset: usize, reason: impl Into<String>) -> OpError {
        let reason = reason.into();
        match self {
            Self::System(system)
            | Self::Statement {
                ends: (system, _), ..
            } => OpError::Parse {
                system,
                offset,
                reason,
            },
            Self::Planet { id: planet, .. } => OpError::PlanetParse {
                planet,
                offset,
                reason,
            },
            Self::Nebula(nebula) => OpError::NebulaParse {
                nebula,
                offset,
                reason,
            },
            Self::Header(_) => OpError::HeaderParse { offset, reason },
            Self::Flags => OpError::FlagsParse { offset, reason },
            Self::Country(country) => OpError::CountryParse {
                country,
                offset,
                reason,
            },
        }
    }
}

/// One statement loaded for editing: its current bytes, their CST (spans relative to
/// `buf`) and the splices planned so far.
pub(crate) struct Edit {
    pub subject: Subject,
    pub stmt: Anchor,
    pub buf: Vec<u8>,
    pub root: Node,
    pub splices: Vec<Splice>,
}

impl Edit {
    /// The `<id>=` node of the entity, or the `nebula=` node of the section.
    pub fn entity(&self) -> Result<&Node, OpError> {
        self.root
            .children()
            .first()
            .ok_or_else(|| self.parse_error(0, "empty statement"))
    }

    /// The `hyperlane` node when present; an error if it is not a block.
    pub fn hyperlane(&self) -> Result<Option<&Node>, OpError> {
        let Some(node) = self.entity()?.find(keys::HYPERLANE, &self.buf) else {
            return Ok(None);
        };
        if node.scalar_span().is_some() {
            return Err(self.parse_error(node.span().start, "hyperlane is not a block"));
        }
        Ok(Some(node))
    }

    /// The `to` id of one lane entry, `None` when it is missing or not a number.
    pub fn lane_to(&self, entry: &Node) -> Option<u32> {
        entry
            .find(keys::TO, &self.buf)
            .and_then(|n| n.scalar_str(&self.buf))
            .and_then(|s| s.parse().ok())
    }

    /// The `length` scalar of one lane entry.
    pub fn lane_length(&self, entry: &Node) -> Result<Span, OpError> {
        entry
            .find(keys::LENGTH, &self.buf)
            .and_then(Node::scalar_span)
            .ok_or_else(|| self.parse_error(entry.span().start, "lane entry has no length"))
    }

    pub fn parse_error(&self, offset: usize, reason: impl Into<String>) -> OpError {
        self.subject.parse_error(offset, reason)
    }

    pub fn text(&self, span: Span) -> &str {
        std::str::from_utf8(span.slice(&self.buf)).unwrap_or("")
    }

    /// The span of the scalar at `path` below the entity, `path` being keys from the
    /// entity down (`["coordinate", "x"]`).
    pub fn scalar(&self, path: &[&str]) -> Result<Span, OpError> {
        let mut node = self.entity()?;
        for (i, key) in path.iter().enumerate() {
            let missing = self.parse_error(
                node.span().start,
                format!("missing {}", path[..=i].join(".")),
            );
            node = match node.find(key, &self.buf) {
                Some(child) => child,
                None => return Err(missing),
            };
            if i + 1 == path.len() {
                return node.scalar_span().ok_or(missing);
            }
        }
        Err(self.parse_error(0, "empty path"))
    }

    /// Rewrite the scalar at `path` (see [`Self::scalar`]).
    pub fn set_scalar(&mut self, path: &[&str], text: impl Into<Vec<u8>>) -> Result<(), OpError> {
        let span = self.scalar(path)?;
        self.splices.push((span.range(), text.into()));
        Ok(())
    }

    /// The span of the whole value at `path`, scalar or block, below the entity. A
    /// scenario axis is one or the other (`x = 12`, `x = { min = 20 max = 30 }`), so a
    /// writer that fixes it to a point replaces the value rather than its text.
    pub fn value(&self, path: &[&str]) -> Result<Span, OpError> {
        let mut node = self.entity()?;
        for (i, key) in path.iter().enumerate() {
            let missing = self.parse_error(
                node.span().start,
                format!("missing {}", path[..=i].join(".")),
            );
            node = match node.find(key, &self.buf) {
                Some(child) => child,
                None => return Err(missing),
            };
            if i + 1 == path.len() {
                return Ok(node.value_span());
            }
        }
        Err(self.parse_error(0, "empty path"))
    }

    /// Rewrite the whole value at `path`, scalar or block (see [`Self::value`]).
    pub fn set_value(&mut self, path: &[&str], text: impl Into<Vec<u8>>) -> Result<(), OpError> {
        let span = self.value(path)?;
        self.splices.push((span.range(), text.into()));
        Ok(())
    }

    /// Insert `text` at offset `at` in the statement's bytes.
    pub fn insert(&mut self, at: usize, text: Vec<u8>) {
        self.splices.push((at..at, text));
    }

    /// Insert whole lines at the line boundary `at`, which [`Self::line_start`] and
    /// [`Self::line_end`] produce.
    pub fn insert_lines(&mut self, at: usize, text: Vec<u8>) {
        self.insert(at, text);
    }

    /// Delete one statement inside the entity: the whole line when it is alone on one,
    /// else the statement and the whitespace that separated it from its neighbour.
    pub fn remove_statement(&mut self, span: Span) {
        if alone_on_line(&self.buf, span) {
            return self.remove_lines(span);
        }
        let mut start = span.start;
        while start > 0 && is_blank(self.buf[start - 1]) {
            start -= 1;
        }
        self.splices.push((start..span.end, Vec::new()));
    }

    /// Delete every line `span` touches, taking the single-space line the game writes
    /// between list entries with it.
    pub fn remove_lines(&mut self, span: Span) {
        let start = self.line_start(span.start);
        let mut end = self.line_end(span.end);
        if self.buf[end..].starts_with(b" \n") {
            end += 2;
        }
        self.splices.push((start..end, Vec::new()));
    }

    /// The start of the line holding `at`.
    pub fn line_start(&self, at: usize) -> usize {
        cst::line_start(&self.buf, at)
    }

    /// Just past the line holding `at`.
    pub fn line_end(&self, at: usize) -> usize {
        cst::line_end(&self.buf, at)
    }

    /// The indentation of the line holding `at`, to copy onto text inserted beside it.
    pub fn indent(&self, at: usize) -> Vec<u8> {
        cst::indent_of(&self.buf, at).to_vec()
    }

    /// Refuse a block that is not in the game's multi-line shape: the open brace either
    /// alone on its own line, or the last non-blank thing on the key's line (as 3.4 to 3.9
    /// write it), and the close brace and every child's braces alone on theirs. Line
    /// insertion and removal assume that shape.
    pub fn require_block_shape(&self, block: &Node) -> Result<(), OpError> {
        let key = block
            .key
            .ok_or_else(|| self.parse_error(block.span().start, "block has no key"))?;
        let value = block.value_span();
        let open = Span::new(value.start, value.start + 1);
        let open_well_formed = alone_on_line(&self.buf, open)
            || (self.line_start(value.start) == self.line_start(key.start)
                && ends_line(&self.buf, open.end));
        let mut braces = vec![value.end - 1];
        for child in block.children() {
            let span = child.value_span();
            braces.push(span.start);
            braces.push(span.end - 1);
        }
        let well_formed = open_well_formed
            && braces
                .iter()
                .all(|&at| alone_on_line(&self.buf, Span::new(at, at + 1)));
        if !well_formed {
            return Err(self.parse_error(
                key.start,
                format!(
                    "{} block is not in the game's multi-line shape",
                    self.text(key)
                ),
            ));
        }
        Ok(())
    }

    /// Refuse a statement sharing its line with anything but whitespace, `what` naming it.
    pub fn require_alone_on_line(&self, span: Span, what: &str) -> Result<(), OpError> {
        if alone_on_line(&self.buf, span) {
            return Ok(());
        }
        Err(self.parse_error(span.start, format!("{what} holds other text")))
    }

    /// Whether only blanks stand between the start of `at`'s line and `at`.
    pub fn starts_line(&self, at: usize) -> bool {
        starts_line(&self.buf, at)
    }

    /// Write `text` as the statement following the one ending at `after`, in the shape that
    /// statement is written in: on a line of its own when that one ends its line, else
    /// beside it. Two statements written after the same one land in the order written.
    pub fn insert_after(&mut self, after: usize, text: &str) {
        let end = self.line_end(after);
        if ends_line(&self.buf, after) && self.buf[..end].ends_with(b"\n") {
            let line = [&self.indent(after)[..], text.as_bytes(), b"\n"].concat();
            self.insert_lines(end, line);
        } else {
            self.insert(after, format!(" {text}").into_bytes());
        }
    }

    /// Write `text` as the first statement of the block whose braces `value` spans, in the
    /// shape `first_child`, the statement standing first, is written in.
    pub fn insert_first(&mut self, value: Span, first_child: Option<Span>, text: &str) {
        match first_child {
            Some(child) if self.starts_line(child.start) => {
                let line = [&self.indent(child.start)[..], text.as_bytes(), b"\n"].concat();
                self.insert_lines(self.line_start(child.start), line);
            }
            _ => self.insert(value.start + 1, format!(" {text}").into_bytes()),
        }
    }

    /// Write `text` where the statement at `span` stands, taking that statement back. The
    /// two splices meet at a boundary rather than overlapping: the replacement lands at the
    /// start of the line the removal takes, or right where a statement removed in place
    /// ended.
    pub fn replace_statement(&mut self, span: Span, text: &str) {
        if self.starts_line(span.start) {
            let line = [&self.indent(span.start)[..], text.as_bytes(), b"\n"].concat();
            self.insert_lines(self.line_start(span.start), line);
        } else {
            self.insert(span.end, format!(" {text}").into_bytes());
        }
        self.remove_statement(span);
    }
}

/// What stands beside a statement on its line without being text: a space, a tab, or
/// the carriage return of a CRLF line end.
fn is_blank(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r')
}

/// Whether a slot holds nothing but blanks and line ends: a statement emptied there.
pub(crate) fn blank_slot(bytes: &[u8]) -> bool {
    bytes.iter().all(|&b| is_blank(b) || b == b'\n')
}

/// Whether the statement at `span` of `src` has its line to itself: only blanks before
/// it and after it. A comment after it is text of its own, which removing the line would
/// take.
pub(crate) fn alone_on_line(src: &[u8], span: Span) -> bool {
    starts_line(src, span.start) && ends_line(src, span.end)
}

/// Whether the statement at `span` of `src` has its line to itself but for a trailing
/// comment, which belongs to the line and goes with it.
pub(crate) fn owns_line(src: &[u8], span: Span) -> bool {
    starts_line(src, span.start)
        && src[span.end..cst::line_end(src, span.end)]
            .iter()
            .take_while(|&&b| b != b'#')
            .all(|&b| is_blank(b) || b == b'\n')
}

fn starts_line(src: &[u8], at: usize) -> bool {
    src[cst::line_start(src, at)..at]
        .iter()
        .all(|&b| is_blank(b))
}

fn ends_line(src: &[u8], at: usize) -> bool {
    blank_slot(&src[at..cst::line_end(src, at)])
}

pub(super) fn load(doc: &Document, subject: Subject, stmt: Anchor) -> Result<Edit, OpError> {
    let buf = doc.current(stmt)?.to_vec();
    parsed(doc, subject, stmt, buf)
}

/// An edit of `stmt`, whose current bytes are `buf`.
pub(super) fn parsed(
    doc: &Document,
    subject: Subject,
    stmt: Anchor,
    buf: Vec<u8>,
) -> Result<Edit, OpError> {
    let root = format::of(doc.kind())
        .parse(&buf, 0)
        .map_err(|e| subject.parse_error(e.offset, e.reason))?;
    Ok(Edit {
        subject,
        stmt,
        buf,
        root,
        splices: Vec::new(),
    })
}

/// Replace the `length` scalar of every lane entry to `to` with `text(existing)`; returns
/// how many entries were rewritten.
pub(crate) fn replace_lengths(
    edit: &mut Edit,
    to: u32,
    text: impl Fn(&str) -> String,
) -> Result<usize, OpError> {
    let mut splices = Vec::new();
    if let Some(block) = edit.hyperlane()? {
        for entry in block.children() {
            if edit.lane_to(entry) != Some(to) {
                continue;
            }
            let span = edit.lane_length(entry)?;
            splices.push((span.range(), text(edit.text(span)).into_bytes()));
        }
    }
    let n = splices.len();
    edit.splices.extend(splices);
    Ok(n)
}

/// Apply `splices` to a copy of `buf`, right to left so earlier offsets stay valid.
/// Ranges must not overlap; insertions sharing an offset land in planning order.
pub(super) fn splice(
    subject: Subject,
    buf: &[u8],
    mut splices: Vec<Splice>,
) -> Result<Vec<u8>, OpError> {
    splices.sort_by_key(|(r, _)| (r.start, r.end));
    for pair in splices.windows(2) {
        if pair[0].0.end > pair[1].0.start {
            return Err(subject.parse_error(pair[1].0.start, "edit ranges overlap"));
        }
    }
    let mut out = buf.to_vec();
    for (range, text) in splices.into_iter().rev() {
        out.splice(range, text);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{Subject, splice};

    #[test]
    fn splices_apply_in_offset_order_and_reject_overlap() {
        let buf = b"abcdef";
        let out = splice(
            Subject::System(0),
            buf,
            vec![
                (4..5, b"E".to_vec()),
                (1..3, b"BC".to_vec()),
                (6..6, b"!".to_vec()),
                (6..6, b"?".to_vec()),
            ],
        )
        .unwrap();
        assert_eq!(out, b"aBCdEf!?");
        assert!(
            splice(
                Subject::System(0),
                buf,
                vec![(1..3, vec![]), (2..4, vec![])]
            )
            .is_err()
        );
    }
}
