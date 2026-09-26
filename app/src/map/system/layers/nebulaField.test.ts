import { describe, expect, it } from "vitest";
import { nebulaField } from "./nebulaField";

const SIZE = 128;
const field = nebulaField(7, SIZE);
const alpha = (i: number, j: number) => field[4 * (j * SIZE + i) + 3];

/** The mean alpha of the texels whose centres lie between `from` and `to`, as shares of the radius. */
function ring(from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const r = Math.hypot(i + 0.5 - SIZE / 2, j + 0.5 - SIZE / 2) / (SIZE / 2);
      if (r < from || r >= to) continue;
      sum += alpha(i, j);
      count++;
    }
  }
  return sum / count;
}

/** The mean step between the two rows either side of the centre line, over the left or right half. */
function stepAcross(left: boolean): number {
  const half = SIZE / 2;
  let sum = 0;
  for (let k = 4; k < half - 4; k++) {
    const i = left ? half - 1 - k : half + k;
    sum += Math.abs(alpha(i, half - 1) - alpha(i, half));
  }
  return sum / (half - 8);
}

describe("nebulaField", () => {
  it("gives the same premultiplied white field for the same seed, and another for another", () => {
    expect(nebulaField(7, SIZE)).toEqual(field);
    expect(nebulaField(8, SIZE)).not.toEqual(field);
    for (let k = 0; k < field.length; k += 4) {
      expect(field[k]).toBe(field[k + 3]);
    }
  });

  it("is clear about the centre, denser further out, and gone at its edge", () => {
    expect(ring(0, 0.1)).toBeLessThan(ring(0.4, 0.6) / 3);
    for (let k = 0; k < SIZE; k++) {
      for (const [i, j] of [
        [k, 0],
        [k, SIZE - 1],
        [0, k],
        [SIZE - 1, k],
      ]) {
        expect(alpha(i, j)).toBe(0);
      }
    }
  });

  it("has no seam where the angle wraps round", () => {
    expect(stepAcross(true)).toBeLessThan(2 * stepAcross(false) + 2);
  });
});
