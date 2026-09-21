//! Reading a header field as a number, for the few keys the checks compare as counts.

use crate::cst;
use crate::scan;

use super::HeaderField;

/// The first `key`, which is the one the game reads.
fn first<'a>(fields: &'a [HeaderField], key: &str) -> Option<&'a HeaderField> {
    fields.iter().find(|f| f.key == key)
}

/// The first `key` as a whole number; `None` when it is absent, a block, or not one.
pub(super) fn count(fields: &[HeaderField], key: &str) -> Option<u32> {
    let value = &first(fields, key)?.value;
    if value.starts_with('{') {
        return None;
    }
    String::from_utf8_lossy(scan::unquote(value.as_bytes()))
        .parse()
        .ok()
}

/// `field` inside the first `key = { … }` as a whole number, read from the raw text.
pub(super) fn block_count(fields: &[HeaderField], key: &str, field: &str) -> Option<u32> {
    let text = format!("{key} = {}", first(fields, key)?.value);
    let bytes = text.as_bytes();
    let root = cst::parse_script(bytes, 0).ok()?;
    let node = root.children().first()?;
    node.find(field, bytes)?.scalar_str(bytes)?.parse().ok()
}
