//! The byte-span index: one linear pass over `gamestate` recording every top-level statement
//! and every id-keyed block one level down. Structure comes from brace counting only; the
//! scan never looks at indentation or line boundaries.

use std::borrow::Cow;
use std::collections::HashMap;
use std::ops::Range;

use memchr::{memchr, memchr3};

use crate::Span;
use crate::lexer::Mode;

/// The value side of a `key=value` statement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Value {
    /// `{ ... }`: offsets of the opening and closing brace.
    Block { open: usize, close: usize },
    /// A quoted or bare scalar (empty when `key=` is followed by `}`).
    Scalar(Span),
}

/// A depth-0 statement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Section {
    /// The key token as written (quotes included when quoted).
    pub key: Span,
    /// Key start through the end of the value.
    pub stmt: Span,
    pub value: Value,
}

/// A depth-1 statement with a numeric key inside a depth-0 block: `<id>={ ... }`, or a
/// tombstone such as `<id>=none`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entity {
    pub id: u64,
    /// Key start through the end of the value.
    pub stmt: Span,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{reason} at byte {offset}")]
pub struct ScanError {
    pub offset: usize,
    pub reason: &'static str,
}

/// Every top-level statement in file order, with id-keyed entities per block section.
#[derive(Clone, Debug, Default)]
pub struct Index {
    sections: Vec<Section>,
    by_key: HashMap<String, Vec<usize>>,
    /// Parallel to `sections`.
    entities: Vec<Vec<Entity>>,
    /// Parallel to `sections`: entity id → index into `entities[i]`.
    by_id: Vec<HashMap<u64, usize>>,
}

impl Index {
    /// All top-level statements in file order, duplicates included.
    pub fn sections(&self) -> &[Section] {
        &self.sections
    }

    /// The first top-level statement with this key.
    pub fn section(&self, key: &str) -> Option<&Section> {
        self.by_key.get(key).map(|ix| &self.sections[ix[0]])
    }

    /// Every top-level statement with this key, in file order.
    pub fn sections_named<'a>(&'a self, key: &str) -> impl Iterator<Item = &'a Section> {
        self.by_key
            .get(key)
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .map(|&i| &self.sections[i])
    }

    /// The id-keyed statements of the first section with this key, in file order.
    pub fn entities(&self, section_key: &str) -> &[Entity] {
        self.by_key
            .get(section_key)
            .map(|ix| self.entities[ix[0]].as_slice())
            .unwrap_or(&[])
    }

    /// The entity `id` in the first section with this key that has it.
    pub fn entity(&self, section_key: &str, id: u64) -> Option<&Entity> {
        self.by_key
            .get(section_key)?
            .iter()
            .find_map(|&i| self.by_id[i].get(&id).map(|&e| &self.entities[i][e]))
    }

    /// Gaps between consecutive statements that are not pure whitespace: between top-level
    /// statements (including before the first and after the last) and, in each section that has
    /// entities, between the braces and consecutive entities. Empty on a well-understood file.
    pub fn coverage_gaps(&self, bytes: &[u8]) -> Vec<Span> {
        let mut gaps = Vec::new();
        let mut push = |start: usize, end: usize| {
            if !bytes[start..end].iter().all(|b| is_ws(*b)) {
                gaps.push(Span::new(start, end));
            }
        };
        let mut pos = 0;
        for s in &self.sections {
            push(pos, s.stmt.start);
            pos = s.stmt.end;
        }
        push(pos, bytes.len());
        for (s, ents) in self.sections.iter().zip(&self.entities) {
            let (Value::Block { open, close }, false) = (s.value, ents.is_empty()) else {
                continue;
            };
            let mut pos = open + 1;
            for e in ents {
                push(pos, e.stmt.start);
                pos = e.stmt.end;
            }
            push(pos, close);
        }
        gaps
    }
}

/// Build the index for a `gamestate` (or `meta`) buffer.
pub fn scan(bytes: &[u8]) -> Result<Index, ScanError> {
    scan_range(bytes, 0..bytes.len())
}

/// Index `bytes[range]` as if it were a whole file, so a block body such as the inside of
/// `planets={ ... }` yields its own statements as sections with their id-keyed entities.
/// Every span and error offset is absolute into `bytes`; `coverage_gaps` assumes a
/// whole-file index and is not meaningful on the result.
pub fn scan_range(bytes: &[u8], range: Range<usize>) -> Result<Index, ScanError> {
    scan_range_with(bytes, range, Mode::Save)
}

/// Like [`scan_range`], but in [`Mode::Script`] a `#` outside a quoted string starts a
/// comment that runs to the next `\n` (or end of input); comment bytes are skipped and never
/// become part of a key, value or statement span.
pub fn scan_range_with(bytes: &[u8], range: Range<usize>, mode: Mode) -> Result<Index, ScanError> {
    let mut scanner = Scanner {
        bytes: &bytes[..range.end],
        pos: range.start,
        index: Index::default(),
        mode,
        hash: None,
    };
    scanner.run()?;
    Ok(scanner.index)
}

/// A key or scalar token with surrounding quotes removed.
pub fn unquote(token: &[u8]) -> &[u8] {
    match token {
        [b'"', inner @ .., b'"'] => inner,
        _ => token,
    }
}

/// The unquoted key of a section as text.
pub fn key_name<'a>(bytes: &'a [u8], section: &Section) -> Cow<'a, str> {
    String::from_utf8_lossy(unquote(section.key.slice(bytes)))
}

struct Scanner<'a> {
    bytes: &'a [u8],
    pos: usize,
    index: Index,
    mode: Mode,
    /// The last search for a `#`: where it started and what it found. Without it a file
    /// with no comments is searched to its end once per block.
    hash: Option<(usize, Option<usize>)>,
}

/// What a statement turned out to be once its first token was read.
enum Stmt {
    Keyed {
        key: Span,
        value: Value,
        stmt: Span,
    },
    /// A bare list value or an anonymous block: walked, not recorded.
    Bare,
}

impl Scanner<'_> {
    fn run(&mut self) -> Result<(), ScanError> {
        loop {
            self.skip_ws();
            if self.pos >= self.bytes.len() {
                return Ok(());
            }
            if self.bytes[self.pos] == b'}' {
                return Err(self.err("unexpected `}` at top level"));
            }
            if let Stmt::Keyed { key, value, stmt } = self.statement(0)? {
                let name = String::from_utf8_lossy(unquote(key.slice(self.bytes))).into_owned();
                let i = self.index.sections.len();
                self.index.sections.push(Section { key, stmt, value });
                self.index.by_key.entry(name).or_default().push(i);
                if matches!(value, Value::Scalar(_)) {
                    self.index.entities.push(Vec::new());
                    self.index.by_id.push(HashMap::new());
                }
            }
        }
    }

    /// Parse one statement starting at `self.pos` (not whitespace). At depth 0 a block value is
    /// walked so its entities are recorded; at depth 1 it is skipped.
    fn statement(&mut self, depth: u8) -> Result<Stmt, ScanError> {
        let start = self.pos;
        if self.bytes[self.pos] == b'{' {
            let close = self.skip_block(self.pos)?;
            self.pos = close + 1;
            return Ok(Stmt::Bare);
        }
        let key = self.token()?;
        self.skip_ws();
        if self.peek() != Some(b'=') {
            return Ok(Stmt::Bare);
        }
        self.pos += 1;
        let eq_end = self.pos;
        self.skip_ws();
        let value = match self.peek() {
            Some(b'{') => {
                let open = self.pos;
                let close = if depth == 0 {
                    self.walk_block(open)?
                } else {
                    self.skip_block(open)?
                };
                self.pos = close + 1;
                Value::Block { open, close }
            }
            // `key=` followed by `}` or EOF: an empty value directly after the `=`,
            // matching the CST so both views agree on the statement's extent.
            Some(b'}') | None => {
                self.pos = eq_end;
                Value::Scalar(Span::new(eq_end, eq_end))
            }
            Some(_) => Value::Scalar(self.token()?),
        };
        Ok(Stmt::Keyed {
            key,
            value,
            stmt: Span::new(start, self.pos),
        })
    }

    /// Walk the children of the depth-0 block opening at `open`, recording entities; returns
    /// the offset of its closing brace.
    fn walk_block(&mut self, open: usize) -> Result<usize, ScanError> {
        let mut entities = Vec::new();
        let mut by_id = HashMap::new();
        self.pos = open + 1;
        let close = loop {
            self.skip_ws();
            match self.peek() {
                None => {
                    return Err(ScanError {
                        offset: open,
                        reason: "unterminated block",
                    });
                }
                Some(b'}') => break self.pos,
                Some(_) => {
                    if let Stmt::Keyed { key, value, stmt } = self.statement(1)?
                        && let Some(id) = parse_id(key.slice(self.bytes))
                    {
                        by_id.entry(id).or_insert(entities.len());
                        entities.push(Entity { id, stmt, value });
                    }
                }
            }
        };
        self.index.entities.push(entities);
        self.index.by_id.push(by_id);
        Ok(close)
    }

    /// Find the brace matching the one at `open`, ignoring braces inside quotes and, in
    /// [`Mode::Script`], inside `#` comments.
    fn skip_block(&mut self, open: usize) -> Result<usize, ScanError> {
        let mut pos = open + 1;
        let mut depth = 1usize;
        let mut in_quote = false;
        loop {
            let quote_brace = memchr3(b'"', b'{', b'}', &self.bytes[pos..]);
            let hash = self.next_hash(pos).map(|at| at - pos);
            let Some(i) = [quote_brace, hash].into_iter().flatten().min() else {
                return Err(ScanError {
                    offset: open,
                    reason: "unterminated block",
                });
            };
            let at = pos + i;
            if !in_quote && self.bytes[at] == b'#' {
                pos = memchr(b'\n', &self.bytes[at..]).map_or(self.bytes.len(), |j| at + j);
                continue;
            }
            match self.bytes[at] {
                b'"' => in_quote = !in_quote,
                b'{' if !in_quote => depth += 1,
                b'}' if !in_quote => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(at);
                    }
                }
                _ => {}
            }
            pos = at + 1;
        }
    }

    /// The first `#` at or after `pos` in [`Mode::Script`].
    fn next_hash(&mut self, pos: usize) -> Option<usize> {
        if self.mode != Mode::Script {
            return None;
        }
        if let Some((from, found)) = self.hash
            && from <= pos
            && found.is_none_or(|at| at >= pos)
        {
            return found;
        }
        let found = memchr(b'#', &self.bytes[pos..]).map(|i| pos + i);
        self.hash = Some((pos, found));
        found
    }

    /// A quoted string or a run of bytes up to whitespace, `{`, `}` or `=`.
    fn token(&mut self) -> Result<Span, ScanError> {
        let start = self.pos;
        if self.bytes[start] == b'"' {
            let Some(i) = memchr(b'"', &self.bytes[start + 1..]) else {
                return Err(self.err("unterminated quote"));
            };
            self.pos = start + 1 + i + 1;
            return Ok(Span::new(start, self.pos));
        }
        while let Some(b) = self.peek() {
            if is_separator(b) {
                break;
            }
            if self.mode == Mode::Script && b == b'#' {
                break;
            }
            self.pos += 1;
        }
        if self.pos == start {
            return Err(self.err("expected a token"));
        }
        Ok(Span::new(start, self.pos))
    }

    /// Skip whitespace and, in [`Mode::Script`], `#` comments running to the next `\n`.
    fn skip_ws(&mut self) {
        loop {
            while let Some(b) = self.peek() {
                if !is_ws(b) {
                    break;
                }
                self.pos += 1;
            }
            if self.mode == Mode::Script && self.peek() == Some(b'#') {
                self.pos = memchr(b'\n', &self.bytes[self.pos..])
                    .map_or(self.bytes.len(), |i| self.pos + i);
                continue;
            }
            break;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn err(&self, reason: &'static str) -> ScanError {
        ScanError {
            offset: self.pos,
            reason,
        }
    }
}

fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

/// Whether `b` ends a bare token: whitespace, a brace, `=` or an opening quote.
pub(crate) fn is_separator(b: u8) -> bool {
    is_ws(b) || matches!(b, b'{' | b'}' | b'=' | b'"')
}

fn parse_id(key: &[u8]) -> Option<u64> {
    if key.is_empty() || !key.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(key).ok()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &[u8] = b"\"quoted_key\"=\"1\"\nrandom={ 0 1 }\nlist={ 54 55 56 }\nmixed={ { 24 { intel=0 } } }\ntable=\n{\n\t0=\n\t{\n\t\tx=1 y=\"{\"\n\t}\n1=\n{\n\ta=\"b\" c=d\n}\n\t2={ }\n\t3=\n\t{\n\t}\n\tcount=3\n\t4=scalar\n\t5=\n\t{\n\t}\n\t6=\n\t}\nlast=\t\t\"v\"\n";

    fn text(span: Span) -> &'static str {
        std::str::from_utf8(span.slice(FIXTURE)).unwrap()
    }

    #[test]
    fn quirks_partition_the_fixture() {
        let index = scan(FIXTURE).unwrap();
        // The only residue is the non-numeric statement inside `table`.
        let gaps: Vec<_> = index
            .coverage_gaps(FIXTURE)
            .into_iter()
            .map(|g| text(g).trim())
            .collect();
        assert_eq!(gaps, ["count=3"]);
        let keys: Vec<_> = index
            .sections()
            .iter()
            .map(|s| key_name(FIXTURE, s))
            .collect();
        assert_eq!(
            keys,
            ["quoted_key", "random", "list", "mixed", "table", "last"]
        );

        let Value::Scalar(v) = index.section("quoted_key").unwrap().value else {
            panic!("scalar")
        };
        assert_eq!(text(v), "\"1\"");
        assert_eq!(
            text(index.section("random").unwrap().stmt),
            "random={ 0 1 }"
        );
        assert_eq!(
            text(index.section("mixed").unwrap().stmt),
            "mixed={ { 24 { intel=0 } } }"
        );
        let Value::Scalar(v) = index.section("last").unwrap().value else {
            panic!("scalar")
        };
        assert_eq!(text(v), "\"v\"");

        let ids: Vec<_> = index.entities("table").iter().map(|e| e.id).collect();
        assert_eq!(ids, [0, 1, 2, 3, 4, 5, 6]);
        assert_eq!(
            text(index.entity("table", 0).unwrap().stmt),
            "0=\n\t{\n\t\tx=1 y=\"{\"\n\t}"
        );
        assert_eq!(
            text(index.entity("table", 1).unwrap().stmt),
            "1=\n{\n\ta=\"b\" c=d\n}"
        );
        assert_eq!(text(index.entity("table", 2).unwrap().stmt), "2={ }");
        assert_eq!(text(index.entity("table", 3).unwrap().stmt), "3=\n\t{\n\t}");
        assert_eq!(text(index.entity("table", 5).unwrap().stmt), "5=\n\t{\n\t}");
        let four = index.entity("table", 4).unwrap();
        assert_eq!(text(four.stmt), "4=scalar");
        assert!(matches!(four.value, Value::Scalar(_)));
        // `6=` with no value before the closing brace: the empty scalar sits right
        // after the `=`, as in the CST, so the statement is exactly `6=`.
        let six = index.entity("table", 6).unwrap();
        assert_eq!(text(six.stmt), "6=");
        assert!(matches!(six.value, Value::Scalar(v) if v.is_empty()));
        assert!(index.entity("table", 7).is_none());
        assert!(index.entities("random").is_empty());
    }

    #[test]
    fn duplicate_keys_keep_file_order() {
        let src = b"a=1\nb={ }\na=\n{\n\t7={ }\n}\n";
        let index = scan(src).unwrap();
        let a: Vec<_> = index.sections_named("a").map(|s| s.stmt.start).collect();
        assert_eq!(a, [0, 10]);
        assert_eq!(index.entity("a", 7).map(|e| e.id), Some(7));
        assert!(index.coverage_gaps(src).is_empty());
    }

    #[test]
    fn errors_carry_offsets() {
        assert_eq!(
            scan(b"a={ b={ }").unwrap_err(),
            ScanError {
                offset: 2,
                reason: "unterminated block"
            }
        );
        assert_eq!(scan(b"a=\"x").unwrap_err().reason, "unterminated quote");
        assert_eq!(scan(b"}").unwrap_err().offset, 0);
        assert_eq!(scan(b"=1").unwrap_err().reason, "expected a token");
    }

    #[test]
    fn script_mode_skips_comments_around_and_inside_statements() {
        let src: &[u8] =
            b"# lead { a } \"q\"\nfoo=1\n# mid { b } \"q\"\nbar={\n\t# inner { c } \"q\"\n\tx=1\n}\n# tail { d } \"q\"\n";
        let index = scan_range_with(src, 0..src.len(), Mode::Script).unwrap();
        let text = |span: Span| std::str::from_utf8(span.slice(src)).unwrap();
        let keys: Vec<_> = index.sections().iter().map(|s| key_name(src, s)).collect();
        assert_eq!(keys, ["foo", "bar"]);
        assert_eq!(text(index.section("foo").unwrap().stmt), "foo=1");
        assert_eq!(
            text(index.section("bar").unwrap().stmt),
            "bar={\n\t# inner { c } \"q\"\n\tx=1\n}"
        );
    }

    #[test]
    fn script_mode_comment_after_a_hash_in_a_nested_quote() {
        let src: &[u8] =
            b"a = {\n\tb = { name = \"x#y\" }\n\tc = { d = 1 # } not a close\n\t}\n}\ne = 1\n";
        let index = scan_range_with(src, 0..src.len(), Mode::Script).unwrap();
        let text = |span: Span| std::str::from_utf8(span.slice(src)).unwrap();
        let keys: Vec<_> = index.sections().iter().map(|s| key_name(src, s)).collect();
        assert_eq!(keys, ["a", "e"]);
        assert_eq!(
            text(index.section("a").unwrap().stmt),
            "a = {\n\tb = { name = \"x#y\" }\n\tc = { d = 1 # } not a close\n\t}\n}"
        );
    }

    #[test]
    fn script_mode_trailing_comment_after_single_line_block() {
        let src: &[u8] = b"system = { id = \"1\" } # x } y\n";
        let index = scan_range_with(src, 0..src.len(), Mode::Script).unwrap();
        let text = |span: Span| std::str::from_utf8(span.slice(src)).unwrap();
        let section = index.section("system").unwrap();
        let Value::Block { close, .. } = section.value else {
            panic!("block")
        };
        assert_eq!(close, src.iter().position(|&b| b == b'}').unwrap());
        assert_eq!(text(section.stmt), "system = { id = \"1\" }");
    }

    #[test]
    fn script_mode_hash_inside_quotes_is_not_a_comment() {
        let text = |src: &'static [u8], span: Span| std::str::from_utf8(span.slice(src)).unwrap();

        let scalar: &[u8] = b"name = \"a#b\"\nnext=1\n";
        let index = scan_range_with(scalar, 0..scalar.len(), Mode::Script).unwrap();
        let Value::Scalar(v) = index.section("name").unwrap().value else {
            panic!("scalar")
        };
        assert_eq!(text(scalar, v), "\"a#b\"");
        assert!(index.section("next").is_some());

        let nested: &[u8] = b"outer={ inner={ x=\"a#b\" } } after=1\n";
        let index = scan_range_with(nested, 0..nested.len(), Mode::Script).unwrap();
        assert!(index.section("after").is_some());
    }

    #[test]
    fn save_mode_treats_hash_as_ordinary_text() {
        let src: &[u8] = b"a=1\n#override=99\nb=2\n";
        let script = scan_range_with(src, 0..src.len(), Mode::Script).unwrap();
        let save = scan_range_with(src, 0..src.len(), Mode::Save).unwrap();
        let script_keys: Vec<_> = script.sections().iter().map(|s| key_name(src, s)).collect();
        let save_keys: Vec<_> = save.sections().iter().map(|s| key_name(src, s)).collect();
        // The two modes agree everywhere but the comment: script mode skips it, save
        // mode reads `#override` as an ordinary key.
        assert_eq!(script_keys, ["a", "b"]);
        assert_eq!(save_keys, ["a", "#override", "b"]);
    }

    #[test]
    fn coverage_gaps_yields_comments_on_a_script() {
        let src: &[u8] = b"# lead\na=1\n# mid\nb=2\n# tail\n";
        let index = scan_range_with(src, 0..src.len(), Mode::Script).unwrap();
        let text = |span: Span| std::str::from_utf8(span.slice(src)).unwrap();
        let gaps: Vec<_> = index
            .coverage_gaps(src)
            .into_iter()
            .map(|g| text(g).trim())
            .collect();
        assert_eq!(gaps, ["# lead", "# mid", "# tail"]);
    }

    #[test]
    fn scenario_fixture_sections_and_entities() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testdata/scenario_grammar.txt"
        );
        let bytes = std::fs::read(path).unwrap();
        let outer = scan_range_with(&bytes, 0..bytes.len(), Mode::Script).unwrap();
        let root = outer.section("static_galaxy_scenario").unwrap();
        let Value::Block { open, close } = root.value else {
            panic!("block")
        };
        let index = scan_range_with(&bytes, open + 1..close, Mode::Script).unwrap();
        assert_eq!(index.sections_named("system").count(), 8);
        assert_eq!(index.sections_named("add_hyperlane").count(), 8);
        assert_eq!(index.sections_named("prevent_hyperlane").count(), 1);
        assert_eq!(index.sections_named("nebula").count(), 2);
        assert_eq!(index.sections_named("coordinate_transform").count(), 1);
        let starts: Vec<_> = index
            .sections_named("system")
            .map(|s| s.stmt.start)
            .collect();
        let mut sorted = starts.clone();
        sorted.sort_unstable();
        assert_eq!(starts, sorted);
    }
}
