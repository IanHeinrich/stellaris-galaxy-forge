//! `sgf details`.
use crate::common::{MURA, SAMPLE_4_5, add_system_op, edit, edited, ok, sgf, stdout};

#[test]
fn details_lists_the_resources_of_a_system_an_edit_added() {
    let op = edit(&add_system_op(MURA));
    let (_, path) = edited(&["apply", SAMPLE_4_5, op.to_str().unwrap()]);
    let out = sgf(&["details", path.to_str().unwrap(), "601"]);
    ok(&out);
    let details = stdout(&out);
    let resources = details
        .lines()
        .find_map(|line| line.strip_prefix("resources: "))
        .expect("the resources line");
    assert!(resources.contains("energy"), "Mura's d_energy_5: {details}");
}
