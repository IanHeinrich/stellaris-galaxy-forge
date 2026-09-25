//! Turning an op's decision into `.sav` bytes.
//!
//! The graph says what should change; this says how a save says it. A system's position
//! and every lane touching it live inside the two `galactic_object` entities, so a move
//! rewrites lengths on both ends, and a nebula's `galactic_object` member lines have to
//! be kept in step by hand.
//!
//! One module per feature: [`move_system`] for one system's position, [`lanes`] for the
//! hyperlane entries between them, [`bulk`] for the ops that take several at once,
//! [`nebula`] for the clouds over them, [`footprint`] for what a cloud leaves on each
//! system it covers, [`lgate`] for the L-Cluster outcome the global
//! flags hold, [`star_class`] for a system's star and its star bodies, [`planet_size`]
//! for the size of one planet or star body, [`map_colors`] for the colours an empire
//! paints its territory in, [`add_system`] for a whole new system with its bodies,
//! [`asteroid_names`] for the names its asteroids take, [`name_pool`] for the star,
//! black hole and nebula names new ones take, [`initializer_counter`] for
//! the count of its layout, [`remove_system`] for taking
//! one of those out again, [`deposits`] for one deposit added to or removed from a
//! planet, [`replace_system`] for rolling an added system's bodies again in place, and
//! [`rename_system`] for renaming it.

pub(crate) mod add_system;
pub(crate) mod asteroid_names;
pub(crate) mod bulk;
pub(crate) mod deposits;
pub(crate) mod footprint;
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
