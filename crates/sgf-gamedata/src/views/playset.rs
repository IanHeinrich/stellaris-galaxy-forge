use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::install::mods::{
    self, LOCAL_CLUSTER_WORKSHOP_ID, ModInfo, PAINT_MOD_WORKSHOP_ID, PaintModStatus,
    RESERVED_SPAWNS_WORKSHOP_ID,
};
use crate::install::scenarios::scenarios_dir;
use crate::{Diagnostic, GameData};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModView {
    pub id: String,
    pub name: String,
    pub dir: Option<String>,
    /// `"loaded"` or `"missing"`.
    pub status: String,
}

impl From<&ModInfo> for ModView {
    fn from(m: &ModInfo) -> Self {
        Self {
            id: m.id.clone(),
            name: m.name.clone(),
            dir: m.dir.as_ref().map(|d| d.display().to_string()),
            status: m.status.as_str().to_owned(),
        }
    }
}

/// Where Paint a Galaxy keeps its scenarios on this machine, whether or not the
/// directory exists, whether the playset loads the mod, and whether it loads the
/// Reserved Spawns submod beside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaintModView {
    /// `None` when the launcher lists the mod but its files are gone.
    pub scenarios_dir: Option<String>,
    pub enabled: bool,
    /// The playset loads the Reserved Spawns submod, whose traits a reserved seat needs.
    pub reserved_spawns: bool,
    /// What reading the launcher's files ran into.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub diagnostics: Option<Vec<String>>,
}

impl PaintModView {
    /// Paint a Galaxy as the launcher's files in the user directory list it: the loaded
    /// game data's user directory, else this machine's. `None` when the launcher lists no
    /// copy, or there is no user directory.
    pub fn find(gd: Option<&GameData>) -> Option<Self> {
        let user_dir = gd
            .and_then(|gd| gd.layout.user_dir.clone())
            .or_else(sgf_core::library::paradox_user_dir)?;
        let mut diagnostics = Vec::new();
        mods::paint_mod_status(
            &user_dir,
            &crate::install::discovery::steam_libraries(),
            &mut diagnostics,
        )
        .map(|status| Self::new(&status, &diagnostics))
    }

    pub fn new(status: &PaintModStatus, diagnostics: &[Diagnostic]) -> Self {
        let m = &status.paint;
        Self {
            scenarios_dir: m
                .dir
                .as_deref()
                .map(|dir| scenarios_dir(dir).display().to_string()),
            enabled: m.enabled,
            reserved_spawns: status.reserved_spawns,
            diagnostics: Some(diagnostics.iter().map(ToString::to_string).collect()),
        }
    }
}

/// The Steam Workshop pages the app links to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkshopLinks {
    pub paint_a_galaxy: String,
    /// Reserved Spawns, whose "Reserved Spawn A"-"Z" traits a reserved seat's empire needs.
    pub reserved_spawns: String,
    /// Local Cluster, the usual workaround for Sol having no Sol-specific neighbours.
    pub local_cluster: String,
}

impl Default for WorkshopLinks {
    fn default() -> Self {
        Self {
            paint_a_galaxy: mods::workshop_url(PAINT_MOD_WORKSHOP_ID),
            reserved_spawns: mods::workshop_url(RESERVED_SPAWNS_WORKSHOP_ID),
            local_cluster: mods::workshop_url(LOCAL_CLUSTER_WORKSHOP_ID),
        }
    }
}

impl WorkshopLinks {
    pub fn contains(&self, url: &str) -> bool {
        [
            &self.paint_a_galaxy,
            &self.reserved_spawns,
            &self.local_cluster,
        ]
        .into_iter()
        .any(|link| link == url)
    }
}
