import { describe, expect, it } from "vitest";
import { dedent, lineText, scriptLines, scriptTokens, type ScriptToken } from "./scriptText";

/** The tokens that take a colour, as `kind:text`. */
const coloured = (text: string) =>
  scriptTokens(text)
    .filter((t: ScriptToken) => t.kind !== "space")
    .map((t) => `${t.kind}:${t.text}`);

describe("scriptTokens", () => {
  it("tells keys from values, and colours numbers, strings, yes and no", () => {
    expect(coloured('size = 15 name = "NAME_X" has_ring = yes owner = none')).toEqual([
      "key:size",
      "operator:=",
      "number:15",
      "keyword:name",
      "operator:=",
      'string:"NAME_X"',
      "key:has_ring",
      "operator:=",
      "bool:yes",
      "key:owner",
      "operator:=",
      "value:none",
    ]);
  });

  it("reads every comparison operator, glued to its words or not", () => {
    expect(coloured("a>=1 b<=2 c>3 d<4 e!=5 f?=6 g==7")).toEqual([
      "key:a",
      "operator:>=",
      "number:1",
      "key:b",
      "operator:<=",
      "number:2",
      "key:c",
      "operator:>",
      "number:3",
      "key:d",
      "operator:<",
      "number:4",
      "key:e",
      "operator:!=",
      "number:5",
      "key:f",
      "operator:?=",
      "number:6",
      "key:g",
      "operator:==",
      "number:7",
    ]);
  });

  it("runs a comment to the end of its line, braces and quotes included", () => {
    expect(coloured('a = { # no } here "x\nb = 1 }')).toEqual([
      "key:a",
      "operator:=",
      "brace:{",
      'comment:# no } here "x',
      "key:b",
      "operator:=",
      "number:1",
      "brace:}",
    ]);
  });

  it("keeps a # inside a quoted string, and runs an unclosed quote to the end", () => {
    expect(coloured('name = "A # B" desc = "open')).toEqual([
      "keyword:name",
      "operator:=",
      'string:"A # B"',
      "key:desc",
      "operator:=",
      'string:"open',
    ]);
  });

  it("skips a BOM and reads CR as whitespace", () => {
    const tokens = scriptTokens("﻿a = 1\r\nb = 2\r\n");
    expect(tokens.map((t) => t.text).join("")).toBe("a = 1\r\nb = 2\r\n");
    expect(tokens.filter((t) => t.kind !== "space").map((t) => t.kind)).toEqual([
      "key",
      "operator",
      "number",
      "key",
      "operator",
      "number",
    ]);
  });

  it("colours the language's keywords, scopes in any case, and @variables", () => {
    expect(
      coloured(
        "limit = { NOT = { exists = PREV } } add_hyperlane = { from = this to = prevprev } " +
          "set_owner = event_target:owner FROMFROM = { } root.from = { } size = @huge_planet",
      ),
    ).toEqual([
      "keyword:limit",
      "operator:=",
      "brace:{",
      "keyword:NOT",
      "operator:=",
      "brace:{",
      "keyword:exists",
      "operator:=",
      "scope:PREV",
      "brace:}",
      "brace:}",
      "key:add_hyperlane",
      "operator:=",
      "brace:{",
      "scope:from",
      "operator:=",
      "scope:this",
      "key:to",
      "operator:=",
      "scope:prevprev",
      "brace:}",
      "key:set_owner",
      "operator:=",
      "scope:event_target:owner",
      "scope:FROMFROM",
      "operator:=",
      "brace:{",
      "brace:}",
      "scope:root.from",
      "operator:=",
      "brace:{",
      "brace:}",
      "key:size",
      "operator:=",
      "variable:@huge_planet",
    ]);
  });

  it("reads a word before a brace as a key, and a keyword in a value as a plain value", () => {
    expect(coloured("random_list { 10 = { } } class = random")).toEqual([
      "keyword:random_list",
      "brace:{",
      "number:10",
      "operator:=",
      "brace:{",
      "brace:}",
      "brace:}",
      "key:class",
      "operator:=",
      "value:random",
    ]);
  });
});

describe("dedent", () => {
  it("moves the lines left by the indent they share, leaving out a first line with none", () => {
    expect(dedent("if = {\n\t\tlimit = { a = yes }\n\t\tb = 1\n\t}")).toBe(
      "if = {\n\tlimit = { a = yes }\n\tb = 1\n}",
    );
  });

  it("counts an indented first line, and ignores blank lines", () => {
    expect(dedent("    a = 1\n\n      b = 2")).toBe("a = 1\n\n  b = 2");
  });

  it("drops a BOM and the CR before each line feed", () => {
    expect(dedent("﻿a = {\r\n\t\tb = 1\r\n\t}")).toBe("a = {\n\tb = 1\n}");
  });
});

describe("scriptLines", () => {
  it("gives one entry per line, dedented, with a string across lines split between them", () => {
    const lines = scriptLines('a = {\n\t\tdesc = "one\n\t\ttwo"\n\t}');
    expect(lines.map(lineText)).toEqual(["a = {", '\tdesc = "one', '\ttwo"', "}"]);
    expect(lines[2].tokens).toEqual([{ kind: "string", text: '\ttwo"' }]);
  });

  it("marks the lines a changed range covers, by offsets into the text as given", () => {
    const text = "a = {\n\tb = 1\n\tc = 2\n}";
    const lines = scriptLines(text, [[text.indexOf("\tc"), text.indexOf("}")]]);
    expect(lines.map((l) => l.changed)).toEqual([false, false, true, false]);
  });

  it("marks nothing for an empty range", () => {
    expect(scriptLines("a = 1\nb = 2", [[6, 6]]).some((l) => l.changed)).toBe(false);
  });
});
