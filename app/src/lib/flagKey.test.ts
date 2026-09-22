import { describe, expect, it } from "vitest";
import { saveMeta } from "../test/builders";
import { COUNTRY } from "./details/fixture";
import { empireFlagKey } from "./details/fleets";
import { saveFlagKey } from "./flagKey";

const ICON = { category: "human", file: "flag_human_9.dds" };
const BACKGROUND = { category: "backgrounds", file: "00_solid.dds" };

describe("saveFlagKey", () => {
  it("keys the header's flag by its first four colours, the map colours after them left out", () => {
    const meta = saveMeta({
      flag: {
        icon: ICON,
        background: BACKGROUND,
        colors: ["blue", "black", "null", "null", "intense_red", "light_pink"],
        use_map_color: true,
      },
    });
    expect(saveFlagKey(meta)).toBe(
      "empire_flag:00_solid.dds:human/flag_human_9.dds:blue,black,null,null",
    );
  });

  it("gives the key the same empire's country gives", () => {
    const meta = saveMeta({
      flag: { icon: ICON, background: BACKGROUND, colors: ["blue", "black"], use_map_color: false },
    });
    expect(saveFlagKey(meta)).toBe(empireFlagKey(COUNTRY));
  });

  it("is null without a header, a flag, an icon or a background", () => {
    const flag = { icon: ICON, background: BACKGROUND, colors: [], use_map_color: false };
    expect(saveFlagKey(null)).toBeNull();
    expect(saveFlagKey(saveMeta())).toBeNull();
    expect(saveFlagKey(saveMeta({ flag: { ...flag, icon: null } }))).toBeNull();
    expect(saveFlagKey(saveMeta({ flag: { ...flag, background: null } }))).toBeNull();
  });
});
