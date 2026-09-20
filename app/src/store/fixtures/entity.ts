import type { ContentsRow } from "../../generated/ContentsRow";
import type { EntityAddr } from "../../generated/EntityAddr";
import type { EntityKind } from "../../generated/EntityKind";
import type { EntityNode } from "../../generated/EntityNode";
import type { EntitySchema } from "../../generated/EntitySchema";
import type { EntitySource } from "../../generated/EntitySource";
import type { EntityView } from "../../generated/EntityView";
import type { Fact } from "../../generated/Fact";
import type { FieldSchema } from "../../generated/FieldSchema";
import type { NodeValue } from "../../generated/NodeValue";
import type { ScalarForm } from "../../generated/ScalarForm";
import { name } from "../../test/builders";

/** The id each kind's fixture entity takes, so a test names `planet #1207` the same way twice. */
const ENTITY_IDS: Record<EntityKind, number> = {
  system: 1,
  planet: 1207,
  colony: 1207,
  fleet: 88,
  ship: 4001,
  starbase: 77,
  megastructure: 5,
  country: 12,
  pop_group: 640,
  sector: 3,
  deposit: 900,
};

export function entityAddrOf(kind: EntityKind): EntityAddr {
  return { kind, id: ENTITY_IDS[kind] };
}

/** One statement inside an entity; `value` decides whether the row reads or drills. */
export function entityNode(
  key: string | null,
  value: NodeValue,
  overrides: Partial<EntityNode> = {},
): EntityNode {
  return {
    key,
    path: [key ?? "#0"],
    value,
    span: [0, 0],
    changed: false,
    ...overrides,
  };
}

export function scalar(text: string, form: ScalarForm = "ident"): NodeValue {
  return { kind: "scalar", text, form };
}

export function fact(label: string, value: string, overrides: Partial<Fact> = {}): Fact {
  return { label, value, icon: null, link: null, path: null, ...overrides };
}

export function contentsRow(
  label: string,
  count: number,
  overrides: Partial<ContentsRow> = {},
): ContentsRow {
  return { label, count, link: null, path: null, of: null, ...overrides };
}

/** One entity view: a bare level by default, with whatever the test asserts on laid over it. */
export function entityView(kind: EntityKind, overrides: Partial<EntityView> = {}): EntityView {
  const addr = overrides.addr ?? entityAddrOf(kind);
  return {
    addr,
    path: [],
    name: name(`NAME_${kind}`),
    label: `${kind} #${addr.id}`,
    span: [0, 0],
    dirty: false,
    bytes: 128,
    nodes: [],
    overview: [],
    contents: [],
    ...overrides,
  };
}

export function entitySource(
  kind: EntityKind,
  overrides: Partial<EntitySource> = {},
): EntitySource {
  return {
    addr: entityAddrOf(kind),
    text: `${kind}={\n\tid=${ENTITY_IDS[kind]}\n}`,
    changed: [],
    truncated: false,
    ...overrides,
  };
}

export function fieldSchema(key: string, overrides: Partial<FieldSchema> = {}): FieldSchema {
  return {
    key,
    label: key,
    ty: "text",
    editable: false,
    derived: false,
    reference: null,
    enum_source: null,
    unit: null,
    ...overrides,
  };
}

/** A kind's schema; every kind ships one, and most of them are still empty. */
export function entitySchema(kind: EntityKind, fields: FieldSchema[] = []): EntitySchema {
  return { kind, fields };
}
