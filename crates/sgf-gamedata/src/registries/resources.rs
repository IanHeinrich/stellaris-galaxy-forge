//! Resource icons: the install names its sprites inconsistently
//! (`GFX_resource_energy`, `GFX_resource_physics` for `physics_research`,
//! `GFX_resource_sr_zro_large` with no small variant), so a resource is
//! matched to a sprite by probing the registry with the likely names.

use std::collections::BTreeSet;

use crate::GameData;
use crate::views::ResourceIcon;

impl GameData {
    /// The sprite for `resource`'s icon, or `None` when no candidate name is
    /// registered.
    pub fn resource_icon(&self, resource: &str) -> Option<String> {
        let short = resource.strip_prefix("sr_").unwrap_or(resource);
        let short = short
            .strip_suffix("_research")
            .or_else(|| short.strip_suffix("_value"))
            .unwrap_or(short);
        [
            format!("GFX_resource_{resource}"),
            format!("GFX_text_{resource}"),
            format!("GFX_resource_{short}"),
            format!("GFX_text_{short}"),
            format!("GFX_resource_{resource}_large"),
            format!("GFX_resource_{short}_large"),
            format!("GFX_{short}"),
        ]
        .into_iter()
        .find(|name| self.sprites.get(name).is_some())
    }

    /// One entry per resource any deposit produces, sorted by resource;
    /// resources with no sprite are left out.
    pub fn resource_icons(&self) -> Vec<ResourceIcon> {
        let resources: BTreeSet<&str> = self
            .deposits
            .iter()
            .flat_map(|d| d.produces.iter().map(|(resource, _)| resource.as_str()))
            .collect();
        resources
            .into_iter()
            .filter_map(|resource| {
                Some(ResourceIcon {
                    resource: resource.to_owned(),
                    sprite: self.resource_icon(resource)?,
                })
            })
            .collect()
    }
}
