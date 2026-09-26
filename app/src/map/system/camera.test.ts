import { describe, expect, it } from "vitest";
import { fitScale, zoomLimits } from "./camera";

describe("the system camera's limits", () => {
  it("zooms out to half the fit and in until the largest disc fills the short side", () => {
    expect(fitScale(200, 800, 600)).toBe(1.5);
    expect(zoomLimits(200, 800, 600, 9)).toEqual({ minScale: 0.75, maxScale: 600 / 18 });
  });
});
