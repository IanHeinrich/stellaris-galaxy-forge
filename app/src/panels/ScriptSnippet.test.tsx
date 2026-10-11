import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("react/jsx-dev-runtime", () => import("../test/drawn"));

import { mockedIpc } from "../test/ipc";
import { drawnBy, drawnButton } from "../test/drawn";
import { ScriptSnippet } from "./ScriptSnippet";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Each line the snippet shows, as plain text. */
const lines = (html: string) =>
  [
    ...html.matchAll(
      /<span class="snippet-line[^"]*"[^>]*>(.*?)<\/span>(?=<span class="snippet-line|<\/pre>)/g,
    ),
  ].map((m) => m[1].replace(/<[^>]*>/g, ""));

describe("ScriptSnippet", () => {
  it("shows the text in its own case, moved left by the indent its lines share", () => {
    const html = renderToStaticMarkup(
      <ScriptSnippet text={"USAGE_ODDS = {\n\t\t\tBASE = 0\n\t\t\t# Note\n\t\t}"} />,
    );
    expect(lines(html)).toEqual(["USAGE_ODDS = {", "\tBASE = 0", "\t# Note", "}"]);
    expect(html).toContain('<span class="snippet-comment"># Note</span>');
    expect(html).not.toContain("snippet-bar");
    expect(html).not.toContain("snippet-more");
  });

  it("shows twelve lines of a longer one, with a control for the rest", () => {
    const text = Array.from({ length: 14 }, (_, i) => `flag_${i} = yes`).join("\n");
    const html = drawnBy(() => renderToStaticMarkup(<ScriptSnippet text={text} />));
    expect(lines(html)).toHaveLength(12);
    expect(html).not.toContain("flag_12");
    expect(html).toContain(
      '<div class="snippet-foot"><button type="button" class="link snippet-more" aria-expanded="false"><span class="tri">▸</span>Show all 14 lines</button></div>',
    );
  });

  it("shows no control for twelve lines or fewer", () => {
    const text = Array.from({ length: 12 }, (_, i) => `flag_${i} = yes`).join("\n");
    const html = renderToStaticMarkup(<ScriptSnippet text={text} />);
    expect(lines(html)).toHaveLength(12);
    expect(html).not.toContain("Show all");
  });

  it("gives a snippet with a source a bar of Copy and Open file, and its line where known", () => {
    const file = "C:/Stellaris/common/solar_system_initializers/basic.txt";
    const html = drawnBy(() =>
      renderToStaticMarkup(<ScriptSnippet text="size = 5" source={{ file, line: 12 }} />),
    );
    expect(html).toContain('<div class="snippet-bar"><span class="snippet-where">line 12</span>');
    expect(html).not.toContain("basic.txt<");
    expect(html).toContain(">Copy</button>");
    drawnButton("Open file").onClick();
    expect(mockedIpc.openScript).toHaveBeenCalledWith(file, false);
    expect(renderToStaticMarkup(<ScriptSnippet text="size = 5" source={{ file }} />)).toContain(
      '<span class="snippet-where"></span>',
    );
  });

  it("lays text out unfolded and wrapped, and tints the changed tokens under a legend", () => {
    const text = Array.from({ length: 14 }, (_, i) => `flag_${i} = yes`).join(" ");
    const at = text.indexOf("flag_13");
    const html = renderToStaticMarkup(
      <ScriptSnippet text={text} changed={[[at, at + 7]]} layout />,
    );
    expect(html).toContain('<pre class="snippet-text wrap">');
    expect(lines(html)).toHaveLength(14);
    expect(html).not.toContain("Show all");
    expect(html).toContain(
      '<span class="snippet-line changed" title="changed by an edit"><span class="snippet-key snippet-changed">flag_13</span>',
    );
    expect(html).toContain("Marked lines were changed by an edit.");
    expect(renderToStaticMarkup(<ScriptSnippet text={text} layout />)).not.toContain(
      "Marked lines",
    );
  });
});
