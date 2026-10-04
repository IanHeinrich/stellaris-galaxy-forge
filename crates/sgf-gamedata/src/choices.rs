//! The planet the deposit, anomaly, dig site and model pickers are asked about.

use crate::GameData;
use crate::deposit_roll::{Kind, RollBody};

/// The planet a picker is asked about, any of whose class and size may be left to a random
/// draw, as in a system initializer's planet block.
#[derive(Debug, Clone, Copy)]
pub struct AskedBody<'a> {
    pub class: Option<&'a str>,
    pub size: Option<u32>,
    pub moon: bool,
}

impl<'a> AskedBody<'a> {
    /// The body as the generator would make it at `size`; `None` when it has no class.
    pub(crate) fn roll_body(&self, gd: &GameData, size: u32) -> Option<RollBody<'a>> {
        let class = self.class?;
        let kind = match gd.planet_classes.get(class).is_some_and(|c| c.star) {
            true => Kind::Star,
            false if self.moon => Kind::Moon,
            false => Kind::Planet,
        };
        Some(RollBody { class, size, kind })
    }
}
