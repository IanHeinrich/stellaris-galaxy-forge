import { describe, expect, it } from "vitest";
import { depositTypeView } from "../../store/fixtures/planet";
import { depositBars } from "./depositBars";

describe("deposit bar names", () => {
  it("reads a deposit's name without its icons and colours", () => {
    const views = new Map([
      [
        "d_rich_mountain",
        depositTypeView("d_rich_mountain", { name: "§YRich§! £minerals£ Mountains" }),
      ],
    ]);
    const [row] = depositBars([{ key: "d_rich_mountain", chance: 0.5 }], views);
    expect(row.name).toBe("Rich Mountains");
  });

  it("falls back to the key in words where only an icon and an amount are left", () => {
    const views = new Map([["d_odd_site", depositTypeView("d_odd_site", { name: "£energy£ +5" })]]);
    const [row] = depositBars([{ key: "d_odd_site", chance: 0.5 }], views);
    expect(row.name).toBe("Odd Site");
  });
});
