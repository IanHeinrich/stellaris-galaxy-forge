//! Byte ranges into the original `gamestate` buffer.

use std::ops::Range;

/// A half-open byte range `[start, end)` into the original file bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub const fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end);
        Self { start, end }
    }

    pub const fn len(&self) -> usize {
        self.end - self.start
    }

    pub const fn is_empty(&self) -> bool {
        self.start == self.end
    }

    pub fn slice<'a>(&self, src: &'a [u8]) -> &'a [u8] {
        &src[self.start..self.end]
    }

    pub const fn range(&self) -> Range<usize> {
        self.start..self.end
    }

    /// Shift both ends by `base` (used when a slot-relative span becomes absolute).
    pub const fn offset(&self, base: usize) -> Self {
        Self {
            start: self.start + base,
            end: self.end + base,
        }
    }
}

impl From<Range<usize>> for Span {
    fn from(r: Range<usize>) -> Self {
        Self::new(r.start, r.end)
    }
}
