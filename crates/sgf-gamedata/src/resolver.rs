//! [`DetailsResolver`] backed by the install's definitions, in place of
//! [`sgf_core::format::save::details::HeuristicResolver`]'s key guessing.

use sgf_core::format::save::details::{DetailsResolver, HeuristicResolver};

use crate::GameData;

/// What system details are resolved through: the install's definitions when game data is
/// loaded, else [`HeuristicResolver`]'s key guessing.
pub fn resolver(gd: Option<&GameData>) -> &dyn DetailsResolver {
    match gd {
        Some(gd) => gd,
        None => &HeuristicResolver,
    }
}

/// The name and source resolvers an export takes: the install's localisation and each
/// initializer's DLC or mod when game data is loaded; without it, the save's own name keys
/// and no sources.
pub fn export_resolvers(
    gd: Option<&GameData>,
) -> (
    impl Fn(&str) -> Option<String> + '_,
    impl Fn(&str) -> Option<String> + '_,
) {
    (
        move |key: &str| gd.and_then(|gd| gd.loc.get(key)),
        move |initializer: &str| gd.and_then(|gd| gd.initializer_source(initializer)),
    )
}

impl DetailsResolver for GameData {
    fn deposit_produces(&self, key: &str) -> Option<Vec<(String, f64)>> {
        let deposit = self.deposits.get(key)?;
        if deposit.is_for_colonizable {
            return None;
        }
        Some(deposit.produces.clone())
    }

    /// A random class, or the empire's ideal one, says whether the game will draw a habitable
    /// world before it draws one.
    fn planet_habitable(&self, class: &str) -> Option<bool> {
        match class {
            "random_colonizable" | "random_ruler" | "random_non_machine" | "random_non_ideal"
            | "ideal_planet_class" => Some(true),
            "random_non_colonizable" | "random_asteroid" => Some(false),
            _ => self.planet_classes.get(class).map(|pc| pc.colonizable),
        }
    }
}
