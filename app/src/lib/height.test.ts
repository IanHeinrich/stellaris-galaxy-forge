import { describe, expect, it } from "vitest";
import { HEIGHT_SLIDER_MAX, heightToSlider, roundHeight, sliderToHeight } from "./height";

describe("the Height slider's curve", () => {
  it("lies flat at the middle of the track and reaches the full height at either end", () => {
    expect(sliderToHeight(0)).toBe(0);
    expect(heightToSlider(0)).toBe(0);
    expect(sliderToHeight(1)).toBe(HEIGHT_SLIDER_MAX);
    expect(sliderToHeight(-1)).toBe(-HEIGHT_SLIDER_MAX);
    expect(heightToSlider(HEIGHT_SLIDER_MAX)).toBe(1);
    expect(heightToSlider(-HEIGHT_SLIDER_MAX)).toBe(-1);
  });

  it("holds the slider at its ends for a height beyond its reach", () => {
    expect(heightToSlider(4 * HEIGHT_SLIDER_MAX)).toBe(1);
    expect(heightToSlider(-4 * HEIGHT_SLIDER_MAX)).toBe(-1);
    expect(sliderToHeight(2)).toBe(HEIGHT_SLIDER_MAX);
  });

  it("goes there and back to the same height", () => {
    for (const height of [-500, -123.4, -1, -0.1, 0.1, 0.5, 7, 250, 499.9]) {
      expect(sliderToHeight(heightToSlider(height))).toBeCloseTo(height, 9);
    }
  });

  it("rises all the way along the track, finely near the middle", () => {
    let last = -Infinity;
    for (let i = -100; i <= 100; i++) {
      const height = sliderToHeight(i / 100);
      expect(height).toBeGreaterThan(last);
      last = height;
    }
    expect(Math.abs(sliderToHeight(0.1))).toBeLessThan(1);
  });

  it("writes a height to one decimal, never as -0", () => {
    expect(roundHeight(12.345)).toBe(12.3);
    expect(Object.is(roundHeight(-0.01), 0)).toBe(true);
  });
});
