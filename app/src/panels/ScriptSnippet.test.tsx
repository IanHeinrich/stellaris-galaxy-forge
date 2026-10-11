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

  it("names its source in a bar with Copy and Open file, which opens the file", () => {
    const html = drawnBy(() =>
      renderToStaticMarkup(
        <ScriptSnippet
          text="size = 5"
          source={{ file: "C:/Stellaris/common/solar_system_initializers/basic.txt", line: 12 }}
        />,
      ),
    );
    expect(html).toContain(
      '<span class="snippet-file" title="C:/Stellaris/common/solar_system_initializers/basic.txt">basic.txt · line 12</span>',
    );
    expect(html).toContain(">Copy</button>");
    drawnButton("Open file").onClick();
    expect(mockedIpc.openScript).toHaveBeenCalledWith(
      "C:/Stellaris/common/solar_system_initializers/basic.txt",
      false,
    );
  });

  it("marks changed lines and says what the mark means; wraps when asked", () => {
    const html = renderToStaticMarkup(
      <ScriptSnippet text={"a = 1\nb = 2"} changed={[[6, 11]]} wrap />,
    );
    expect(html).toContain('<pre class="snippet-text wrap">');
    expect(html).toContain('<span class="snippet-line changed" title="changed by an edit">');
    expect(html).toContain("Marked lines were changed by an edit.");
  });
});
