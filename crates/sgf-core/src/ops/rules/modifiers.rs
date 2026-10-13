//! What a modifier, flag or variable an op writes must be, whichever writer writes it: one
//! check per rule, each with one error.

use crate::ops::rules::{Form, check_text};
use crate::ops::{OpError, TimedModifier};

/// Refuse a modifier's name that is not an identifier.
pub(crate) fn check_modifier(modifier: &str) -> Result<(), OpError> {
    check_text("a modifier", modifier, Form::Bare)
}

/// Refuse an item of a timed modifier that lasts 0 days or more than a save can hold. A
/// negative count is written as given; the game keeps -1 for ever.
pub(crate) fn check_days(days: i64) -> Result<(), OpError> {
    match days == 0 || i32::try_from(days).is_err() {
        true => Err(OpError::ModifierDays),
        false => Ok(()),
    }
}

/// Refuse a timed modifier whose name or days [`check_modifier`] or [`check_days`] refuse.
pub(crate) fn check_timed(timed: &TimedModifier) -> Result<(), OpError> {
    check_modifier(&timed.modifier)?;
    timed.days.map_or(Ok(()), |days| check_days(days.into()))
}

/// Refuse `items` when one is listed twice, as `what` ("a flag listed once") with the text
/// `text` gives it.
pub(crate) fn listed_once<T: PartialEq>(
    what: &'static str,
    items: &[T],
    text: impl Fn(&T) -> String,
) -> Result<(), OpError> {
    match items
        .iter()
        .enumerate()
        .find(|(i, item)| items[..*i].contains(item))
    {
        Some((_, item)) => Err(OpError::InvalidText {
            what,
            text: text(item),
        }),
        None => Ok(()),
    }
}

/// Refuse `flags`, each named `what` in the error, when one is not an identifier or is
/// listed twice.
pub(crate) fn check_flags(what: &'static str, flags: &[String]) -> Result<(), OpError> {
    for flag in flags {
        check_text(what, flag, Form::Bare)?;
    }
    listed_once("a flag listed once", flags, String::clone)
}
