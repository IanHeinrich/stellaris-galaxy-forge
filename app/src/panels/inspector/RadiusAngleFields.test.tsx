import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RadiusAngleFields } from "./RadiusAngleFields";

function shown(angle: number): string {
  return renderToStaticMarkup(
    <RadiusAngleFields
      radius={120.456}
      angle={angle}
      radiusLabel="Distance"
      radiusTitle=""
      angleTitle=""
      onCommit={() => undefined}
    />,
  );
}

describe("the radius and angle fields", () => {
  it("show the radius to two decimals and the angle as a whole number of degrees", () => {
    expect(shown(45.497)).toMatch(/aria-label="Distance"[^>]*value="120.46"/);
    expect(shown(45.497)).toMatch(/aria-label="Angle"[^>]*value="45"/);
    expect(shown(359.497)).toMatch(/aria-label="Angle"[^>]*value="359"/);
    expect(shown(359.6)).toMatch(/aria-label="Angle"[^>]*value="0"/);
  });
});
