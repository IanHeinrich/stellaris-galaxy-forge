//! `common/scripted_triggers`: named conditions a script calls with `name = yes` or
//! `name = no`, each compiled to the [`Condition`] a call is judged by.

use crate::condition::Condition;
use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type ScriptedTriggers = Registry<ScriptedTrigger>;

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedTrigger {
    pub key: String,
    pub condition: Condition,
    /// The DLC a trigger that checks nothing but `host_has_dlc = "…"` names, as the save's
    /// `required_dlcs` names it.
    pub host_dlc: Option<String>,
}

impl FromDef for ScriptedTrigger {
    const DIR: &'static str = "common/scripted_triggers";

    fn read(key: String, def: &Def) -> Self {
        let condition = if parameterised(def) {
            Condition::Unknown(key.clone())
        } else {
            Condition::of_def(&def.node, def)
        };
        let host_dlc = match &condition {
            Condition::All(checks) => match checks.as_slice() {
                [Condition::HostDlc(dlc)] => Some(dlc.clone()),
                _ => None,
            },
            _ => None,
        };
        Self {
            key,
            condition,
            host_dlc,
        }
    }
}

/// A trigger written for `$PARAM$` substitution or `[[PARAM] ... ]` sections, whose meaning
/// depends on what the caller passes.
fn parameterised(def: &Def) -> bool {
    let body = def.node.value_span().slice(&def.src);
    body.contains(&b'$') || body.windows(2).any(|w| w == b"[[")
}
