import { describe, expect, it } from "vitest";
import type { HeaderField } from "../../../generated/HeaderField";
import { formatRange, handledKeys, parseRange, setBound, setScalar, setupViews } from "./gameSetup";

const header = (...entries: Array<[string, string]>): HeaderField[] =>
  entries.map(([key, value], i) => ({ key, value, line: i + 1 }));

const view = (fields: HeaderField[], label: string) =>
  setupViews(fields).find((one) => one.row.label === label)!;

describe("parseRange", () => {
  it("reads the bounds however the file spaces them", () => {
    expect(parseRange("{ min = 0 max = 3 }")).toEqual({ min: 0, max: 3 });
    expect(parseRange("{min=0 max=3}")).toEqual({ min: 0, max: 3 });
    expect(parseRange("{ min=0.5 max= 3 }", true)).toEqual({ min: 0.5, max: 3 });
  });

  it("refuses a scripted constant, a missing bound, a decimal where none is allowed and a list", () => {
    expect(parseRange("{ min = 0 max = @al }")).toBeNull();
    expect(parseRange("{ min = 0 }")).toBeNull();
    expect(parseRange("{ min = 0.5 max = 3 }")).toBeNull();
    expect(parseRange("{ 10 25 }")).toBeNull();
    expect(parseRange("@range")).toBeNull();
  });

  it("writes a range back the way the game writes it", () => {
    expect(formatRange(0, 3)).toBe("{ min = 0 max = 3 }");
    expect(formatRange(0.5, 1.25)).toBe("{ min = 0.5 max = 1.25 }");
  });
});

describe("setupViews", () => {
  it("reads each row's keys as numbers and leaves out the keys the file lacks", () => {
    const fields = header(
      ["num_empires", "{ min = 0 max = 3 }"],
      ["num_empire_default", "2"],
      ["fallen_empire_max", "4"],
      ["num_hyperlanes", "{ min = 0.5 max = 1.5 }"],
    );
    expect(view(fields, "AI empires")).toMatchObject({
      range: { kind: "bounds", min: 0, max: 3 },
      max: null,
      default: { kind: "number", value: 2 },
      hints: [],
    });
    expect(view(fields, "Fallen empires")).toMatchObject({
      range: null,
      max: { kind: "number", value: 4 },
      default: { kind: "missing" },
    });
    expect(view(fields, "Advanced starts")).toMatchObject({
      range: null,
      max: null,
      default: { kind: "missing" },
    });
    expect(view(fields, "Hyperlane density").range).toEqual({ kind: "bounds", min: 0.5, max: 1.5 });
  });

  it("keeps a scripted constant and a repeated key as raw text", () => {
    const fields = header(
      ["fallen_empire_max", "@al"],
      ["num_gateways", "{ min = 0 max = @gw }"],
      ["nomad_empire_max", "1"],
      ["nomad_empire_max", "2"],
    );
    expect(view(fields, "Fallen empires").max).toEqual({ kind: "raw", text: "@al" });
    expect(view(fields, "Gateways").range).toEqual({
      kind: "raw",
      text: "{ min = 0 max = @gw }",
    });
    expect(view(fields, "Nomad empires").max).toEqual({ kind: "raw", text: "1" });
  });

  it("warns of a default outside its bounds and a max below its min", () => {
    const fields = header(
      ["num_empires", "{ min = 1 max = 3 }"],
      ["num_empire_default", "5"],
      ["fallen_empire_max", "2"],
      ["fallen_empire_default", "3"],
      ["num_gateways", "{ min = 4 max = 2 }"],
      ["num_gateways_default", "3"],
    );
    expect(view(fields, "AI empires").hints).toEqual(["AI empires · Default 5 is outside 1–3"]);
    expect(view(fields, "Fallen empires").hints).toEqual([
      "Fallen empires · Default 3 is outside 0–2",
    ]);
    expect(view(fields, "Gateways").hints).toEqual([
      "Gateways · Max is below min",
      "Gateways · Default 3 is outside 4–2",
    ]);
  });
});

describe("handledKeys", () => {
  it("names the keys read as numbers, so the raw list keeps the rest", () => {
    const fields = header(
      ["name", '"My Galaxy"'],
      ["num_empires", "{ min = 0 max = 3 }"],
      ["fallen_empire_max", "@al"],
      ["extra_crisis_strength", "{ 10 25 }"],
    );
    expect([...handledKeys(fields)]).toEqual(["num_empires"]);
  });
});

describe("the ops a cell commits", () => {
  const fields = header(["num_empires", "{ min = 0 max = 3 }"]);

  it("writes a count, and a density with its decimals", () => {
    expect(setScalar("num_empire_default", 2)).toEqual({
      type: "SetHeaderField",
      key: "num_empire_default",
      value: "2",
    });
    expect(setScalar("num_hyperlanes_default", 0.75, true)).toMatchObject({ value: "0.75" });
  });

  it("refuses a decimal on an integer key and a number spelt with an exponent", () => {
    expect(setScalar("num_empire_default", 2.6)).toBeNull();
    expect(setScalar("num_hyperlanes_default", 1e-7, true)).toBeNull();
    expect(setScalar("num_hyperlanes_default", 1e21, true)).toBeNull();
    expect(setBound("num_empires", fields, "max", 2.5)).toBeNull();
  });

  it("writes one bound and keeps the other as the header holds it now", () => {
    expect(setBound("num_empires", fields, "max", 5)).toEqual({
      type: "SetHeaderField",
      key: "num_empires",
      value: "{ min = 0 max = 5 }",
    });
    const moved = header(["num_empires", "{ min = 1 max = 3 }"]);
    expect(setBound("num_empires", moved, "max", 5)).toMatchObject({
      value: "{ min = 1 max = 5 }",
    });
  });

  it("starts a range the file lacks with both bounds at the value committed", () => {
    expect(setBound("num_gateways", fields, "max", 2)).toMatchObject({
      value: "{ min = 2 max = 2 }",
    });
  });

  it("leaves a range it cannot read to the raw list", () => {
    const scripted = header(["num_gateways", "{ min = 0 max = @gw }"]);
    expect(setBound("num_gateways", scripted, "min", 1)).toBeNull();
  });
});
