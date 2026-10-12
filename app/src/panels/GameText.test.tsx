import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("./useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../test/zustandSnapshot"));

import { useDetailsStore } from "../store/detailsStore";
import { resetStores } from "../store/storeFixture";
import { GameText } from "./GameText";

beforeEach(() => {
  resetStores();
  useDetailsStore.setState({
    resourceIcons: new Map([
      ["energy", "GFX_energy"],
      ["minerals", "GFX_minerals"],
    ]),
  });
});

describe("GameText", () => {
  it("shows a plain text as it is", () => {
    expect(renderToStaticMarkup(<GameText text="A ring of stone." />)).toBe("A ring of stone.");
  });

  it("colours the text between §Y and §! and draws the resource icons", () => {
    const html = renderToStaticMarkup(
      <GameText text="Gives §Y£energy£ 12§! and §G£minerals£ 8§!.\nNeeds §Hlevel 3§!." />,
    );
    expect(html).toContain('<span class="gt-Y">');
    expect(html).toContain('<span class="gt-G">');
    expect(html).toContain('<span class="gt-H">level 3</span>');
    expect(html.match(/class="gi gt-icon"/g)).toHaveLength(2);
    expect(html).toContain("<br/>");
    expect(html).not.toMatch(/[£§]/);
  });

  it("nests a colour inside another", () => {
    const html = renderToStaticMarkup(<GameText text="§Yfirst §Rsecond§! third§!" />);
    expect(html).toBe('<span class="gt-Y">first <span class="gt-R">second</span> third</span>');
  });

  it("draws nothing for an icon the game data has no sprite for", () => {
    const html = renderToStaticMarkup(<GameText text="a £mystery_icon£ b" />);
    expect(html).toBe("a  b");
  });
});
