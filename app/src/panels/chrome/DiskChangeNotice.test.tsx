import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { buttonIn } from "../../test/elements";
import { readyAs } from "../../test/session";
import { DiskChangeNotice } from "./DiskChangeNotice";

const notice = () => renderToStaticMarkup(<DiskChangeNotice />);
const button = (label: string) => buttonIn(<DiskChangeNotice />, label);

const CHANGED = { change: "changed" as const, kept: false, at: 1000 };

beforeEach(() => {
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("the banner for a file changed on disk", () => {
  it("is absent with no change, once kept, after a later save, and for a file that is gone", () => {
    readyAs(SCENARIO_RESULT);
    expect(notice()).toBe("");

    useFileSessionStore.setState({ diskChange: { ...CHANGED, kept: true } });
    expect(notice()).toBe("");

    useFileSessionStore.setState({ diskChange: CHANGED, savedAt: 2000 });
    expect(notice()).toBe("");

    useFileSessionStore.setState({ diskChange: { ...CHANGED, change: "gone" }, savedAt: null });
    expect(notice()).toBe("");
  });

  it("warns before Reload that it drops unsaved changes, and answers on each button", () => {
    readyAs(SCENARIO_RESULT);
    const answerDiskChange = vi.fn(async () => undefined);
    useFileSessionStore.setState({ diskChange: CHANGED, dirty: true, answerDiskChange });

    expect(notice()).toContain(
      "my_galaxy.txt changed on disk. Reloading drops your unsaved changes and their undo history.",
    );
    button("Reload")!.props.onClick();
    button("Keep my changes")!.props.onClick();
    expect(answerDiskChange.mock.calls).toEqual([["reload"], ["keep"]]);
  });

  it("says a save may have been written by Stellaris, and offers Not now without unsaved changes", () => {
    readyAs(OPEN_RESULT);
    useFileSessionStore.setState({ diskChange: CHANGED });

    expect(notice()).toContain("This save changed on disk. Stellaris may have saved over it.");
    expect(notice()).not.toContain("Reloading drops");
    expect(button("Reload")).toBeDefined();
    expect(button("Not now")).toBeDefined();
  });
});
