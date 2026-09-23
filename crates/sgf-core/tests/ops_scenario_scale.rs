//! Scenario edits timed on a synthetic 8,800-system grid with 17,410 lanes, and the same
//! paint on the exported sample scenario for comparison. Ignored by default: run with
//! `cargo test -p sgf-core --test ops_scenario_scale -- --ignored --nocapture`.

use std::fmt::Write as _;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde::ser::{
    self, SerializeMap, SerializeSeq, SerializeStruct, SerializeStructVariant, SerializeTuple,
    SerializeTupleStruct, SerializeTupleVariant, Serializer,
};
use sgf_core::emit;
use sgf_core::ops::{LanePair, NewSystem, Op};
use sgf_core::session::{OpResult, Session};

mod common;
use common::current;

const SAMPLE_SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);

/// The huge galaxy: a grid of `GRID_COLS` by `GRID_ROWS` systems 10 apart, centred on
/// the origin, each jittered by up to ±3 and laned to its right and lower neighbour.
const GRID_COLS: u32 = 110;
const GRID_ROWS: u32 = 80;
const SEAT_EVERY: u32 = 550;

/// A paint stroke: `PAINT_COLS` by `PAINT_ROWS` systems 10 apart, laned the same way.
const PAINT_COLS: u32 = 20;
const PAINT_ROWS: u32 = 15;

const SMALL_EDITS: u32 = 20;
const SMALL_EDIT_SYSTEMS: u32 = 5;

struct Rng(u64);

impl Rng {
    fn next_f64(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn huge_scenario_text() -> String {
    let sample = std::fs::read_to_string(SAMPLE_SCENARIO).expect("read the sample scenario");
    let start = sample
        .find("static_galaxy_scenario")
        .expect("a scenario block");
    let end = sample.find("\n\tsystem = {").expect("a system statement");
    let header = sample[start..=end].replace("name = \"2206.11.16\"", "name = \"huge_grid\"");

    let mut rng = Rng(0x5EED_CAFE_F00D_1234);
    let mut text = String::with_capacity(2_000_000);
    text.push_str(&header);
    text.push('\n');
    for row in 0..GRID_ROWS {
        for col in 0..GRID_COLS {
            let id = row * GRID_COLS + col;
            let jitter = |rng: &mut Rng| ((rng.next_f64() - 0.5) * 600.0).round() / 100.0;
            let x = f64::from(col) * 10.0 - 545.0 + jitter(&mut rng);
            let y = f64::from(row) * 10.0 - 395.0 + jitter(&mut rng);
            write!(
                text,
                "\tsystem = {{ id = \"{id}\" name = \"Grid_{id}\" position = {{ x = {} y = {} }} initializer = basic_init_01",
                emit::coord(x),
                emit::coord(y)
            )
            .unwrap();
            if id.is_multiple_of(SEAT_EVERY) {
                text.push_str(" spawn_weight = { base = 1 }");
            }
            text.push_str(" }\n");
        }
    }
    text.push('\n');
    for row in 0..GRID_ROWS {
        for col in 0..GRID_COLS {
            let id = row * GRID_COLS + col;
            if col + 1 < GRID_COLS {
                writeln!(
                    text,
                    "\tadd_hyperlane = {{ from = \"{id}\" to = \"{}\" }}",
                    id + 1
                )
                .unwrap();
            }
            if row + 1 < GRID_ROWS {
                writeln!(
                    text,
                    "\tadd_hyperlane = {{ from = \"{id}\" to = \"{}\" }}",
                    id + GRID_COLS
                )
                .unwrap();
            }
        }
    }
    text.push('\n');
    for (i, (x, y)) in [(-300.0, -200.0), (0.0, 100.0), (250.0, -50.0)]
        .into_iter()
        .enumerate()
    {
        writeln!(
            text,
            "\tnebula = {{ name = \"Grid_Nebula_{i}\" position = {{ x = {x} y = {y} }} radius = 30 }}"
        )
        .unwrap();
    }
    text.push_str("}\n");
    text
}

fn next_id(session: &Session) -> u32 {
    session.graph.systems.keys().max().map_or(1, |max| max + 1)
}

fn new_system(id: u32, x: f64, y: f64) -> NewSystem {
    NewSystem {
        id,
        x,
        y,
        name: None,
        initializer: None,
        spawn_weight: None,
        spawn_script: None,
        statement: None,
    }
}

/// The Batch the map's paint brush sends: the stroke's systems, then its lanes.
fn paint_op(session: &Session, (x0, y0): (f64, f64)) -> Op {
    let first = next_id(session);
    let id_at = |row: u32, col: u32| first + row * PAINT_COLS + col;
    let mut systems = Vec::new();
    let mut lanes = Vec::new();
    for row in 0..PAINT_ROWS {
        for col in 0..PAINT_COLS {
            systems.push(new_system(
                id_at(row, col),
                x0 + f64::from(col) * 10.0,
                y0 + f64::from(row) * 10.0,
            ));
            let lane = |b| LanePair {
                a: id_at(row, col),
                b,
                bridge: false,
            };
            if col + 1 < PAINT_COLS {
                lanes.push(lane(id_at(row, col + 1)));
            }
            if row + 1 < PAINT_ROWS {
                lanes.push(lane(id_at(row + 1, col)));
            }
        }
    }
    Op::Batch {
        description: format!(
            "Painted {} systems and {} lanes",
            systems.len(),
            lanes.len()
        ),
        ops: vec![Op::AddSystems { systems }, Op::AddLanePairs { lanes }],
    }
}

/// What the app receives after an edit, built and serialised piece by piece.
fn report_edit(session: &Session, label: &str, applied: Duration, result: OpResult) {
    let start = Instant::now();
    let issues = sgf_core::validate::validate(&session.graph);
    let validate_time = start.elapsed();
    let start = Instant::now();
    let history = session.history();
    let history_time = start.elapsed();
    let start = Instant::now();
    let edit = session.edit_result(result);
    let edit_time = start.elapsed();
    let start = Instant::now();
    let total = to_json(&edit).len();
    let json_time = start.elapsed();
    println!(
        "  {label}: apply {applied:?} (its validate alone {validate_time:?}, {} issues) | \
         edit_result {edit_time:?} (history alone {history_time:?}) | \
         EditResult JSON {total} B in {json_time:?}: delta {} B ({} systems, {} removed), \
         issues {} B ({}), history {} B ({} undo, {} redo)",
        issues.len(),
        to_json(&edit.delta).len(),
        edit.delta.systems.len(),
        edit.delta.removed.len(),
        to_json(&edit.issues).len(),
        edit.issues.len(),
        to_json(&edit.history).len(),
        history.undo.len(),
        history.redo.len(),
    );
}

fn paint_and_undo(session: &mut Session, label: &str, origin: (f64, f64)) {
    let before = current(session);
    let systems_before = session.graph.systems.len();
    let op = paint_op(session, origin);
    println!("{label}: paint op JSON {} B", to_json(&op).len());

    let start = Instant::now();
    let painted = session.apply(op).expect("paint");
    let apply_time = start.elapsed();
    assert_eq!(
        painted.entry.description,
        "Painted 300 systems and 565 lanes"
    );
    assert_eq!(session.graph.systems.len(), systems_before + 300);
    report_edit(session, "paint", apply_time, painted);

    let start = Instant::now();
    let undone = session.undo().expect("undo").expect("the paint to undo");
    let undo_time = start.elapsed();
    report_edit(session, "paint undo", undo_time, undone);
    assert_eq!(current(session), before, "undo is not byte-identical");
    assert_eq!(session.graph.systems.len(), systems_before);
}

fn delete_all_and_undo(session: &mut Session) {
    let before = current(session);
    let mut ids: Vec<u32> = session.graph.systems.keys().copied().collect();
    ids.sort_unstable();
    let count = ids.len();
    let op = Op::Batch {
        description: format!("Deleted {count} systems"),
        ops: vec![Op::RemoveSystems { ids }],
    };
    println!("delete all: op JSON {} B", to_json(&op).len());

    let start = Instant::now();
    let removed = session.apply(op).expect("delete all");
    let apply_time = start.elapsed();
    assert_eq!(session.graph.systems.len(), 0);
    report_edit(session, "delete all", apply_time, removed);

    let start = Instant::now();
    let undone = session.undo().expect("undo").expect("the delete to undo");
    let undo_time = start.elapsed();
    report_edit(session, "delete all undo", undo_time, undone);
    assert_eq!(current(session), before, "undo is not byte-identical");
    assert_eq!(session.graph.systems.len(), count);
}

fn open_timed(path: &Path, label: &str) -> Session {
    let size = std::fs::metadata(path).expect("the scenario file").len();
    let start = Instant::now();
    let session = Session::open(path).expect("open the scenario");
    println!(
        "{label}: open {:?} ({size} B, {} systems)",
        start.elapsed(),
        session.graph.systems.len()
    );
    session
}

#[test]
#[ignore]
fn huge_scenario_edit_timings() {
    let build = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    println!("build: {build}");

    let mut sample = open_timed(Path::new(SAMPLE_SCENARIO), "sample scenario");
    paint_and_undo(&mut sample, "sample scenario", (1000.0, -200.0));

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("huge_grid.txt");
    std::fs::write(&path, huge_scenario_text()).expect("write the huge scenario");
    let mut session = open_timed(&path, "huge scenario");
    let grid = (GRID_COLS * GRID_ROWS) as usize;
    assert_eq!(session.graph.systems.len(), grid);
    let lane_ends: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
    assert_eq!(
        lane_ends,
        2 * ((GRID_COLS - 1) * GRID_ROWS + GRID_COLS * (GRID_ROWS - 1)) as usize
    );
    assert_eq!(current(&session), std::fs::read(&path).unwrap());

    paint_and_undo(&mut session, "huge scenario", (700.0, 500.0));

    delete_all_and_undo(&mut session);

    let start = Instant::now();
    for i in 0..SMALL_EDITS {
        let first = next_id(&session);
        let systems = (0..SMALL_EDIT_SYSTEMS)
            .map(|k| {
                new_system(
                    first + k,
                    -700.0 - f64::from(k) * 10.0,
                    -400.0 + f64::from(i) * 40.0,
                )
            })
            .collect();
        session
            .apply(Op::AddSystems { systems })
            .expect("a small edit");
    }
    println!(
        "{SMALL_EDITS} small edits of {SMALL_EDIT_SYSTEMS} systems: {:?} in all",
        start.elapsed()
    );
    assert_eq!(
        session.graph.systems.len(),
        grid + (SMALL_EDITS * SMALL_EDIT_SYSTEMS) as usize
    );
    assert_eq!(session.history().undo.len(), SMALL_EDITS as usize);
    paint_and_undo(
        &mut session,
        "huge scenario after small edits",
        (700.0, 500.0),
    );
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> String {
    let mut json = Json(String::new());
    value.serialize(&mut json).expect("serialise");
    json.0
}

/// Compact JSON as `serde_json::to_vec` writes it (floats via `{:?}`, which agrees with
/// its output at these magnitudes): serde_json is not among sgf-core's dependencies.
struct Json(String);

impl Json {
    fn string(&mut self, s: &str) {
        self.0.push('"');
        for c in s.chars() {
            match c {
                '"' => self.0.push_str("\\\""),
                '\\' => self.0.push_str("\\\\"),
                '\n' => self.0.push_str("\\n"),
                '\r' => self.0.push_str("\\r"),
                '\t' => self.0.push_str("\\t"),
                '\u{8}' => self.0.push_str("\\b"),
                '\u{c}' => self.0.push_str("\\f"),
                c if (c as u32) < 0x20 => write!(self.0, "\\u{:04x}", c as u32).unwrap(),
                c => self.0.push(c),
            }
        }
        self.0.push('"');
    }

    fn number(&mut self, v: impl std::fmt::Display) {
        write!(self.0, "{v}").unwrap();
    }

    fn float(&mut self, v: f64) {
        if v.is_finite() {
            write!(self.0, "{v:?}").unwrap();
        } else {
            self.0.push_str("null");
        }
    }

    fn open(&mut self, open: &str, close: &'static str) -> Compound<'_> {
        self.0.push_str(open);
        Compound {
            json: self,
            first: true,
            close,
        }
    }

    fn variant(&mut self, variant: &str) {
        self.0.push('{');
        self.string(variant);
        self.0.push(':');
    }
}

#[derive(Debug)]
struct JsonError(String);

impl std::fmt::Display for JsonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for JsonError {}

impl ser::Error for JsonError {
    fn custom<T: std::fmt::Display>(msg: T) -> Self {
        Self(msg.to_string())
    }
}

struct Compound<'a> {
    json: &'a mut Json,
    first: bool,
    close: &'static str,
}

impl Compound<'_> {
    fn comma(&mut self) {
        if !self.first {
            self.json.0.push(',');
        }
        self.first = false;
    }

    fn element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), JsonError> {
        self.comma();
        value.serialize(&mut *self.json)
    }

    fn field<T: Serialize + ?Sized>(&mut self, key: &str, value: &T) -> Result<(), JsonError> {
        self.comma();
        self.json.string(key);
        self.json.0.push(':');
        value.serialize(&mut *self.json)
    }

    fn close(self) -> Result<(), JsonError> {
        self.json.0.push_str(self.close);
        Ok(())
    }
}

impl<'a> Serializer for &'a mut Json {
    type Ok = ();
    type Error = JsonError;
    type SerializeSeq = Compound<'a>;
    type SerializeTuple = Compound<'a>;
    type SerializeTupleStruct = Compound<'a>;
    type SerializeTupleVariant = Compound<'a>;
    type SerializeMap = Compound<'a>;
    type SerializeStruct = Compound<'a>;
    type SerializeStructVariant = Compound<'a>;

    fn serialize_bool(self, v: bool) -> Result<(), JsonError> {
        self.0.push_str(if v { "true" } else { "false" });
        Ok(())
    }
    fn serialize_i8(self, v: i8) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_i16(self, v: i16) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_i32(self, v: i32) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_i64(self, v: i64) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_u8(self, v: u8) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_u16(self, v: u16) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_u32(self, v: u32) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_u64(self, v: u64) -> Result<(), JsonError> {
        self.number(v);
        Ok(())
    }
    fn serialize_f32(self, v: f32) -> Result<(), JsonError> {
        self.float(f64::from(v));
        Ok(())
    }
    fn serialize_f64(self, v: f64) -> Result<(), JsonError> {
        self.float(v);
        Ok(())
    }
    fn serialize_char(self, v: char) -> Result<(), JsonError> {
        self.string(v.encode_utf8(&mut [0; 4]));
        Ok(())
    }
    fn serialize_str(self, v: &str) -> Result<(), JsonError> {
        self.string(v);
        Ok(())
    }
    fn serialize_bytes(self, v: &[u8]) -> Result<(), JsonError> {
        let mut seq = self.open("[", "]");
        for b in v {
            seq.element(b)?;
        }
        seq.close()
    }
    fn serialize_none(self) -> Result<(), JsonError> {
        self.0.push_str("null");
        Ok(())
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<(), JsonError> {
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<(), JsonError> {
        self.serialize_none()
    }
    fn serialize_unit_struct(self, _: &'static str) -> Result<(), JsonError> {
        self.serialize_none()
    }
    fn serialize_unit_variant(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
    ) -> Result<(), JsonError> {
        self.string(variant);
        Ok(())
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        value: &T,
    ) -> Result<(), JsonError> {
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<(), JsonError> {
        self.variant(variant);
        value.serialize(&mut *self)?;
        self.0.push('}');
        Ok(())
    }
    fn serialize_seq(self, _: Option<usize>) -> Result<Compound<'a>, JsonError> {
        Ok(self.open("[", "]"))
    }
    fn serialize_tuple(self, _: usize) -> Result<Compound<'a>, JsonError> {
        Ok(self.open("[", "]"))
    }
    fn serialize_tuple_struct(self, _: &'static str, _: usize) -> Result<Compound<'a>, JsonError> {
        Ok(self.open("[", "]"))
    }
    fn serialize_tuple_variant(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        _: usize,
    ) -> Result<Compound<'a>, JsonError> {
        self.variant(variant);
        Ok(self.open("[", "]}"))
    }
    fn serialize_map(self, _: Option<usize>) -> Result<Compound<'a>, JsonError> {
        Ok(self.open("{", "}"))
    }
    fn serialize_struct(self, _: &'static str, _: usize) -> Result<Compound<'a>, JsonError> {
        Ok(self.open("{", "}"))
    }
    fn serialize_struct_variant(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        _: usize,
    ) -> Result<Compound<'a>, JsonError> {
        self.variant(variant);
        Ok(self.open("{", "}}"))
    }
}

impl SerializeSeq for Compound<'_> {
    type Ok = ();
    type Error = JsonError;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), JsonError> {
        self.element(value)
    }
    fn end(self) -> Result<(), JsonError> {
        self.close()
    }
}

impl SerializeTuple for Compound<'_> {
    type Ok = ();
    type Error = JsonError;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), JsonError> {
        self.element(value)
    }
    fn end(self) -> Result<(), JsonError> {
        self.close()
    }
}

impl SerializeTupleStruct for Compound<'_> {
    type Ok = ();
    type Error = JsonError;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), JsonError> {
        self.element(value)
    }
    fn end(self) -> Result<(), JsonError> {
        self.close()
    }
}

impl SerializeTupleVariant for Compound<'_> {
    type Ok = ();
    type Error = JsonError;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), JsonError> {
        self.element(value)
    }
    fn end(self) -> Result<(), JsonError> {
        self.close()
    }
}

impl SerializeMap for Compound<'_> {
    type Ok = ();
    type Error = JsonError;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), JsonError> {
        self.comma();
        let key = to_json(key);
        if key.starts_with('"') {
            self.json.0.push_str(&key);
        } else {
            self.json.string(&key);
        }
        self.json.0.push(':');
        Ok(())
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), JsonError> {
        value.serialize(&mut *self.json)
    }
    fn end(self) -> Result<(), JsonError> {
        self.close()
    }
}

impl SerializeStruct for Compound<'_> {
    type Ok = ();
    type Error = JsonError;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), JsonError> {
        self.field(key, value)
    }
    fn end(self) -> Result<(), JsonError> {
        self.close()
    }
}

impl SerializeStructVariant for Compound<'_> {
    type Ok = ();
    type Error = JsonError;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), JsonError> {
        self.field(key, value)
    }
    fn end(self) -> Result<(), JsonError> {
        self.close()
    }
}
