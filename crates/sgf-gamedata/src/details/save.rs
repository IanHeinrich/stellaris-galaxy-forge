//! A save's bodies as game data resolves them: which planet classes are stars, and the star
//! class each star body is drawn as.

use sgf_core::projections::galaxy::StarClasses;
use sgf_core::views::details::SystemDetails;

use crate::GameData;

impl GameData {
    /// Save system details with the star class each star is drawn as, in a system of star
    /// class `system`. Which bodies are stars is the session's to say, from
    /// [`Self::session_star_classes`].
    pub fn resolve_save_bodies(&self, details: &mut SystemDetails, system: &str) {
        for planet in &mut details.planets {
            planet.star_class = self.drawn_star_class(&planet.class, system);
        }
    }

    /// What the install says of stars, for a session: the planet classes flagged `star`, and
    /// the star class each initializer that names one gives a scenario system.
    pub fn session_star_classes(&self) -> StarClasses {
        StarClasses {
            bodies: Some(
                self.planet_classes
                    .iter()
                    .filter(|c| c.star)
                    .map(|c| c.key.clone())
                    .collect(),
            ),
            initializers: self
                .initializers
                .iter()
                .filter_map(|i| {
                    let class = i.class.as_deref().filter(|c| c.starts_with("sc_"))?;
                    Some((i.name.clone(), class.to_owned()))
                })
                .collect(),
        }
    }
}
