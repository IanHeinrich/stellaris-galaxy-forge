import { describe, expect, it } from "vitest";
import type { IconPickerItem } from "./IconPicker";
import { hasFilter, iconPickerRows } from "./iconPickerRows";
import { FILTER_MIN } from "./parts";

const item = (key: string, label: string, group?: string): IconPickerItem => ({
  key,
  label,
  group,
});

const CLASSES: IconPickerItem[] = [
  item("pc_desert", "Desert World", "Dry"),
  item("pc_arid", "Arid World", "Dry"),
  item("pc_pd_dune", "Dune World", "Dry"),
  item("pc_ocean", "Ocean World", "Wet"),
  item("pc_continental", "Continental World", "Wet"),
  item("pc_gas_giant", "Gas Giant", "Uninhabitable"),
  ...Array.from({ length: FILTER_MIN }, (_, i) =>
    item(`pc_barren_${i}`, `Barren World ${i}`, "Uninhabitable"),
  ),
];

const shown = (query: string) =>
  iconPickerRows(CLASSES, query).map(({ item, header }) => [item.key, header]);

describe("an icon picker's rows", () => {
  it("has a filter box only above FILTER_MIN items", () => {
    expect(hasFilter(CLASSES.slice(0, FILTER_MIN))).toBe(false);
    expect(hasFilter(CLASSES.slice(0, FILTER_MIN + 1))).toBe(true);
  });

  it("lists every item, without a filter box, whatever the query", () => {
    const few = CLASSES.slice(0, FILTER_MIN);
    expect(iconPickerRows(few, "ocean")).toHaveLength(FILTER_MIN);
  });

  it("matches the label or the key, ignoring case", () => {
    expect(shown("OCEAN")).toEqual([["pc_ocean", true]]);
    expect(shown(" PC_PD ")).toEqual([["pc_pd_dune", true]]);
    expect(shown("world 1").map(([key]) => key)).toEqual([
      "pc_barren_1",
      ...Array.from({ length: 10 }, (_, i) => `pc_barren_${10 + i}`),
    ]);
  });

  it("shows a group's header only while the group has a match", () => {
    expect(shown("")).toEqual(
      CLASSES.map((c, i) => [c.key, i === 0 || c.group !== CLASSES[i - 1].group]),
    );
    expect(shown("ar")).toEqual([
      ["pc_arid", true],
      ["pc_barren_0", true],
      ...Array.from({ length: FILTER_MIN - 1 }, (_, i) => [`pc_barren_${i + 1}`, false]),
    ]);
    expect(shown("zzz")).toEqual([]);
  });

  it("puts the first match first, where Enter picks after typing", () => {
    expect(iconPickerRows(CLASSES, "world")[0].item.key).toBe("pc_desert");
    expect(iconPickerRows(CLASSES, "giant")[0].item.key).toBe("pc_gas_giant");
  });
});
