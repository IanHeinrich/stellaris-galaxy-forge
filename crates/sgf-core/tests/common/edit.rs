//! The 4.5 sample edited as text before it opens, and the entity texts the tests read back.
use sgf_core::entity::views::EntityKind;
use sgf_core::session::Session;

use super::{SAMPLE_4_5, entity_text, open_edited_sample};

/// The 4.5 sample's capital system, Alari: star 0, the capital 2 with its moon 3, barren
/// planet 4 and gas giant 6. Of 2, 4 and 6 only the capital has a `flags` block, and 4 has
/// no moons. Country 0 owns it and lists no megastructure.
pub const ALARI: u32 = 169;

/// The 4.5 sample with `edit` applied to its gamestate.
pub fn open_4_5_edited(edit: impl FnOnce(&mut String)) -> Session {
    open_edited_sample(SAMPLE_4_5, |gamestate, _| edit(gamestate))
}

/// `text` with `insert` written after the last of `anchors`, each found from where the one
/// before starts.
#[track_caller]
pub fn insert_after(text: &mut String, anchors: &[&str], insert: &str) {
    let mut start = 0;
    let mut end = 0;
    for anchor in anchors {
        start += text[start..]
            .find(anchor)
            .unwrap_or_else(|| panic!("{anchor:?}"));
        end = start + anchor.len();
    }
    text.insert_str(end, insert);
}

/// A row of the top-level `megastructures`, `kind` in `system` with `tie` among its keys,
/// written after the last.
pub fn megastructure_row(text: &mut String, id: u32, kind: &str, system: u32, tie: &str) {
    insert_after(
        text,
        &["\nmegastructures=\n{\n", "\t16777231=none\n"],
        &format!(
            "\t{id}=\n\t{{\n\t\ttype=\"{kind}\"\n\t\tcoordinate=\n\t\t{{\n\t\t\tx=10\n\t\t\ty=20\n\t\t\torigin={system}\n\t\t}}\n{tie}\t\torbitals=\n\t\t{{\n\t\t}}\n\t\tbuild_queue=4294967295\n\t\tdismantle_progress=0\n\t\tdismantle_finish_date=\"0.01.01\"\n\t}}\n"
        ),
    );
}

/// System `id`'s text as it stands.
pub fn system_text(session: &Session, id: u32) -> String {
    entity_text(session, EntityKind::System, id)
}

/// Planet `id`'s text as it stands.
pub fn planet_text(session: &Session, id: u32) -> String {
    entity_text(session, EntityKind::Planet, id)
}

/// `from` in `text`, which must hold it once, made `to`.
#[track_caller]
pub fn replace_once(text: &mut String, from: &str, to: &str) {
    assert_eq!(text.matches(from).count(), 1, "{from:?}");
    *text = text.replacen(from, to, 1);
}

/// The 4.5 sample's gamestate with bypass slot 1, its shroud tunnel, reused one generation
/// on as `16777217`, the way a 4.5.2 save holds it, among slots up to 22.
pub fn reuse_bypass_slot_1(gamestate: &mut String) {
    let table = gamestate
        .find("\nbypasses=\n{\n")
        .expect("a bypasses table");
    let key = "\n\t1=\n\t{\n\t\ttype=\"shroud_tunnel\"";
    let at = table + gamestate[table..].find(key).expect("bypass 1");
    gamestate.replace_range(at..at + "\n\t1=".len(), "\n\t16777217=");
    replace_once(gamestate, "\t\tbypass=1\n", "\t\tbypass=16777217\n");
    replace_once(
        gamestate,
        "\t\tbypasses=\n\t\t{\n\t\t\t1 \n",
        "\t\tbypasses=\n\t\t{\n\t\t\t16777217 \n",
    );
}

/// The top-level `bypasses` table `text` holds, from the newline before its key to the
/// last line of its last row.
pub fn bypass_table(text: &str) -> &str {
    let start = text.find("\nbypasses=\n{\n").expect("a bypasses table");
    let table = &text[start..];
    &table[..table.find("\n}\n").expect("its end")]
}

/// The keys of the `bypasses` table as it stands, tombstones left out.
pub fn bypass_ids(session: &Session) -> Vec<u32> {
    let text = String::from_utf8(super::current(session)).expect("utf-8");
    bypass_table(&text)
        .lines()
        .filter_map(|line| line.strip_prefix('\t'))
        .filter(|line| !line.ends_with("=none"))
        .filter_map(|line| line.split_once('=')?.0.parse().ok())
        .collect()
}
