//! The Resource Abundance an open save was set up with, and its absence where the file
//! does not write it.
use crate::common;
use common::fixture::PAINTED;
use common::{SAMPLE, SAMPLE_4_5, open, open_3_4, open_4_5};

#[test]
fn the_4_4_and_4_5_samples_were_set_up_at_abundance_2() {
    for (path, session) in [(SAMPLE, open()), (SAMPLE_4_5, open_4_5())] {
        assert_eq!(session.resource_abundance(), Some(2.0), "{path}");
    }
}

#[test]
fn a_3_4_save_and_a_scenario_have_none() {
    let old = open_3_4();
    assert_eq!(old.resource_abundance(), None, "3.4 writes no such key");
    assert_eq!(PAINTED.open().resource_abundance(), None);
}
