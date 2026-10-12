import { describe, expect, it } from "vitest";
import { parseGameText, plainGameText, type GameTextSpan } from "./gameText";

const text = (t: string): GameTextSpan => ({ kind: "text", text: t });
const icon = (key: string): GameTextSpan => ({ kind: "icon", key });
const colour = (c: string, ...children: GameTextSpan[]): GameTextSpan => ({
  kind: "colour",
  colour: c,
  children,
});
const BREAK: GameTextSpan = { kind: "break" };

const DETAILS =
  "Produces §Y£energy£ 12§! and §G£minerals£ 8§! each month.\n" + "Needs a §Hlevel 3§! starbase.";

describe("parseGameText", () => {
  it("leaves a plain text as one span", () => {
    expect(parseGameText("A ring of stone.")).toEqual([text("A ring of stone.")]);
    expect(parseGameText("")).toEqual([]);
  });

  it("reads the colours, icons and break of a megastructure details text", () => {
    expect(parseGameText(DETAILS)).toEqual([
      text("Produces "),
      colour("Y", icon("energy"), text(" 12")),
      text(" and "),
      colour("G", icon("minerals"), text(" 8")),
      text(" each month."),
      BREAK,
      text("Needs a "),
      colour("H", text("level 3")),
      text(" starbase."),
    ]);
  });

  it("nests colours and closes only the innermost with each §!", () => {
    expect(parseGameText("§Ya §Rb§! c§! d")).toEqual([
      colour("Y", text("a "), colour("R", text("b")), text(" c")),
      text(" d"),
    ]);
  });

  it("closes a colour left open at the end and drops a stray §!", () => {
    expect(parseGameText("§Bopen")).toEqual([colour("B", text("open"))]);
    expect(parseGameText("a§!b")).toEqual([text("ab")]);
  });

  it("drops a colour that wraps nothing", () => {
    expect(parseGameText("a§Y§!b")).toEqual([text("a"), text("b")]);
  });

  it("takes both a written \n and a real newline as a break", () => {
    expect(parseGameText("one\ntwo\nthree")).toEqual([
      text("one"),
      BREAK,
      text("two"),
      BREAK,
      text("three"),
    ]);
  });

  it("keeps an icon whose key the app has no sprite for, for the renderer to decide", () => {
    expect(parseGameText("£mystery_icon£ x")).toEqual([icon("mystery_icon"), text(" x")]);
  });

  it("ignores the size after a pipe in an icon", () => {
    expect(parseGameText("£energy|2£")).toEqual([icon("energy")]);
  });

  it("keeps a § or £ that opens nothing as text", () => {
    expect(parseGameText("5 £ and 3 §")).toEqual([text("5 £ and 3 §")]);
    expect(parseGameText("£ two words £")).toEqual([text("£ two words £")]);
  });
});

describe("plainGameText", () => {
  it("takes out icons and colours and turns breaks into spaces", () => {
    expect(plainGameText(DETAILS)).toBe("Produces 12 and 8 each month. Needs a level 3 starbase.");
  });

  it("reads an orbital deposit's amount-only name as the amount", () => {
    expect(plainGameText("£energy£ +5")).toBe("+5");
    expect(plainGameText("£energy£")).toBe("");
  });

  it("leaves a plain text as it is", () => {
    expect(plainGameText("Rich Mountains")).toBe("Rich Mountains");
  });
});
