import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../../test/prefs";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { PAINT_CHECK, PAINT_CHOICE_WHY, PAINT_UNTICKED } from "../../lib/paintCopy";
import { usePaintModStore } from "../../store/paintModStore";
import { paintModView } from "../../test/builders";
import { elements, shown } from "../../test/elements";
import { PaintChoice } from "./PaintChoice";

const choice = () => renderToStaticMarkup(<PaintChoice />);
const box = (html: string) => html.match(/<input type="checkbox"[^>]*>/)![0];

beforeEach(() => {
  stubPrefs();
  usePaintModStore.setState({
    ...usePaintModStore.getInitialState(),
    known: true,
    paintMod: paintModView(),
    paintChoice: true,
  });
});

describe("the Paint a Galaxy choice", () => {
  it("follows the standing choice, says why, and shows the mod's state while ticked", () => {
    const html = choice();
    expect(box(html)).toContain("checked=");
    expect(shown(html)).toContain(PAINT_CHECK);
    expect(shown(html)).toContain(PAINT_CHOICE_WHY);
    expect(html).toContain("paint-mod-status");
    expect(html).not.toContain('class="setup-warn" role="alert"');
  });

  it("warns in place of the mod's state while unticked", () => {
    usePaintModStore.setState({ paintChoice: false });
    const html = choice();
    expect(box(html)).not.toContain("checked=");
    expect(html).not.toContain("paint-mod-status");
    expect(html).toContain('class="setup-warn" role="alert"');
    expect(shown(html)).toContain(PAINT_UNTICKED.split(":")[0]);
  });

  it("makes ticking the box the standing choice", () => {
    usePaintModStore.setState({ paintChoice: false });
    const input = elements(<PaintChoice />).find(
      (el): el is ReactElement<{ onChange: (e: unknown) => void }> => el.type === "input",
    )!;
    input.props.onChange({ currentTarget: { checked: true } });
    expect(usePaintModStore.getState().paintChoice).toBe(true);
  });
});
