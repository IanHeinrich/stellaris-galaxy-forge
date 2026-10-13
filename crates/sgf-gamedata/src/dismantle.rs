//! What a megastructure type's `on_dismantle_complete` takes back: the modifiers and deposits
//! it removes from its system and the system's planets, and the variables it lowers on its
//! owner, the `from` country. It is walked as a construction is, through the scripted effects
//! it calls with the parameters they are given, but the events it fires are not followed and
//! conditions are not judged, so a removal behind an `if` counts.

use sgf_core::ops::{MegastructureDismantle, VariableDrop};

use crate::construction::{self, Effect, Met, Record};
use crate::install::script::Def;
use crate::install::walk::once;
use crate::scripts::ScriptIndex;

/// The block of a type's definition that runs when it is dismantled.
const ON_DISMANTLE: &str = "on_dismantle_complete";

/// What `def`'s dismantle takes back, in the order the script names it, each once.
pub(crate) fn read(def: &Def, scripts: &ScriptIndex) -> MegastructureDismantle {
    let mut out = MegastructureDismantle::default();
    for record in construction::record(def, ON_DISMANTLE, scripts, 0) {
        let Record::Effect(Met { effect, owner, .. }) = record else {
            continue;
        };
        match effect {
            Effect::RemoveModifier(modifier) if !owner => once(&mut out.modifiers, modifier),
            Effect::RemoveDeposit(deposit) if !owner => once(&mut out.deposits, deposit),
            Effect::ChangeVariable { variable, by } if owner => {
                let by = -by;
                if by > 0.0
                    && by.fract() == 0.0
                    && by <= f64::from(u32::MAX)
                    && !out.variables.iter().any(|v| v.variable == variable)
                {
                    out.variables.push(VariableDrop {
                        variable,
                        by: by as u32,
                    });
                }
            }
            _ => {}
        }
    }
    out
}
