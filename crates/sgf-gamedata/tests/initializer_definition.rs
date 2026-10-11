//! An initializer's definition as the Source tab shows it: its text, file and line read back
//! from the real install's files, and its `inline_script` calls left as written.

use std::fs;

use sgf_gamedata::views::InitializerDefinition;

use crate::common::INSTALL;

/// The lines of `file` from `line` on, as many as `text` has.
fn file_lines(file: &str, line: u32, text: &str) -> Vec<String> {
    let bytes = fs::read(file).unwrap_or_else(|e| panic!("{file}: {e}"));
    let start = usize::try_from(line).expect("a line number") - 1;
    String::from_utf8_lossy(&bytes)
        .split('\n')
        .skip(start)
        .take(text.split('\n').count())
        .map(str::to_owned)
        .collect()
}

#[test]
fn a_vanilla_definition_is_the_text_its_file_writes_at_its_line() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let def = InitializerDefinition::read(gd, "sol_system_initializer").expect("Sol's definition");
    assert!(
        def.at
            .file
            .replace('\\', "/")
            .contains("common/solar_system_initializers/"),
        "{} is an initializer file",
        def.at.file
    );
    assert!(
        def.text.starts_with("sol_system_initializer"),
        "{}",
        def.text
    );
    assert!(def.text.trim_end().ends_with('}'), "{}", def.text);
    let lines: Vec<&str> = def.text.split('\n').collect();
    let on_disk = file_lines(&def.at.file, def.at.line, &def.text);
    assert_eq!(on_disk.len(), lines.len(), "the file holds the whole text");
    assert!(
        on_disk[0]
            .trim_start()
            .starts_with("sol_system_initializer"),
        "line {} is {}",
        def.at.line,
        on_disk[0]
    );
    for (shown, written) in lines.iter().zip(&on_disk).skip(1) {
        assert_eq!(shown.trim_end_matches('\r'), written.trim_end_matches('\r'));
    }
    assert!(def.inline_scripts.is_empty(), "{:?}", def.inline_scripts);
    assert!(InitializerDefinition::read(gd, "no_such_initializer").is_none());
}

#[test]
fn an_inline_script_call_stays_as_written_and_names_its_file() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let def = InitializerDefinition::read(gd, "voidworms_spawn_system_tiny")
        .expect("the void worm system's definition");
    assert!(!def.inline_scripts.is_empty(), "it calls an inline script");
    let lines: Vec<&str> = def.text.split('\n').collect();
    for call in &def.inline_scripts {
        let index = usize::try_from(call.line).expect("a line number") - 1;
        assert!(
            lines[index].trim_start().starts_with("inline_script"),
            "line {} of the text is {}",
            call.line,
            lines[index]
        );
        let file = call.file.as_ref().expect("the install has the script");
        assert!(
            file.file
                .replace('\\', "/")
                .ends_with(&format!("common/inline_scripts/{}.txt", call.script)),
            "{} is not {}'s file",
            file.file,
            call.script
        );
        let first = file_lines(&file.file, file.line, "")[0].clone();
        assert!(
            !first.trim().is_empty() && !first.trim_start().starts_with('#'),
            "{}'s first statement is on line {}: {first}",
            call.script,
            file.line
        );
    }
}
