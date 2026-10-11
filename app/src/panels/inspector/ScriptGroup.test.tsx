import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import type { RawStatement } from "../../generated/RawStatement";
import { ScriptGroup } from "./ScriptGroup";

const statement = (key: string, text: string): RawStatement => ({ key, text, modelled: 0 });

const WARNING =
  "On a scenario map they run before hyperlanes exist, so lines that look for a neighbouring system find none.";

const group = (statements: RawStatement[]) =>
  renderToStaticMarkup(<ScriptGroup id="test.script" statements={statements} file={null} />);

describe("the script an initializer runs at game start", () => {
  it("warns where a line looks for a neighbouring system", () => {
    const html = group([
      statement(
        "every_neighbor_system",
        "every_neighbor_system = {\n\tset_star_flag = near_home\n}",
      ),
    ]);
    expect(html).toContain('<span class="ins-group-title">');
    expect(html).toContain(">Script at game start</span>");
    expect(html).toContain('<span class="ins-group-tail">3 lines</span>');
    expect(html).toContain(`<div class="ins-warn">${WARNING}</div>`);
  });

  it("gives no warning where no line looks for a neighbour", () => {
    const html = group([
      statement("set_star_flag", "set_star_flag = home"),
      statement("random_list", "random_list = { 10 = { set_star_flag = near_home } }"),
    ]);
    expect(html).toContain(">Script at game start</span>");
    expect(html).not.toContain("ins-warn");
    expect(html).not.toContain("neighbouring system");
  });

  it("gives no warning where a neighbour scope's name is only a value", () => {
    const html = group([
      statement("set_star_flag", "set_star_flag = every_neighbor_system"),
      statement("random_list", 'random_list = { 10 = { log = "random_neighbor_system" } }'),
    ]);
    expect(html).toContain(">Script at game start</span>");
    expect(html).not.toContain("ins-warn");
    expect(html).not.toContain("neighbouring system");
  });

  it("shows nothing for an initializer that runs no script", () => {
    expect(group([])).toBe("");
  });
});
