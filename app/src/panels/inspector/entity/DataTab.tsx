import { useState } from "react";
import type { EntityAddr } from "../../../generated/EntityAddr";
import type { EntityKind } from "../../../generated/EntityKind";
import type { EntityNode } from "../../../generated/EntityNode";
import type { FieldSchema } from "../../../generated/FieldSchema";
import {
  capabilityFor,
  kindWords,
  referenceText,
  rowMatches,
  scalarText,
  type ValueText,
} from "../../../lib/entities";
import { useInspectorStore } from "../../../store/inspectorStore";
import { FILTER_MIN, FilterField } from "../../parts";
import { ChangedBadge, DrillLink, Empty, Properties, PropertyRow } from "../parts";
import { useEntitySchema, useEntityView, useOpenEntity } from "./useEntity";

interface DataRow {
  node: EntityNode;
  label: string;
  field: FieldSchema | undefined;
  /** The kind this row's value names, from the schema or from the list it was drilled into. */
  reference: EntityKind | null;
  /** What the filter reads: a scalar's text, or a block's count. */
  text: string;
}

/** A keyless child carries its index (`#3`) as the last step of its path. */
function labelOf(node: EntityNode, field: FieldSchema | undefined): string {
  return field?.label ?? node.key ?? node.path[node.path.length - 1] ?? "";
}

function rowOf(
  node: EntityNode,
  fields: Map<string, FieldSchema>,
  listOf: EntityKind | null,
): DataRow {
  const field = node.key === null ? undefined : fields.get(node.key);
  const reference =
    node.value.kind === "scalar"
      ? field?.ty === "reference"
        ? field.reference
        : node.key === null
          ? listOf
          : null
      : (field?.reference ?? null);
  return {
    node,
    label: labelOf(node, field),
    field,
    reference,
    text: node.value.kind === "scalar" ? node.value.text : String(node.value.count),
  };
}

function ScalarCell({ row }: { row: DataRow }) {
  const opener = useOpenEntity();
  if (row.node.value.kind !== "scalar") return null;
  const { text, form } = row.node.value;
  const reference = row.reference;
  const shown: ValueText = reference ? referenceText(text, form) : scalarText(text, form);
  const addr: EntityAddr | null = reference === null ? null : { kind: reference, id: Number(text) };
  if (reference === null || addr === null || shown.title !== undefined || !opener.opens(addr)) {
    return (
      <span className="mono" title={shown.title}>
        {shown.text}
      </span>
    );
  }
  const label = `${kindWords(reference)} ${shown.text}`;
  return (
    <DrillLink
      requires={capabilityFor(reference)}
      title={`Open ${label}`}
      onOpen={() => opener.open(addr, label)}
    >
      {shown.text}
    </DrillLink>
  );
}

/** A list or a block reads as its count and drills in, so no row ever nests another. */
function BlockCell({ row, parent }: { row: DataRow; parent: EntityAddr }) {
  const open = useInspectorStore((s) => s.open);
  if (row.node.value.kind === "scalar") return null;
  const { count } = row.node.value;
  return (
    <DrillLink
      title={`Open ${row.label}`}
      onOpen={() =>
        open({
          ref: { kind: "nodelist", parent, path: row.node.path, of: row.reference },
          label: row.label,
        })
      }
    >
      {count}
    </DrillLink>
  );
}

/**
 * Every node at this level as one row, in save order with duplicates kept: the honest view of
 * the bytes. The schema decides a row's label and control, never whether it appears.
 */
export function DataTab({
  addr,
  path,
  listOf = null,
}: {
  addr: EntityAddr;
  path: readonly string[];
  listOf?: EntityKind | null;
}) {
  const { value: view, error } = useEntityView(addr, path);
  const fields = useEntitySchema(addr.kind);
  const [query, setQuery] = useState("");

  if (error !== undefined) {
    return (
      <Empty>
        This {kindWords(addr.kind)} could not be read: {error}
      </Empty>
    );
  }
  if (view === undefined) return <Empty>Reading the {kindWords(addr.kind)}…</Empty>;

  const rows = view.nodes.map((node) => rowOf(node, fields, listOf));
  if (rows.length === 0) return <Empty>Nothing is written here.</Empty>;
  const needle = query.trim();
  const shown = rows.filter((row) => rowMatches(row.label, row.text, needle));
  return (
    <>
      {rows.length > FILTER_MIN && (
        <FilterField label={`Filter ${rows.length} fields`} value={query} onChange={setQuery} />
      )}
      <Properties>
        {shown.map((row) => (
          <PropertyRow
            key={row.node.path.join("/")}
            label={row.label}
            title={row.field?.derived === true ? "the game recomputes this" : undefined}
          >
            {row.node.value.kind === "scalar" ? (
              <ScalarCell row={row} />
            ) : (
              <BlockCell row={row} parent={addr} />
            )}
            {row.field === undefined && <span className="muted ins-raw">raw</span>}
            {row.node.changed && <ChangedBadge />}
          </PropertyRow>
        ))}
      </Properties>
    </>
  );
}
