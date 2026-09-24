//! `common/deposit_categories`: which deposit categories block districts and
//! which the planet view lists as rare.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type DepositCategories = Registry<DepositCategory>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DepositCategory {
    pub key: String,
    pub blocker: bool,
    pub important: bool,
}

impl FromDef for DepositCategory {
    const DIR: &'static str = "common/deposit_categories";

    fn read(key: String, def: &Def) -> Self {
        Self {
            blocker: def.flag("blocker"),
            important: def.flag("important"),
            key,
        }
    }
}
