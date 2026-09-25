//! Turning an op's decision into `.sav` bytes.
//!
//! The graph says what should change; this says how a save says it. A system's position
//! and every lane touching it live inside the two `galactic_object` entities, so a move
//! rewrites lengths on both ends, and a nebula's `galactic_object` member lines have to
//! be kept in step by hand.
//!
//! One module per op or per thing an op writes, each named for it.

pub(crate) mod add_system;
pub(crate) mod asteroid_names;
pub(crate) mod bulk;
pub(crate) mod deposits;
pub(crate) mod footprint;
pub(crate) mod game_tables;
pub(crate) mod initializer_counter;
pub(crate) mod lanes;
pub(crate) mod lgate;
pub(crate) mod map_colors;
pub(crate) mod move_system;
pub(crate) mod name_pool;
pub(crate) mod nebula;
pub(crate) mod planet_size;
pub(crate) mod remove_system;
pub(crate) mod rename_system;
pub(crate) mod replace_system;
pub(crate) mod star_class;
