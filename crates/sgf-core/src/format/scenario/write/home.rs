//! What makes the game treat a plain scenario's system as an empire's home: the statements
//! of its `effect` block that [`HOME_SYSTEM_EFFECT`] lists.

use super::flags::rewrite_statements;
use crate::format::scenario::{HOME_SYSTEM_EFFECT, is_home_system_statement};
use crate::ops::rules::named;
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::session::Session;

pub(super) fn set_home_system(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    home: bool,
) -> Result<Planned, OpError> {
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let name = named(&s.graph, id);
    if system.home_system == home {
        let state = match home {
            true => "is already an empire's home system",
            false => "is no empire's home system",
        };
        return Err(OpError::unchanged(name, state));
    }
    write_home_system(plan.edit(&s.doc, id)?, home)?;
    let description = match home {
        true => format!("Marked {name} as an empire's home system"),
        false => format!("Took the empire's home system mark off {name}"),
    };
    Ok(Planned {
        description,
        inverse: Op::SetHomeSystem {
            system: id,
            home: !home,
        },
    })
}

/// Write every statement of [`HOME_SYSTEM_EFFECT`] at the end of the system's `effect`
/// block, or take them out, leaving the block's other statements as they are. A copy of
/// one already standing, or an earlier form of it, is taken out first, so the block never
/// holds two.
fn write_home_system(edit: &mut Edit, home: bool) -> Result<(), OpError> {
    let statements: Vec<String> = match home {
        true => HOME_SYSTEM_EFFECT.map(str::to_owned).to_vec(),
        false => Vec::new(),
    };
    rewrite_statements(edit, is_home_system_statement, &statements)
}
