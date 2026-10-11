import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import type { EditorChoices } from "../../generated/EditorChoices";
import { escaped, shown } from "../../test/elements";
import type { EditorChoice } from "../../store/scriptEditorStore";
import { ChooserBody, type ChooserBodyProps } from "./EditorChooser";

const FOUND: EditorChoices = {
  editors: [
    { id: "vscode", name: "VS Code" },
    { id: "notepad_plus_plus", name: "Notepad++" },
  ],
  other: null,
  steam_replaces: false,
};

const noop = () => undefined;

function html(props: Partial<ChooserBodyProps>): string {
  return renderToStaticMarkup(
    <ChooserBody
      target={{ file: "C:/mods/mine/common/solar_system_initializers/x.txt", line: 12 }}
      choices={FOUND}
      last={null}
      onChoose={noop}
      onBrowse={noop}
      onCancel={noop}
      {...props}
    />,
  );
}

/** The label of each radio, in order, and which one is selected. */
function radios(markup: string): { labels: string[]; checked: string | undefined } {
  const rows = [
    ...markup.matchAll(/<label[^>]*><input type="radio"([^>]*)\/><span>(.*?)<\/span>/g),
  ];
  return {
    labels: rows.map((m) => m[2]),
    checked: rows.find((m) => m[1].includes("checked"))?.[2],
  };
}

describe("the editor chooser", () => {
  it("lists the editors found, then the system default and Other…, the first selected and kept", () => {
    const markup = html({});
    expect(radios(markup)).toEqual({
      labels: ["VS Code", "Notepad++", "System default", "Other…"],
      checked: "VS Code",
    });
    expect(markup).toMatch(/<input type="checkbox" checked=""\/><span>Remember my choice<\/span>/);
    expect(shown(markup)).toContain("x.txt, line 12");
    expect(markup).toContain(">Open<");
    expect(markup).not.toContain("Steam replaces");
  });

  it("selects the last pick, and keeps the checkbox as it was left", () => {
    const last: EditorChoice = {
      pick: { kind: "found", id: "notepad_plus_plus" },
      name: "Notepad++",
      remember: false,
    };
    const markup = html({ last });
    expect(radios(markup).checked).toBe("Notepad++");
    expect(markup).toMatch(/<input type="checkbox"\/><span>Remember my choice<\/span>/);
  });

  it("says that Steam replaces a file of the game or a Workshop mod", () => {
    const markup = html({ choices: { ...FOUND, steam_replaces: true } });
    expect(markup).toContain(
      escaped(
        "Steam replaces this file when the game or the mod updates, so your changes to it are lost.",
      ),
    );
  });

  it("offers the system default and a program of one's own when no editor is found", () => {
    expect(radios(html({ choices: { editors: [], other: null, steam_replaces: false } }))).toEqual({
      labels: ["System default", "Other…"],
      checked: "System default",
    });
  });

  it("names the program picked under Other…, and saves without a file from the Help menu", () => {
    const last: EditorChoice = {
      pick: { kind: "other", args: "-l {line} {file}" },
      name: "ed.exe",
      remember: true,
    };
    const markup = html({ last, target: null, choices: { ...FOUND, other: "ed.exe" } });
    expect(radios(markup).checked).toBe("Other…");
    expect(shown(markup)).toContain("ed.exe Browse…");
    expect(markup).not.toContain('type="text" value="ed.exe"');
    expect(markup).toContain('value="-l {line} {file}"');
    expect(markup).toMatch(/<button type="submit"[^>]*>Save</);
    expect(markup).not.toMatch(/<button type="submit"[^>]*disabled/);
  });

  it("cannot open with Other… before a program is picked", () => {
    const last: EditorChoice = {
      pick: { kind: "other", args: "{file}" },
      name: null,
      remember: true,
    };
    const markup = html({ last });
    expect(shown(markup)).toContain("No program chosen yet Browse…");
    expect(markup).toMatch(/<button type="submit"[^>]*disabled/);
  });
});
