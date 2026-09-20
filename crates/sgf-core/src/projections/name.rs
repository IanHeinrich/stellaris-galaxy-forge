//! Names as the save writes them: a localisation key with the variables its format
//! string substitutes, nested to any depth (`PLANET_NAME_FORMAT` over a `STAR_NAME_1_OF_2`
//! over a `SPEC_` key), or a plain scalar.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cst::Node;
use crate::keys;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NameTemplate {
    pub key: String,
    /// `literal=yes`: the key is shown as written, never looked up.
    pub literal: bool,
    pub variables: Vec<NameVariable>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NameVariable {
    pub name: String,
    pub value: NameTemplate,
}

/// Whether a name is a localisation key (`NAME_N_Maw`, `NAME_Corellia`) rather than the
/// name itself (`Coruscant`, `Far Cloud`). Both formats keep the same rule: a scenario
/// reads a name this way, and a save writes `literal=yes` beside the key when it is false,
/// so the game shows what the user typed instead of hunting for a key it has not got.
pub fn looks_like_key(text: &str) -> bool {
    let identifier = text.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && text.starts_with(|c: char| c.is_ascii_uppercase());
    identifier && (text.contains('_') || !text.contains(|c: char| c.is_ascii_lowercase()))
}

impl NameTemplate {
    /// `name` is the `name=` node: a `{ key=… literal=… variables={…} }` block or a scalar.
    pub fn parse(name: &Node, src: &[u8]) -> Self {
        let key = name
            .find(keys::KEY, src)
            .and_then(|k| k.scalar_str(src))
            .or_else(|| name.scalar_str(src))
            .unwrap_or_default()
            .to_owned();
        let literal = name
            .find(keys::LITERAL, src)
            .and_then(|n| n.scalar_str(src))
            .is_some_and(|s| s == "yes");
        let variables = name
            .find(keys::VARIABLES, src)
            .map(|vars| {
                vars.children()
                    .iter()
                    .filter_map(|var| {
                        let value = var.find(keys::VALUE, src)?;
                        Some(NameVariable {
                            name: var
                                .find(keys::KEY, src)
                                .and_then(|k| k.scalar_str(src))
                                .unwrap_or_default()
                                .to_owned(),
                            value: Self::parse(value, src),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self {
            key,
            literal,
            variables,
        }
    }

    pub fn plain(key: &str) -> Self {
        Self {
            key: key.to_owned(),
            literal: false,
            variables: Vec::new(),
        }
    }

    /// Every non-literal key in the tree, depth-first.
    pub fn keys(&self) -> Vec<&str> {
        let mut keys = Vec::new();
        self.collect_keys(&mut keys);
        keys
    }

    fn collect_keys<'a>(&'a self, keys: &mut Vec<&'a str>) {
        if !self.literal {
            keys.push(&self.key);
        }
        for var in &self.variables {
            var.value.collect_keys(keys);
        }
    }

    /// The no-game-data stand-in: a format-template key (`%ADJECTIVE%`, `AofB`) is
    /// replaced by its variables' stand-ins joined in order, so "%ADJECTIVE% Sovereignty"
    /// becomes "SPEC_RihiNar Sovereignty"; any other key is kept as written.
    pub fn stand_in(&self) -> String {
        let parts: Vec<String> = self
            .variables
            .iter()
            .map(|v| v.value.stand_in())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.is_empty() || !(self.key.starts_with('%') || self.key == "AofB") {
            return self.key.clone();
        }
        parts.join(if self.key == "AofB" { " of " } else { " " })
    }
}
