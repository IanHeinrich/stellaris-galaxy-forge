//! `sgf add-body`: a planet or moon added to a system of a save, as given or rolled from the
//! install's rules.

use std::path::Path;

use sgf_core::ops::{NewBody, Op};
use sgf_core::session::Session;
use sgf_core::views::OrbitPlacement;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::generate;

use super::{Run, game_data, mutate};

/// The body to add and where it goes; with a roll, a class or size left out is drawn.
pub struct Body {
    pub system: u32,
    pub class: Option<String>,
    pub size: Option<u32>,
    pub moon_of: Option<u32>,
    pub at: OrbitPlacement,
    pub name: Option<String>,
    pub deposits: Vec<String>,
    pub ring: bool,
}

/// Add `body` as given.
pub fn given(sav: &Path, out: Option<&Path>, body: Body) -> Run {
    let spec = NewBody {
        class: body.class.ok_or("--class is needed without --roll")?,
        size: body.size.ok_or("--size is needed without --roll")?,
        moon_of: body.moon_of,
        name: body.name,
        deposits: body.deposits,
        ring: body.ring,
    };
    let op = Op::AddBody {
        system: body.system,
        spec,
        at: body.at,
    };
    mutate::run(sav, out, op)
}

/// Add `body` rolled from `seed`: its deposits, and any class or size not given, drawn as the
/// game's roll draws them.
pub fn rolled(sav: &Path, out: Option<&Path>, body: Body, seed: u64, opts: &LoadOptions) -> Run {
    let gd = game_data(opts)?;
    let session = Session::open(sav)?;
    let ask = generate::BodyAsk {
        system: body.system,
        parent: body.moon_of,
        class: body.class,
        size: body.size,
        at: body.at,
        name: body.name,
    };
    let op = generate::body_for_save(&gd, &session, seed, ask)?;
    mutate::apply_all(session, out, vec![op])
}
