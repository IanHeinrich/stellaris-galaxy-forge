import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("zustand", () => import("../test/zustandSnapshot"));
vi.mock("react/jsx-dev-runtime", () => import("../test/drawn"));

import { mockedIpc } from "../test/ipc";
import { drawnBy, drawnButton } from "../test/drawn";
import { useScriptEditorStore } from "../store/scriptEditorStore";
import { CHANGED_TITLE, ScriptSnippet } from "./ScriptSnippet";

const VS_CODE = { kind: "found", id: "vscode" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  useScriptEditorStore.setState({ ...useScriptEditorStore.getInitialState() });
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

  it("gives a snippet with a source a bar of Copy and the Open button, and its line where known", async () => {
    const file = "C:/Stellaris/common/solar_system_initializers/basic.txt";
    const html = drawnBy(() =>
      renderToStaticMarkup(<ScriptSnippet text="size = 5" source={{ file, line: 12 }} />),
    );
    expect(html).toContain('<div class="snippet-bar"><span class="snippet-where">line 12</span>');
    expect(html).not.toContain("basic.txt<");
    expect(html).toContain(">Copy</button>");
    expect(html).toContain(`<button type="button" class="link" title="${file}">Open file</button>`);
    expect(renderToStaticMarkup(<ScriptSnippet text="size = 5" source={{ file }} />)).toContain(
      '<span class="snippet-where"></span>',
    );

    useScriptEditorStore.setState({ choice: { pick: VS_CODE, name: "VS Code", remember: true } });
    mockedIpc.openInEditor.mockResolvedValue({ fell_back: false, steam_replaces: false });
    drawnBy(() =>
      renderToStaticMarkup(<ScriptSnippet text="size = 5" source={{ file, line: 12 }} />),
    );
    drawnButton("Open in VS Code").onClick();
    await vi.waitFor(() => expect(mockedIpc.openInEditor).toHaveBeenCalledWith(file, 12, VS_CODE));
    expect(mockedIpc.openScript).not.toHaveBeenCalled();
  });

  it("draws the line bar beside the marked lines, and shows them past the fold", () => {
    const text = Array.from({ length: 20 }, (_, i) => `flag_${i + 1} = yes`).join("\n");
    const html = renderToStaticMarkup(<ScriptSnippet text={text} mark={{ first: 14, last: 16 }} />);
    expect(lines(html)).toHaveLength(20);
    expect(html).not.toContain("Show all");
    const marked = [
      ...html.matchAll(
        /<span class="snippet-line marked">(.*?)<\/span>(?=<span class="snippet-line|<\/pre>)/g,
      ),
    ];
    expect(marked.map((m) => m[1].replace(/<[^>]*>/g, ""))).toEqual([
      "flag_14 = yes",
      "flag_15 = yes",
      "flag_16 = yes",
    ]);
    expect(html).not.toContain("Marked lines were changed by an edit.");
    expect(html).not.toContain(CHANGED_TITLE);
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
