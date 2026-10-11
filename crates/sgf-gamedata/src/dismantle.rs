//! What a megastructure type's `on_dismantle_complete` takes back: the modifiers and deposits
//! it removes from its system and the system's planets, and the variables it lowers on its
//! owner, the `from` country. Scripted effects it calls are followed with the parameters
//! they are given; conditions are not judged, so a removal behind an `if` counts.

use sgf_core::cst::Node;
use sgf_core::ops::{MegastructureDismantle, VariableDrop};

use crate::install::script::Def;
use crate::scripts::ScriptIndex;

/// How deep scripted effects calling scripted effects are followed.
const MAX_DEPTH: usize = 8;

/// The block of a type's definition that runs when it is dismantled.
const ON_DISMANTLE: &str = "on_dismantle_complete";

/// What `def`'s dismantle takes back, in the order the script names it, each once.
pub(crate) fn read(def: &Def, scripts: &ScriptIndex) -> MegastructureDismantle {
    let mut out = MegastructureDismantle::default();
    if let Some(block) = def.node.find(ON_DISMANTLE, &def.src) {
        let walk = Walk {
            scripts,
            params: &[],
            owner: false,
            depth: 0,
        };
        walk.block(block, &def.src, &mut out);
    }
    out
}

/// Where a walk stands: the parameters of the scripted effect it is in, whether its scope is
/// the owner, and how many effects deep it is.
struct Walk<'a> {
    scripts: &'a ScriptIndex,
    params: &'a [(String, String)],
    owner: bool,
    depth: usize,
}

impl Walk<'_> {
    fn block(&self, block: &Node, src: &[u8], out: &mut MegastructureDismantle) {
        for child in block.children() {
            let Some(key) = child.key_str(src) else {
                continue;
            };
            let key = self.substitute(key);
            let value = child.scalar_str(src).map(|v| self.substitute(v));
            match key.as_str() {
                "limit" => {}
                "remove_modifier" if !self.owner => once(&mut out.modifiers, value),
                "remove_deposit" if !self.owner => once(&mut out.deposits, value),
                "change_variable" | "subtract_variable" if self.owner => {
                    if let Some(drop) = self.lowered(&key, child, src)
                        && !out.variables.iter().any(|v| v.variable == drop.variable)
                    {
                        out.variables.push(drop);
                    }
                }
                "from" => self.owners().block(child, src, out),
                _ => match self.scripts.effect(&key) {
                    Some(effect) if self.depth < MAX_DEPTH => {
                        let params = self.arguments(child, src);
                        let inner = Walk {
                            scripts: self.scripts,
                            params: &params,
                            owner: self.owner,
                            depth: self.depth + 1,
                        };
                        inner.block(&effect.node, &effect.src, out);
                    }
                    _ if child.scalar_span().is_none() => self.block(child, src, out),
                    _ => {}
                },
            }
        }
    }

    /// The walk inside a `from` block, whose scope is the owner.
    fn owners(&self) -> Walk<'_> {
        Walk {
            scripts: self.scripts,
            params: self.params,
            owner: true,
            depth: self.depth,
        }
    }

    /// `change_variable = { which = v value = -n }` or `subtract_variable = { which = v
    /// value = n }` as a drop of a whole `n` above 0.
    fn lowered(&self, key: &str, node: &Node, src: &[u8]) -> Option<VariableDrop> {
        let field = |name: &str| {
            node.find(name, src)?
                .scalar_str(src)
                .map(|v| self.substitute(v))
        };
        let variable = field("which")?;
        let value: f64 = field("value")?.parse().ok()?;
        let by = if key == "change_variable" {
            -value
        } else {
            value
        };
        (by > 0.0 && by.fract() == 0.0 && by <= f64::from(u32::MAX)).then_some(VariableDrop {
            variable,
            by: by as u32,
        })
    }

    /// The parameters a call `name = { PARAM = value }` passes; none for `name = yes`.
    fn arguments(&self, call: &Node, src: &[u8]) -> Vec<(String, String)> {
        call.children()
            .iter()
            .filter_map(|arg| {
                let name = arg.key_str(src)?;
                let value = arg.scalar_str(src)?;
                Some((name.to_owned(), self.substitute(value)))
            })
            .collect()
    }

    /// `text` with each `$PARAM$` of the effect it stands in replaced by what the call passed.
    fn substitute(&self, text: &str) -> String {
        let mut out = text.to_owned();
        for (name, value) in self.params {
            out = out.replace(&format!("${name}$"), value);
        }
        out
    }
}

/// Add `value` to `list` unless it is missing, empty or listed.
fn once(list: &mut Vec<String>, value: Option<String>) {
    if let Some(value) = value.filter(|v| !v.is_empty())
        && !list.contains(&value)
    {
        list.push(value);
    }
}
