//! Turning an op's decision into `.sav` bytes.
//!
//! The graph says what should change; this says how a save says it. A system's position
//! and every lane touching it live inside the two `galactic_object` entities, so a move
//! rewrites lengths on both ends, and a nebula's `galactic_object` member lines have to
//! be kept in step by hand.
//!
//! One module per feature: [`move_system`] for one system's position, [`lanes`] for the
//! hyperlane entries between them, [`bulk`] for the ops that take several at once, and
//! [`nebula`] for the clouds over them.

pub(crate) mod bulk;
pub(crate) mod lanes;
pub(crate) mod move_system;
pub(crate) mod nebula;
