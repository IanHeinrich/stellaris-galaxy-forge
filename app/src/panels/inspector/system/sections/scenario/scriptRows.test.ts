import { describe, expect, it } from "vitest";
import type { ReferenceVia } from "../../../../../generated/ReferenceVia";
import type { ScriptRow } from "../../../../../generated/ScriptRow";
import type { ScriptRowKind } from "../../../../../generated/ScriptRowKind";
import { groupRows, KIND_CAP, summaryLine } from "./scriptRows";

function row(
  kind: ScriptRowKind,
  name: string,
  overrides: Partial<ScriptRow> = {},
  vias: ReferenceVia[] = ["call"],
): ScriptRow {
  return {
    kind,
    name,
    title: null,
    timing: "unknown",
    fired_by: null,
    sites: [
      {
        location: {
          file: `C:/g/${name}.txt`,
          display: `common/${name}.txt:1`,
          line: 1,
          layer: "vanilla",
        },
        via: vias[0] ?? null,
        token: null,
      },
    ],
    site_count: 1,
    vias,
    pinned: false,
    ...overrides,
  };
}

const NONE: ReadonlySet<ScriptRowKind> = new Set();

describe("groupRows", () => {
  it("lists the pinned rows first, uncapped, and caps each kind's group", () => {
    const pinned = [
      row("initializer", "own_init", { pinned: true }),
      row("scenario_effect", "effect", { pinned: true }),
    ];
    const effects = Array.from({ length: KIND_CAP + 3 }, (_, i) =>
      row("scripted_effect", `fx_${i}`),
    );
    const grouped = groupRows([...pinned, ...effects, row("event", "distar.1")], "", NONE);

    expect(grouped.pinned.map((r) => r.name)).toEqual(["own_init", "effect"]);
    expect(grouped.groups.map((g) => g.kind)).toEqual(["scripted_effect", "event"]);
    expect(grouped.groups[0].rows).toHaveLength(KIND_CAP);
    expect(grouped.groups[0].hidden).toBe(3);
    expect(grouped.matched).toBe(KIND_CAP + 6);

    const opened = groupRows([...pinned, ...effects], "", new Set(["scripted_effect"]));
    expect(opened.groups[0].rows).toHaveLength(KIND_CAP + 3);
    expect(opened.groups[0].hidden).toBe(0);
  });

  it("filters on the name, the title and the path, and lifts the caps while it is typed in", () => {
    const rows = [
      row("event", "distar.290", { title: "The Beacon Wakes" }),
      row("event", "distar.291"),
      ...Array.from({ length: KIND_CAP + 1 }, (_, i) => row("scripted_effect", `swnd_fx_${i}`)),
    ];

    expect(groupRows(rows, "beacon", NONE).groups[0].rows.map((r) => r.name)).toEqual([
      "distar.290",
    ]);
    expect(groupRows(rows, "DISTAR.291", NONE).matched).toBe(1);
    expect(groupRows(rows, "common/swnd_fx_3.txt", NONE).matched).toBe(1);

    const wide = groupRows(rows, "swnd", NONE);
    expect(wide.groups[0].rows).toHaveLength(KIND_CAP + 1);
    expect(wide.groups[0].hidden).toBe(0);
    expect(groupRows(rows, "nothing", NONE).matched).toBe(0);
  });
});

describe("summaryLine", () => {
  it("names each way in once and then the layer that won", () => {
    const many = row("scripted_effect", "swnd_setup", { site_count: 8 }, [
      "event_target",
      "star_flag",
      "event_target",
    ]);
    expect(summaryLine(many)).toBe("event_target, has_star_flag · vanilla");
    expect(summaryLine(row("scenario_effect", "effect", {}, []))).toBe("vanilla");
  });
});
