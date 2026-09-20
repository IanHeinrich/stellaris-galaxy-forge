//! Who an `event_target:` token actually is: the five routes from a bare
//! token to a name, a type and a flag, first match winning.

use sgf_core::projections::galaxy::{FlagRef, display_name};

use crate::GameData;
use crate::scripts::chain::Chain;
use crate::scripts::index::{CreatedCountry, Prescripted};
use crate::scripts::view::{OwnerIdentity, ScriptRef};

/// The type an unidentified owner is given: vanilla's own type for a country
/// an event owns, whose `generate_borders = no` keeps it out of the map's
/// territories while it still lists.
const UNRESOLVED_TYPE: &str = "global_event";

const CUSTOM_EMPIRE_LABEL: &str = "Custom empire spawn";
const CUSTOM_EMPIRE_USAGES: [&str; 2] = ["custom_empire", "empire_init"];

/// Whether an initializer's `usage` is one a country starts in, so the empire
/// it spawns is the player's or an AI's design rather than a scripted country.
pub fn is_empire_spawn(usage: Option<&str>) -> bool {
    usage.is_some_and(|usage| CUSTOM_EMPIRE_USAGES.contains(&usage))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub kind: OwnerIdentity,
    pub name_key: String,
    pub country_type: String,
    pub colors: Vec<String>,
    pub icon: Option<FlagRef>,
    pub background: Option<FlagRef>,
    pub defined_at: Option<ScriptRef>,
}

impl Identity {
    /// The name to show: localised where the key is one, else the key itself
    /// made readable.
    pub fn label(&self, gd: &GameData) -> String {
        gd.loc
            .get(&self.name_key)
            .unwrap_or_else(|| display_name(&self.name_key))
    }
}

/// `token`'s empire, using the chain and the initializer of the system whose
/// chain saved it.
pub fn resolve(
    gd: &GameData,
    token: &str,
    capital_chain: Option<&Chain>,
    capital_initializer: Option<&str>,
) -> Identity {
    if let Some(country) = gd.scripts.country_of_target(token) {
        return from_country(OwnerIdentity::Created, country);
    }
    if let Some(country) = capital_chain
        .into_iter()
        .flat_map(|chain| &chain.country_flag_targets)
        .find(|(_, saved)| saved == token)
        .and_then(|(flag, _)| gd.scripts.country_of_flag(flag))
    {
        return from_country(OwnerIdentity::CountryFlag, country);
    }
    if let Some(prescripted) = capital_initializer.and_then(|key| gd.scripts.prescripted(key)) {
        return from_prescripted(prescripted);
    }
    if is_empire_spawn(
        capital_initializer
            .and_then(|key| gd.initializers.get(key))
            .and_then(|init| init.usage.as_deref()),
    ) {
        return Identity {
            kind: OwnerIdentity::CustomEmpireSpawn,
            name_key: CUSTOM_EMPIRE_LABEL.to_owned(),
            country_type: "default".to_owned(),
            colors: Vec::new(),
            icon: None,
            background: None,
            defined_at: None,
        };
    }
    Identity {
        kind: OwnerIdentity::Unresolved,
        name_key: token.to_owned(),
        country_type: UNRESOLVED_TYPE.to_owned(),
        colors: Vec::new(),
        icon: None,
        background: None,
        defined_at: None,
    }
}

fn from_country(kind: OwnerIdentity, country: &CreatedCountry) -> Identity {
    Identity {
        kind,
        name_key: country.name_key.clone(),
        country_type: country.country_type.clone(),
        colors: country.colors.clone(),
        icon: country.icon.clone(),
        background: country.background.clone(),
        defined_at: Some(country.location.clone()),
    }
}

fn from_prescripted(prescripted: &Prescripted) -> Identity {
    Identity {
        kind: OwnerIdentity::Prescripted,
        name_key: prescripted.name_key.clone(),
        country_type: "default".to_owned(),
        colors: prescripted.colors.clone(),
        icon: prescripted.icon.clone(),
        background: prescripted.background.clone(),
        defined_at: Some(prescripted.location.clone()),
    }
}
