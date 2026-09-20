//! `sgf validate`: every issue the session finds; exits 1 on an error.

use std::path::Path;

use sgf_core::session::Session;

use super::{Outcome, Run, print_issues};

pub fn run(doc: &Path) -> Run {
    let session = Session::open(doc)?;
    match print_issues(&session.validate()) {
        0 => Ok(Outcome::Ok),
        _ => Ok(Outcome::Failed),
    }
}
