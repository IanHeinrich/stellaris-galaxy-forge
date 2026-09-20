//! Concrete syntax tree for one entity (or any block body) of `gamestate`.
//!
//! Nodes hold spans into the source bytes, never text; every accessor that
//! needs text takes the source explicitly. Structure comes from brace
//! counting only; indentation is never consulted.

use crate::lexer::{self, Mode, Token, TokenKind};
use crate::span::Span;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    /// `None` for list items and anonymous blocks.
    pub key: Option<Span>,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    /// A bare or quoted scalar; empty when `key=` has no value before `}`.
    Scalar(Span),
    Block {
        open: Span,
        children: Vec<Node>,
        close: Span,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{reason} at byte {offset}")]
pub struct CstError {
    /// Absolute offset of the offending token.
    pub offset: usize,
    pub reason: &'static str,
}

/// Parse `bytes` (one statement or a whole block body) with spans offset by `base`.
///
/// The result is always a synthetic root `Node { key: None, value: Block }`
/// whose `open` and `close` spans are empty at the two ends of the input and
/// whose children are the top-level statements. Input wrapped in its own
/// braces therefore yields a root with one anonymous block child.
pub fn parse(bytes: &[u8], base: usize) -> Result<Node, CstError> {
    parse_with(bytes, base, Mode::Save)
}

/// Parse a Paradox script file (`common/**/*.txt`, `interface/*.gfx`,
/// `flags/colors.txt`) with spans offset by `base`.
///
/// Comments and comparison operators (`<`, `>`, `<=`, `>=`, `!=`, `?=`) are
/// handled as [`Mode::Script`] describes. A bare scalar immediately followed
/// by `{` (no `=`, e.g. `hsv { 0.59 0.45 0.95 }`) becomes a node whose key is
/// that scalar and whose value is the block; when this occurs as the value
/// of `key = `, the result is `key = { <that node> }` with a synthetic
/// (empty) outer block span, matching how the game reads it.
pub fn parse_script(bytes: &[u8], base: usize) -> Result<Node, CstError> {
    parse_with(bytes, base, Mode::Script)
}

fn parse_with(bytes: &[u8], base: usize, mode: Mode) -> Result<Node, CstError> {
    let mut parser = Parser {
        stack: vec![Frame {
            key: None,
            open: Span::new(base, base),
            children: Vec::new(),
            auto_close: false,
        }],
        pending: Pending::None,
        mode,
    };
    for token in lexer::tokens_with(bytes, base, mode) {
        parser.push(token)?;
    }
    let end = base + bytes.len();
    parser.flush_pending();
    if parser.stack.len() > 1 {
        let open = parser.stack.last().map_or(base, |f| f.open.start);
        return Err(CstError {
            offset: open,
            reason: "unclosed '{'",
        });
    }
    let root = parser.stack.pop().expect("root frame is never popped");
    Ok(root.close(Span::new(end, end)))
}

struct Frame {
    key: Option<Span>,
    open: Span,
    children: Vec<Node>,
    /// Script mode only: set on the synthetic wrapper opened for
    /// `key = scalar { … }`, closed automatically (with no `}` of its own)
    /// right after its one child, rather than by a real `RBrace` token.
    auto_close: bool,
}

impl Frame {
    fn close(self, close: Span) -> Node {
        Node {
            key: self.key,
            value: Value::Block {
                open: self.open,
                children: self.children,
                close,
            },
        }
    }
}

enum Pending {
    None,
    /// A scalar seen; it becomes a key if `=` follows, else a list item,
    /// or, in script mode, a keyed block if `{` follows.
    Scalar(Span),
    /// `key=` seen; a value must follow.
    Keyed {
        key: Span,
        eq_end: usize,
    },
    /// Script mode only: `key = value` seen; `value` becomes the key of a
    /// nested block if `{` follows, else it is `key`'s plain scalar value.
    ValueScalar {
        key: Span,
        value: Span,
    },
}

struct Parser {
    stack: Vec<Frame>,
    pending: Pending,
    mode: Mode,
}

impl Parser {
    fn emit(&mut self, node: Node) {
        if let Some(frame) = self.stack.last_mut() {
            frame.children.push(node);
        }
    }

    /// Resolve whatever is pending before `{`, `}` or end of input. A `key=`
    /// with no value becomes an empty scalar placed just after the `=`.
    fn flush_pending(&mut self) {
        match std::mem::replace(&mut self.pending, Pending::None) {
            Pending::None => {}
            Pending::Scalar(span) => self.emit(Node {
                key: None,
                value: Value::Scalar(span),
            }),
            Pending::Keyed { key, eq_end } => {
                self.emit(Node {
                    key: Some(key),
                    value: Value::Scalar(Span::new(eq_end, eq_end)),
                });
            }
            Pending::ValueScalar { key, value } => self.emit(Node {
                key: Some(key),
                value: Value::Scalar(value),
            }),
        }
    }

    fn push(&mut self, token: Token) -> Result<(), CstError> {
        let span = token.span;
        match token.kind {
            TokenKind::Scalar { .. } => match std::mem::replace(&mut self.pending, Pending::None) {
                Pending::None => self.pending = Pending::Scalar(span),
                Pending::Scalar(prev) => {
                    self.emit(Node {
                        key: None,
                        value: Value::Scalar(prev),
                    });
                    self.pending = Pending::Scalar(span);
                }
                Pending::Keyed { key, .. } => {
                    if self.mode == Mode::Script {
                        self.pending = Pending::ValueScalar { key, value: span };
                    } else {
                        self.emit(Node {
                            key: Some(key),
                            value: Value::Scalar(span),
                        });
                    }
                }
                Pending::ValueScalar { key, value } => {
                    self.emit(Node {
                        key: Some(key),
                        value: Value::Scalar(value),
                    });
                    self.pending = Pending::Scalar(span);
                }
            },
            TokenKind::Eq | TokenKind::Cmp(_) => {
                match std::mem::replace(&mut self.pending, Pending::None) {
                    Pending::Scalar(key) => {
                        self.pending = Pending::Keyed {
                            key,
                            eq_end: span.end,
                        }
                    }
                    Pending::None => {
                        return Err(CstError {
                            offset: span.start,
                            reason: "'=' without a key",
                        });
                    }
                    Pending::Keyed { .. } => {
                        return Err(CstError {
                            offset: span.start,
                            reason: "'=' after '='",
                        });
                    }
                    Pending::ValueScalar { .. } => {
                        return Err(CstError {
                            offset: span.start,
                            reason: "'=' after value",
                        });
                    }
                }
            }
            TokenKind::LBrace => match std::mem::replace(&mut self.pending, Pending::None) {
                Pending::None => self.stack.push(Frame {
                    key: None,
                    open: span,
                    children: Vec::new(),
                    auto_close: false,
                }),
                Pending::Scalar(prev) => {
                    if self.mode == Mode::Script {
                        self.stack.push(Frame {
                            key: Some(prev),
                            open: span,
                            children: Vec::new(),
                            auto_close: false,
                        });
                    } else {
                        self.emit(Node {
                            key: None,
                            value: Value::Scalar(prev),
                        });
                        self.stack.push(Frame {
                            key: None,
                            open: span,
                            children: Vec::new(),
                            auto_close: false,
                        });
                    }
                }
                Pending::Keyed { key, .. } => self.stack.push(Frame {
                    key: Some(key),
                    open: span,
                    children: Vec::new(),
                    auto_close: false,
                }),
                Pending::ValueScalar { key, value } => {
                    self.stack.push(Frame {
                        key: Some(key),
                        open: Span::new(value.start, value.start),
                        children: Vec::new(),
                        auto_close: true,
                    });
                    self.stack.push(Frame {
                        key: Some(value),
                        open: span,
                        children: Vec::new(),
                        auto_close: false,
                    });
                }
            },
            TokenKind::RBrace => {
                self.flush_pending();
                if self.stack.len() < 2 {
                    return Err(CstError {
                        offset: span.start,
                        reason: "unbalanced '}'",
                    });
                }
                let frame = self.stack.pop().expect("stack has at least two frames");
                let mut node = frame.close(span);
                while self.stack.last().is_some_and(|f| f.auto_close) {
                    let wrapper = self.stack.pop().expect("just checked last()");
                    node = Node {
                        key: wrapper.key,
                        value: Value::Block {
                            open: wrapper.open,
                            children: vec![node],
                            close: span,
                        },
                    };
                }
                self.emit(node);
            }
        }
        Ok(())
    }
}

impl Node {
    pub fn children(&self) -> &[Node] {
        match &self.value {
            Value::Block { children, .. } => children,
            Value::Scalar(_) => &[],
        }
    }

    /// First child whose (unquoted) key equals `key`.
    pub fn find(&self, key: &str, src: &[u8]) -> Option<&Node> {
        self.children()
            .iter()
            .find(|c| c.key_bytes(src) == Some(key.as_bytes()))
    }

    /// Every child whose (unquoted) key equals `key`, in file order.
    pub fn find_all<'n>(
        &'n self,
        key: &'n str,
        src: &'n [u8],
    ) -> impl Iterator<Item = &'n Node> + 'n {
        self.children()
            .iter()
            .filter(move |c| c.key_bytes(src) == Some(key.as_bytes()))
    }

    /// The scalar text with quotes stripped; `None` for blocks or non-UTF-8.
    pub fn scalar_str<'a>(&self, src: &'a [u8]) -> Option<&'a str> {
        let span = self.scalar_span()?;
        std::str::from_utf8(unquote(span.slice(src))).ok()
    }

    /// The scalar's span including quotes; `None` for blocks.
    pub const fn scalar_span(&self) -> Option<Span> {
        match self.value {
            Value::Scalar(span) => Some(span),
            Value::Block { .. } => None,
        }
    }

    /// The key text with quotes stripped; `None` for anonymous nodes or non-UTF-8.
    pub fn key_str<'a>(&self, src: &'a [u8]) -> Option<&'a str> {
        std::str::from_utf8(self.key_bytes(src)?).ok()
    }

    fn key_bytes<'a>(&self, src: &'a [u8]) -> Option<&'a [u8]> {
        self.key.map(|k| unquote(k.slice(src)))
    }

    /// The value's own span: the scalar, or `{` through `}` for a block.
    pub const fn value_span(&self) -> Span {
        match &self.value {
            Value::Scalar(span) => *span,
            Value::Block { open, close, .. } => Span::new(open.start, close.end),
        }
    }

    /// The whole statement: from the key's start (or the value's, when
    /// anonymous) to the value's end.
    pub const fn span(&self) -> Span {
        let value = self.value_span();
        match self.key {
            Some(key) => Span::new(key.start, value.end),
            None => value,
        }
    }
}

fn unquote(bytes: &[u8]) -> &[u8] {
    match bytes {
        [b'"', inner @ .., b'"'] => inner,
        _ => bytes,
    }
}

/// Offset of the first byte of the line containing `offset`.
pub fn line_start(src: &[u8], offset: usize) -> usize {
    let offset = offset.min(src.len());
    memchr::memrchr(b'\n', &src[..offset]).map_or(0, |i| i + 1)
}

/// Offset just past the next `\n` at or after `offset`, or `src.len()`.
pub fn line_end(src: &[u8], offset: usize) -> usize {
    let offset = offset.min(src.len());
    memchr::memchr(b'\n', &src[offset..]).map_or(src.len(), |i| offset + i + 1)
}

/// The run of tabs and spaces at the start of the line containing `offset`.
pub fn indent_of(src: &[u8], offset: usize) -> &[u8] {
    let start = line_start(src, offset);
    let len = src[start..]
        .iter()
        .take_while(|&&b| b == b'\t' || b == b' ')
        .count();
    &src[start..start + len]
}
