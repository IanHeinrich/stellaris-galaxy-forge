//! IPC view types for game data; `cargo test -p sgf-gamedata` writes their
//! TypeScript declarations to `app/src/generated/`.

mod bodies;
mod countries;
mod galaxy;
mod initializers;
mod playset;
mod roll;
mod summary;

pub use bodies::{
    DepositView, PlanetClassView, ResourceIcon, StarClassView, TerraformCandidateView,
};
pub use countries::{CountryTypeView, FlagParts, MapColor, ShipSizeView, StarbaseLevelView};
pub use galaxy::{GalaxyShapeView, GalaxySizeView, PrecursorView};
pub use initializers::{InitPlanetView, InitializerView};
pub use playset::{ModView, PaintModView, WorkshopLinks};
pub use roll::{PlaceholderBody, RolledBody, SystemRoll};
pub use summary::{BeltKindView, DiagnosticView, GameDataChanged, GameDataSummary, WatchView};

fn hex(rgb: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}
