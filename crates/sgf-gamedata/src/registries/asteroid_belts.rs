//! `common/asteroid_belts`: the kinds a save's `asteroid_belt = { type }` names.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type AsteroidBelts = Registry<AsteroidBeltDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AsteroidBeltDef {
    pub key: String,
}

impl FromDef for AsteroidBeltDef {
    const DIR: &'static str = "common/asteroid_belts";

    fn read(key: String, _def: &Def) -> Self {
        Self { key }
    }
}
