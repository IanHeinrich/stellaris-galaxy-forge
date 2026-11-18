//! What a scenario system's last `effect` block places, as the ops address it: each ruin and
//! ambient object by an id read from the bytes, and whether the editor edits it in place.
//!
//! The id of a system's `n`th ruin, or `n`th ambient object, is read from where it stands, so
//! it is the same whatever the undo history holds: an edit of another system, a move and an
//! add keep it, and only taking out an earlier one of the same system moves it down one. The
//! ids stand clear of every synthetic id the details give a scenario's initializer bodies and
//! structures, and of every real one.

use crate::placements::{self, Statement};

/// The first synthetic id the details give the bodies an initializer spawns, counted from 0
/// in each system. Every synthetic range of a scenario's details is laid out here, far above
/// any id a save or a scenario writes, so that none of them meets another.
pub const PLANET_BASE: u32 = 0x4000_0000;
/// The first synthetic id of the megastructures an initializer places, counted from 0 in
/// each system.
pub const MEGASTRUCTURE_BASE: u32 = 0x5000_0000;
/// The first ruin id an effect block's statements give, in the space of megastructure ids.
pub const RUIN_BASE: u32 = 0x5800_0000;
/// The first synthetic id of the dig sites an initializer's bodies carry.
pub const SITE_BASE: u32 = 0x6000_0000;
/// A system's starbase goes by this id plus the system's.
pub const STARBASE_BASE: u32 = 0x7000_0000;
/// The first ambient object id an effect block's statements give.
pub const AMBIENT_OBJECT_BASE: u32 = 0x7800_0000;
/// The id an op names a scenario system's main star by: the details give an initializer's
/// first body, its star, the first planet id.
pub const STAR_BODY: u32 = PLANET_BASE;
/// How many ruins, or ambient objects, of one system take an id.
pub const PER_SYSTEM: u32 = 64;
/// The systems whose ruins and ambient objects take ids: those with a lower id.
pub const SYSTEMS: u32 = 0x0800_0000 / PER_SYSTEM;

// Each range ends below the next for every system that takes an id.
const _: () = {
    let span = SYSTEMS * PER_SYSTEM;
    assert!(PLANET_BASE < MEGASTRUCTURE_BASE && MEGASTRUCTURE_BASE < RUIN_BASE);
    assert!(RUIN_BASE + span <= SITE_BASE && SITE_BASE < STARBASE_BASE);
    assert!(STARBASE_BASE + SYSTEMS <= AMBIENT_OBJECT_BASE);
    assert!(AMBIENT_OBJECT_BASE.checked_add(span).is_some());
};

/// What one statement of the block places: the statement, its id when it is a ruin or an
/// ambient object that takes one, and whether the editor edits it where it stands.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    pub statement: Statement,
    pub id: Option<u32>,
    pub adopted: bool,
}

/// The statements of system `system`'s last `effect` block, read from `src`, as [`Placed`].
pub fn placed(system: u32, statements: Vec<Statement>, src: &[u8]) -> Vec<Placed> {
    let (mut ruins, mut objects) = (0, 0);
    statements
        .into_iter()
        .map(|statement| {
            let counter = match &statement {
                Statement::SpawnMegastructure(_) => Some((RUIN_BASE, &mut ruins)),
                Statement::AmbientObject(_) => Some((AMBIENT_OBJECT_BASE, &mut objects)),
                Statement::SystemModifier(_) | Statement::Foreign(_) => None,
            };
            let id = counter.and_then(|(base, n)| {
                *n += 1;
                id(base, system, *n - 1)
            });
            Placed {
                adopted: placements::adopted(&statement, src),
                statement,
                id,
            }
        })
        .collect()
}

/// The id of system `system`'s `n`th ruin, when it takes one.
pub fn ruin_id(system: u32, n: usize) -> Option<u32> {
    id(RUIN_BASE, system, n)
}

/// The id of system `system`'s `n`th ambient object, when it takes one.
pub fn ambient_object_id(system: u32, n: usize) -> Option<u32> {
    id(AMBIENT_OBJECT_BASE, system, n)
}

/// The system and place in its list of ruin `id`, when it is one.
pub fn ruin(id: u32) -> Option<(u32, usize)> {
    of(RUIN_BASE, id)
}

/// The system and place in its list of ambient object `id`, when it is one.
pub fn ambient_object(id: u32) -> Option<(u32, usize)> {
    of(AMBIENT_OBJECT_BASE, id)
}

fn id(base: u32, system: u32, n: usize) -> Option<u32> {
    let n = u32::try_from(n).ok().filter(|&n| n < PER_SYSTEM)?;
    (system < SYSTEMS).then(|| base + system * PER_SYSTEM + n)
}

fn of(base: u32, id: u32) -> Option<(u32, usize)> {
    let offset = id.checked_sub(base).filter(|&o| o < SYSTEMS * PER_SYSTEM)?;
    Some((offset / PER_SYSTEM, (offset % PER_SYSTEM) as usize))
}
