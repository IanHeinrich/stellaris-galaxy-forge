//! `common/deposits`: orbital resource deposits and planetary features and
//! blockers, keyed the same way the save's `deposit` entities are.

use sgf_core::cst::Node;

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type Deposits = Registry<DepositDef>;

#[derive(Debug, Clone, PartialEq)]
pub struct DepositDef {
    pub key: String,
    pub icon: Option<String>,
    pub category: Option<String>,
    pub produces: Vec<(String, f64)>,
    /// `is_for_colonizable` explicitly `no`, or absent: every deposit file
    /// that has no orbital deposits omits the key, and every orbital
    /// deposit writes it explicitly, so absence means colonizable (a
    /// planetary feature or blocker), not orbital.
    pub is_for_colonizable: bool,
    pub station: Option<String>,
}

impl FromDef for DepositDef {
    const DIR: &'static str = "common/deposits";

    fn read(key: String, def: &Def) -> Self {
        let resources = def.node.find("resources", &def.src);
        // Orbital deposits nest `category` under `resources`; planetary features
        // and blockers, which have no `resources` block, write it at top level.
        let category = def.scalar("category").map(str::to_owned).or_else(|| {
            resources
                .and_then(|r| r.find("category", &def.src)?.scalar_str(&def.src))
                .map(str::to_owned)
        });
        let produces = resources
            .and_then(|r| r.find("produces", &def.src))
            .map(|p| read_produces(p, &def.src))
            .unwrap_or_default();
        let is_for_colonizable = def
            .node
            .find("is_for_colonizable", &def.src)
            .and_then(|n| n.scalar_str(&def.src))
            .is_none_or(|s| s == "yes");
        Self {
            icon: def.scalar("icon").map(str::to_owned),
            category,
            produces,
            is_for_colonizable,
            station: def.scalar("station").map(str::to_owned),
            key,
        }
    }
}

fn read_produces(node: &Node, src: &[u8]) -> Vec<(String, f64)> {
    let mut out: Vec<(String, f64)> = Vec::new();
    for child in node.children() {
        let Some(key) = child.key_str(src) else {
            continue;
        };
        let Some(amount) = child.scalar_str(src).and_then(|s| s.parse::<f64>().ok()) else {
            continue;
        };
        match out.iter_mut().find(|(k, _)| k == key) {
            Some(entry) => entry.1 += amount,
            None => out.push((key.to_owned(), amount)),
        }
    }
    out
}
