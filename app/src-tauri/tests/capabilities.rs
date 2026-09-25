//! The capability sets `app/src/lib/capabilities.ts` holds, against what the commands report.
use serde_json::{Map, Value};

use crate::common::{SAMPLE_45, SCENARIO, open, webview};

const CAPABILITIES_TS: &str = include_str!("../../src/lib/capabilities.ts");

/// The `export const <name>: Capabilities = { … };` literal in the TS file, as JSON.
fn ts_set(name: &str) -> Value {
    let head = format!("export const {name}: Capabilities = {{");
    let start = CAPABILITIES_TS
        .find(&head)
        .unwrap_or_else(|| panic!("capabilities.ts has no {name}"))
        + head.len();
    let body = &CAPABILITIES_TS[start..];
    let body = &body[..body.find("};").expect("the literal closes")];
    let body: String = body
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect();
    let mut set = Map::new();
    for field in body.split(',').map(str::trim).filter(|f| !f.is_empty()) {
        let (key, value) = field
            .split_once(':')
            .unwrap_or_else(|| panic!("{name}: `{field}` is not `key: value`"));
        let value = match value.trim() {
            "true" => true,
            "false" => false,
            other => panic!("{name}.{key}: `{other}` is not a boolean"),
        };
        set.insert(key.trim().to_owned(), Value::Bool(value));
    }
    Value::Object(set)
}

#[test]
fn the_app_holds_the_sets_the_documents_report() {
    let w = webview();
    let save = open(&w, SAMPLE_45).capabilities;
    assert_eq!(
        serde_json::to_value(save).unwrap(),
        ts_set("SAVE_CAPABILITIES")
    );

    let scenario = open(&w, SCENARIO).capabilities;
    assert_eq!(
        serde_json::to_value(scenario).unwrap(),
        ts_set("SCENARIO_CAPABILITIES")
    );
}
