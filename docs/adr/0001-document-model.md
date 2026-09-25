# ADR 0001: Edit the save as bytes with a patch overlay

Accepted

## Context

A save is 20 to 300 MB of Clausewitz text with duplicate keys, order-sensitive sections and content from
mods and later patches it does not model. What the editor does not change must return byte for byte.

## Decision

The original `gamestate` bytes are held once and never modified; one pass counts braces, not indentation,
indexing every top-level statement and the id-keyed blocks below them. An edit becomes an overlay slot, one
per edited statement: it replaces a span of the original, `Anchor::Original(Span)`, or holds inserted text,
`Anchor::Inserted { at, seq }`. Slots are keyed by `(start, seq)`, the emission order, so saving is one
forward pass streaming original gaps and slot contents into a new file, renaming whatever stood there to
`<name>.bak-YYYYmmdd-HHMMSS` before moving it into place. An op parses only the statement it touches, splices
it back into the slot at that statement's indentation and carries an inverse, so undo and redo replay bytes.

## Consequences

- Open and save with no edits is byte-identical: `each_sample_is_partitioned_with_no_residue_and_saves_back_byte_for_byte` asserts it.
- Memory is about the file size plus the index, and save time is deflate time.
- Projections are caches, rebuilt from the bytes and never written back, so what they omit cannot be edited.
