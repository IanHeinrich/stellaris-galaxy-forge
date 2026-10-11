//! `common/graphical_culture`: the culture whose models each graphical culture falls back to
//! when one of its own is missing.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type GraphicalCultures = Registry<GraphicalCulture>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphicalCulture {
    pub key: String,
    pub fallback: Option<String>,
}

impl FromDef for GraphicalCulture {
    const DIR: &'static str = "common/graphical_culture";

    fn read(key: String, def: &Def) -> Self {
        Self {
            key,
            fallback: def.scalar("fallback").map(str::to_owned),
        }
    }
}

impl GraphicalCultures {
    /// `culture`, then the culture it falls back to, and so on, until a culture names no
    /// fallback or one already in the chain.
    pub fn chain(&self, culture: &str) -> Vec<String> {
        let mut chain = vec![culture.to_owned()];
        while let Some(next) = chain
            .last()
            .and_then(|c| self.get(c)?.fallback.clone())
            .filter(|next| !chain.contains(next))
        {
            chain.push(next);
        }
        chain
    }
}
