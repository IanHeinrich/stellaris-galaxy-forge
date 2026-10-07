//! `sgf copy-planet`: save planets copied with their moons and pasted as new bodies.

use std::path::Path;

use sgf_core::session::Session;
use sgf_core::views::OrbitPlacement;

use super::{Run, mutate};

/// Copy `bodies` from `from`, or from `sav` itself, and paste them into system `to` of `sav`.
pub fn run(
    sav: &Path,
    out: Option<&Path>,
    from: Option<&Path>,
    bodies: &[u32],
    to: u32,
    at: Option<(f64, f64)>,
) -> Run {
    let session = Session::open(sav)?;
    let copies = match from {
        Some(source) => Session::open(source)?.copy_bodies(bodies)?,
        None => session.copy_bodies(bodies)?,
    };
    let at = at.map(|(radius, angle)| OrbitPlacement { radius, angle });
    let op = session.paste_bodies_op(to, &copies, at)?;
    mutate::apply_all(session, out, vec![op])
}
