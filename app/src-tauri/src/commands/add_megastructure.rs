//! Adding a megastructure of any type the install and its mods define to a system of the
//! open save, placed as its type says.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{MegastructureConstruction, MegastructurePlace, NewBypass, Op};
use sgf_core::session::Session;
use sgf_core::views::{ErrorKind, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::construction::PlanetChange;
use sgf_gamedata::registries::megastructures::{MegastructureDef, Placement, Unsupported};
use tauri::{AppHandle, Runtime};

use super::{game_data, is_save, require, with_session};
use crate::views::AddedMegastructure;

const ONLY_A_SAVE_ADDS: &str = "only a save takes an added megastructure";

/// Add a finished megastructure of type `kind` to system `system` of the open save as one
/// `AddMegastructure`, at `place`, owned by the system's owner, as the game makes it on load.
/// A gateway or relay gets its bypass, open when the type opens it, a type whose build marks
/// its planet marks it, and an Orbital Ring ruin flags its planet as the game does. The timed
/// modifiers, deposits and owner counters its build chain adds in that system are written
/// with it. The answer lists the chain's effects that were left out: those the editor could
/// not tell apply, and those that apply but that it does not write. A type whose chain
/// changes the class or size of its planet changes the planet too, as the game does, in the
/// same edit; with `keep_planet` the planet stays as it is. A type built only around a star
/// is refused on any other body. A type the install does not define, or one the editor does
/// not add, is refused with the reason.
#[tauri::command]
pub async fn add_megastructure<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    kind: String,
    place: MegastructurePlace,
    keep_planet: Option<bool>,
) -> Result<AddedMegastructure, SgfError> {
    let gd = game_data(&app, "add a megastructure")?;
    let def = gd.megastructures.get(&kind).ok_or_else(|| {
        SgfError::new(
            ErrorKind::Op,
            format!("the install and its mods define no megastructure {kind}"),
        )
    })?;
    check_place(def, place)?;
    let def = def.clone();
    let host = match place {
        MegastructurePlace::Body { body } | MegastructurePlace::Beside { body, .. } => Some(body),
        MegastructurePlace::Free { .. } => None,
    };
    let change = match (host, &def.planet_change, keep_planet) {
        (Some(body), Some(change), None | Some(false)) => Some((body, change.clone())),
        _ => None,
    };
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), is_save, ONLY_A_SAVE_ADDS)?;
        let owner = session
            .graph()
            .systems
            .get(&system)
            .and_then(|node| node.owner);
        let site = session.construction_site(system)?;
        let built = match change {
            Some(_) => def
                .construction
                .replay_changing_planet(&gd, &site, host, owner.is_some()),
            None => def.construction.replay(&gd, &site, host, owner.is_some()),
        };
        let left_out = built.unsure.len() + built.unwritten.len();
        let add = add_op(&def, system, place, owner, built.construction, left_out);
        let op = match change {
            Some((body, change)) => with_planet_change(session, &gd, &def.key, body, &change, add)?,
            None => add,
        };
        let result = session.apply(op)?;
        let removed = match &result.inverse {
            Op::Batch { ops, .. } => ops.iter().find_map(added_row),
            inverse => added_row(inverse),
        };
        let Some(megastructure) = removed else {
            return Err(SgfError::new(
                ErrorKind::Op,
                "the add named no new megastructure",
            ));
        };
        Ok(AddedMegastructure {
            edit: session.edit_result(result),
            megastructure,
            unsure: built.unsure,
            unwritten: built.unwritten,
        })
    })
    .await
}

fn added_row(inverse: &Op) -> Option<u32> {
    match inverse {
        Op::RemoveMegastructure { megastructure, .. } => Some(*megastructure),
        _ => None,
    }
}

/// `add` with planet `body` given the class and size `change` names, as one edit. The class
/// and size go first: the core changes no class of a planet that has a megastructure, and
/// the planet ends the same either way. A class or size the planet has already is left out,
/// and so is the batch when nothing else is left.
fn with_planet_change(
    session: &Session,
    gd: &GameData,
    kind: &str,
    body: u32,
    change: &PlanetChange,
    add: Op,
) -> Result<Op, SgfError> {
    let planet = get_planet_page(session.doc(), body)
        .map_err(|e| SgfError::new(ErrorKind::Op, e.to_string()))?;
    let rule = |class: &str| {
        gd.planet_class_rule(class).ok_or_else(|| {
            SgfError::new(
                ErrorKind::Op,
                format!("the install has no planet class {class}"),
            )
        })
    };
    let mut ops = Vec::new();
    let class = change
        .class
        .as_deref()
        .filter(|&class| class != planet.class);
    if let Some(class) = class {
        ops.push(Op::SetBodyClass {
            body,
            from: rule(&planet.class)?,
            to: rule(class)?,
            look: None,
        });
    }
    let size = change.size.filter(|&size| planet.size != Some(size));
    if let Some(size) = size {
        ops.push(Op::SetBodySize { body, size });
    }
    if ops.is_empty() {
        return Ok(add);
    }
    ops.push(add);
    let class_name = class.map(|class| gd.loc.name_or_readable(class));
    let description = session.megastructure_planet_change_description(
        &gd.loc.name_or_readable(kind),
        body,
        class_name.as_deref(),
        size,
    )?;
    Ok(Op::Batch { description, ops })
}

/// Refuse a type the editor does not add, or one whose placement `place` does not match.
fn check_place(def: &MegastructureDef, place: MegastructurePlace) -> Result<(), SgfError> {
    let refuse = |reason: String| {
        SgfError::new(
            ErrorKind::Op,
            format!("a {} cannot be added: {reason}", def.key),
        )
    };
    match (&def.placement, place) {
        (Placement::Unsupported { why }, _) => Err(refuse(unsupported(why))),
        (Placement::Body { .. }, MegastructurePlace::Free { .. }) => {
            Err(refuse("it stands on or around a planet or star".to_owned()))
        }
        (
            Placement::Free { .. },
            MegastructurePlace::Body { .. } | MegastructurePlace::Beside { .. },
        ) => Err(refuse("it stands at a point of its own".to_owned())),
        _ => Ok(()),
    }
}

/// The op that adds a row of type `def` at `place`, with what its construction adds and how
/// many of its effects were left out.
fn add_op(
    def: &MegastructureDef,
    system: u32,
    place: MegastructurePlace,
    owner: Option<u32>,
    construction: MegastructureConstruction,
    left_out: usize,
) -> Op {
    let bypass = def.bypass_type.as_ref().map(|kind| NewBypass {
        kind: kind.clone(),
        active: kind == "relay_bypass" || def.activates_gateway,
    });
    Op::AddMegastructure {
        system,
        kind: def.key.clone(),
        name: None,
        at: place,
        owner,
        bypass,
        ruined_orbital_ring: def.ruined_orbital_ring,
        megastructure_flag: def.sets_has_megastructure,
        orbital_flag: false,
        star_only: matches!(def.placement, Placement::Body { star_only: true }),
        construction: (!construction.is_empty()).then_some(construction),
        left_out: u32::try_from(left_out).unwrap_or(u32::MAX),
    }
}

fn unsupported(why: &Unsupported) -> String {
    match why {
        Unsupported::Bypass { bypass } => {
            format!("it stands for a {bypass} bypass, which has not been tried in game")
        }
        Unsupported::RingWorld => {
            "a ring world past its site is several rows and planets, added as a whole ring world"
                .to_owned()
        }
        Unsupported::BecomesStarbase => {
            "building it makes a starbase, which the editor does not write".to_owned()
        }
        Unsupported::ChangesBody => {
            "it changes the class or size of its planet in a way the editor cannot tell".to_owned()
        }
        Unsupported::FixedClass { class } => {
            format!("it makes its planet a {class}, which the editor gives no planet")
        }
        Unsupported::WholeStructure { .. } => {
            "it is built with more planets or sections, which the editor does not write".to_owned()
        }
    }
}
