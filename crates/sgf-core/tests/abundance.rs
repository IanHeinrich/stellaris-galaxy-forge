//! The Resource Abundance an open save was set up with, and its absence where the file
//! does not write it.
use sgf_core::session::Session;

mod common;
use common::fixture::PAINTED;
use common::{SAMPLE, SAMPLE_3_4, SAMPLE_4_5};

#[test]
fn the_4_4_and_4_5_samples_were_set_up_at_abundance_2() {
    for path in [SAMPLE, SAMPLE_4_5] {
        let session = Session::open(path).expect("open the sample");
        assert_eq!(session.resource_abundance(), Some(2.0), "{path}");
    }
}

#[test]
fn a_3_4_save_and_a_scenario_have_none() {
    let old = Session::open(SAMPLE_3_4).expect("open the 3.4 sample");
    assert_eq!(old.resource_abundance(), None, "3.4 writes no such key");
    assert_eq!(PAINTED.open().resource_abundance(), None);
}
