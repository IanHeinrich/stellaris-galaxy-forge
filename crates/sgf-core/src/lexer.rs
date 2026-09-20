//! Tokenizer for one entity (or any slice) of `gamestate` text, and for
//! Paradox script files (`common/**/*.txt`, `interface/*.gfx`,
//! `flags/colors.txt`) read from the game install.
//!
//! Tokens carry absolute spans (`base + local offset`) and never own text.
//! Whitespace (space, tab, LF, CR) separates tokens and is otherwise
//! ignored. The save format has no comments and no escapes; script mode
//! additionally skips `#` comments and recognises comparison operators.

use crate::span::Span;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenKind {
    LBrace,
    RBrace,
    Eq,
    /// A comparison operator, script mode only. Parses like `Eq`.
    Cmp(CmpOp),
    /// A bare or quoted value. For a quoted scalar the span covers the quotes.
    Scalar {
        quoted: bool,
    },
}

/// A comparison operator recognised as a statement separator in script mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CmpOp {
    Lt,
    Le,
    Gt,
    Ge,
    Ne,
    /// `?=`.
    QuestionEq,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

/// Which dialect of Paradox script `tokens_with` reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// `gamestate` text: no comments, no comparison operators.
    Save,
    /// Game-install script files: `#` comments and `<`, `>`, `<=`, `>=`,
    /// `!=`, `?=` as statement separators; a leading UTF-8 BOM is skipped.
    Script,
}

/// Tokenize `bytes` in [`Mode::Save`], reporting spans offset by `base`.
///
/// A `"` starts a quoted scalar that ends at the next `"`; an unterminated
/// quote yields a scalar running to the end of input. Anything else that is
/// not whitespace or punctuation is an unquoted scalar running until
/// whitespace, `{`, `}`, `=` or `"`.
pub fn tokens(bytes: &[u8], base: usize) -> impl Iterator<Item = Token> + '_ {
    tokens_with(bytes, base, Mode::Save)
}

/// Tokenize `bytes` in the given `mode`, reporting spans offset by `base`.
///
/// See [`tokens`] for the base tokenizing rules. In [`Mode::Script`], a
/// leading UTF-8 BOM is skipped (spans still count from `base`), `#` starts
/// a comment running to end of line wherever a token could start, and `<`,
/// `>`, `<=`, `>=`, `!=`, `?=` are lexed as [`TokenKind::Cmp`] rather than
/// scalars.
pub fn tokens_with(bytes: &[u8], base: usize, mode: Mode) -> impl Iterator<Item = Token> + '_ {
    let (bytes, base) = match mode {
        Mode::Script if bytes.starts_with(b"\xEF\xBB\xBF") => (&bytes[3..], base + 3),
        _ => (bytes, base),
    };
    Lexer {
        bytes,
        pos: 0,
        base,
        mode,
    }
}

struct Lexer<'a> {
    bytes: &'a [u8],
    pos: usize,
    base: usize,
    mode: Mode,
}

const fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

// Script writes `key!=value` and `key?=value` unspaced, so a scalar ends before either.
fn ends_unquoted(mode: Mode, b: u8) -> bool {
    is_space(b)
        || matches!(b, b'{' | b'}' | b'=' | b'"')
        || (mode == Mode::Script && matches!(b, b'<' | b'>' | b'!' | b'?' | b'#'))
}

impl Lexer<'_> {
    /// Advance past whitespace and, in script mode, `#`-comments.
    fn skip_trivia(&mut self) {
        loop {
            while self.pos < self.bytes.len() && is_space(self.bytes[self.pos]) {
                self.pos += 1;
            }
            if self.mode == Mode::Script && self.bytes.get(self.pos) == Some(&b'#') {
                self.pos = match memchr::memchr(b'\n', &self.bytes[self.pos..]) {
                    Some(i) => self.pos + i,
                    None => self.bytes.len(),
                };
                continue;
            }
            break;
        }
    }
}

impl Iterator for Lexer<'_> {
    type Item = Token;

    fn next(&mut self) -> Option<Token> {
        self.skip_trivia();
        let start = self.pos;
        let b = *self.bytes.get(start)?;
        let next = self.bytes.get(start + 1).copied();
        let (kind, end) = match b {
            b'{' => (TokenKind::LBrace, start + 1),
            b'}' => (TokenKind::RBrace, start + 1),
            b'=' => (TokenKind::Eq, start + 1),
            b'<' if self.mode == Mode::Script && next == Some(b'=') => {
                (TokenKind::Cmp(CmpOp::Le), start + 2)
            }
            b'<' if self.mode == Mode::Script => (TokenKind::Cmp(CmpOp::Lt), start + 1),
            b'>' if self.mode == Mode::Script && next == Some(b'=') => {
                (TokenKind::Cmp(CmpOp::Ge), start + 2)
            }
            b'>' if self.mode == Mode::Script => (TokenKind::Cmp(CmpOp::Gt), start + 1),
            b'!' if self.mode == Mode::Script && next == Some(b'=') => {
                (TokenKind::Cmp(CmpOp::Ne), start + 2)
            }
            b'?' if self.mode == Mode::Script && next == Some(b'=') => {
                (TokenKind::Cmp(CmpOp::QuestionEq), start + 2)
            }
            b'"' => {
                let end = match memchr::memchr(b'"', &self.bytes[start + 1..]) {
                    Some(i) => start + 1 + i + 1,
                    None => self.bytes.len(),
                };
                (TokenKind::Scalar { quoted: true }, end)
            }
            _ => {
                let mut end = start + 1;
                while end < self.bytes.len() && !ends_unquoted(self.mode, self.bytes[end]) {
                    end += 1;
                }
                (TokenKind::Scalar { quoted: false }, end)
            }
        };
        self.pos = end;
        Some(Token {
            kind,
            span: Span::new(self.base + start, self.base + end),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lex(src: &[u8]) -> Vec<(TokenKind, &[u8])> {
        tokens(src, 0)
            .map(|t| (t.kind, t.span.slice(src)))
            .collect()
    }

    #[test]
    fn eq_glued_to_values_and_braces() {
        let src = b"a=b c={ 1 }d=\"x\"";
        let got = lex(src);
        let expected: Vec<(TokenKind, &[u8])> = vec![
            (TokenKind::Scalar { quoted: false }, b"a"),
            (TokenKind::Eq, b"="),
            (TokenKind::Scalar { quoted: false }, b"b"),
            (TokenKind::Scalar { quoted: false }, b"c"),
            (TokenKind::Eq, b"="),
            (TokenKind::LBrace, b"{"),
            (TokenKind::Scalar { quoted: false }, b"1"),
            (TokenKind::RBrace, b"}"),
            (TokenKind::Scalar { quoted: false }, b"d"),
            (TokenKind::Eq, b"="),
            (TokenKind::Scalar { quoted: true }, b"\"x\""),
        ];
        assert_eq!(got, expected);
    }

    #[test]
    fn unterminated_quote_runs_to_end_of_input() {
        let src = b"k=\"abc def\n}";
        let got = lex(src);
        assert_eq!(got.len(), 3);
        assert_eq!(
            got[2],
            (TokenKind::Scalar { quoted: true }, &b"\"abc def\n}"[..])
        );
    }

    #[test]
    fn cr_is_whitespace() {
        let src = b"a=1\r\nb=\"2\"\r";
        let got = lex(src);
        let expected: Vec<(TokenKind, &[u8])> = vec![
            (TokenKind::Scalar { quoted: false }, b"a"),
            (TokenKind::Eq, b"="),
            (TokenKind::Scalar { quoted: false }, b"1"),
            (TokenKind::Scalar { quoted: false }, b"b"),
            (TokenKind::Eq, b"="),
            (TokenKind::Scalar { quoted: true }, b"\"2\""),
        ];
        assert_eq!(got, expected);
    }

    #[test]
    fn spans_are_offset_by_base() {
        let src = b"\t x=1";
        let got: Vec<Span> = tokens(src, 100).map(|t| t.span).collect();
        assert_eq!(
            got,
            vec![
                Span::new(102, 103),
                Span::new(103, 104),
                Span::new(104, 105)
            ]
        );
    }

    #[test]
    fn empty_and_whitespace_only_input_yield_nothing() {
        assert!(tokens(b"", 0).next().is_none());
        assert!(tokens(b" \t\n\r", 0).next().is_none());
    }
}
