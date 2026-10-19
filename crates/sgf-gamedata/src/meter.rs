//! How far a [`crate::load`] has got, as a fraction of the whole load, for a progress bar.

use crate::Phase;

/// Every step of a load in the order it runs, with its weight: its share, in thousandths, of a
/// 91-mod playset's load, the mean of a cold and a warm load (`load_time_by_step` prints them).
/// The weights sum to 1000.
pub const STEPS: &[(&str, Phase, u32)] = &[
    ("discover", Phase::Discover, 6),
    ("variables", Phase::Definitions, 2),
    ("initializers", Phase::Definitions, 12),
    ("scripts", Phase::Definitions, 375),
    ("country_types", Phase::Definitions, 12),
    ("star_classes", Phase::Definitions, 1),
    ("random_names", Phase::Definitions, 1),
    ("deposits", Phase::Definitions, 2),
    ("deposit_categories", Phase::Definitions, 1),
    ("static_modifiers", Phase::Definitions, 4),
    ("planet_modifiers", Phase::Definitions, 1),
    ("anomaly_categories", Phase::Definitions, 2),
    ("colony_types", Phase::Definitions, 1),
    ("dig_site_types", Phase::Definitions, 1),
    ("asteroid_belts", Phase::Definitions, 1),
    ("bypasses", Phase::Definitions, 1),
    ("planet_classes", Phase::Definitions, 16),
    ("terraform_links", Phase::Definitions, 1),
    ("ship_sizes", Phase::Definitions, 2),
    ("section_templates", Phase::Definitions, 48),
    ("starbase_levels", Phase::Definitions, 1),
    ("scripted_triggers", Phase::Definitions, 3),
    ("megastructures", Phase::Definitions, 2),
    ("graphical_cultures", Phase::Definitions, 1),
    ("galaxy_shapes", Phase::Definitions, 1),
    ("galaxy_sizes", Phase::Definitions, 1),
    ("precursors", Phase::Definitions, 1),
    ("sprites", Phase::Definitions, 36),
    ("colors", Phase::Definitions, 5),
    ("flags", Phase::Definitions, 7),
    ("defines", Phase::Definitions, 1),
    ("models", Phase::Definitions, 176),
    ("derive", Phase::Definitions, 141),
    ("localisation", Phase::Localisation, 134),
];

/// The smallest advance worth reporting within a step.
const STRIDE: f64 = 0.005;

/// Where a load stands: the step it is in and how far through the whole load that is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    pub phase: Phase,
    pub step: &'static str,
    /// 0..=1 within the whole load.
    pub fraction: f64,
}

/// Turns the steps of a load, and the files read within one, into [`Reading`]s. It reports
/// the start of every step and any advance of at least half a percent, and never goes back.
pub struct Meter<'a> {
    report: Option<&'a mut dyn FnMut(Reading)>,
    step: usize,
    /// The current step's parts finished, and those it expects.
    done: usize,
    expected: usize,
    sent: Option<Reading>,
}

impl<'a> Meter<'a> {
    pub fn new(report: &'a mut dyn FnMut(Reading)) -> Self {
        Self {
            report: Some(report),
            step: 0,
            done: 0,
            expected: 0,
            sent: None,
        }
    }

    /// A meter nobody reads, for a load that shows no progress.
    pub fn silent() -> Self {
        Self {
            report: None,
            step: 0,
            done: 0,
            expected: 0,
            sent: None,
        }
    }

    /// Starts the step `name` of [`STEPS`].
    pub(crate) fn step(&mut self, name: &'static str) {
        let index = STEPS.iter().position(|(step, ..)| *step == name);
        debug_assert!(index.is_some(), "{name} is not in meter::STEPS");
        self.step = index.unwrap_or(self.step);
        self.done = 0;
        self.expected = 0;
        self.send(0.0);
    }

    /// The current step has `parts` more parts, such as the files it reads, each finished with
    /// [`Self::tick`]. A step expects all its parts before its first tick, or the bar runs
    /// ahead and then waits.
    pub(crate) fn expect(&mut self, parts: usize) {
        self.expected += parts;
    }

    /// One more part of the current step is finished.
    pub(crate) fn tick(&mut self) {
        self.done += 1;
        if self.expected > 0 {
            self.send((self.done as f64 / self.expected as f64).min(1.0));
        }
    }

    /// The last step is over.
    pub(crate) fn finish(&mut self) {
        self.step = STEPS.len() - 1;
        self.send(1.0);
    }

    fn send(&mut self, within: f64) {
        let Some(report) = self.report.as_mut() else {
            return;
        };
        let (step, phase, weight) = STEPS[self.step];
        let total: u32 = STEPS.iter().map(|(.., w)| w).sum();
        let before: u32 = STEPS[..self.step].iter().map(|(.., w)| w).sum();
        let mut fraction =
            ((f64::from(before) + f64::from(weight) * within) / f64::from(total)).clamp(0.0, 1.0);
        let due = match self.sent {
            None => true,
            Some(sent) => {
                fraction = fraction.max(sent.fraction);
                sent.step != step
                    || fraction - sent.fraction >= STRIDE
                    || (fraction == 1.0 && sent.fraction < 1.0)
            }
        };
        if due {
            let reading = Reading {
                phase,
                step,
                fraction,
            };
            report(reading);
            self.sent = Some(reading);
        }
    }
}
