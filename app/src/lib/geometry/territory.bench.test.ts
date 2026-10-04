import { describe, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { placeLabels, type LabelRequest } from "./labelFit";
import { Territories, type BandWidths } from "./territories";
import { buildGalaxy, PARAMS } from "./territory.fixture";

const BENCH_OPTIONS = { iterations: 5, warmupIterations: 1 };
const BENCH_TIMEOUT_MS = 600_000;
const MOVE_DISTANCE = 20;
/** The band widths the map asks for zoomed in and zoomed out. */
const NEAR: BandWidths = { band: 1.6, seam: 0.4 };
const FAR: BandWidths = { band: 5.9, seam: 5.9 / 4 };
/** A label's shape per unit of font size, as the map measures an emblem over a name. */
const LETTER_WIDTH = 0.6;
const NAME_HEIGHT = 1.2;
const EMBLEM = 3.2;
const DROP = 0.3;
const MAX_SCALE = 44;
const NARROWEST = 50;

interface BenchResult {
  name: string;
  meanMs: number;
  iterations: number;
}

/**
 * Vitest's `bench` test-context fixture only works inside a dedicated benchmark project
 * (matched by `benchmark.include`, run through `vitest bench`); calling it from a file run
 * through plain `vitest run` throws `"Cannot use the bench test-context fixture within a
 * regular test run"`, even when that file's name still ends in `.bench.ts`. Since this file
 * has to be an ordinary `*.test.ts` so `npm test` finds and skips it, the timing here is done
 * by hand instead of through that fixture: `warmupIterations` untimed calls, then the mean of
 * `iterations` timed ones. `setup` runs untimed before each call.
 */
function runBench(
  benchName: string,
  fn: () => void,
  options: { iterations: number; warmupIterations: number; setup?: () => void },
): BenchResult {
  for (let i = 0; i < options.warmupIterations; i++) {
    options.setup?.();
    fn();
  }
  let total = 0;
  for (let i = 0; i < options.iterations; i++) {
    options.setup?.();
    const start = performance.now();
    fn();
    total += performance.now() - start;
  }
  return { name: benchName, meanMs: total / options.iterations, iterations: options.iterations };
}

describe.skipIf(!import.meta.env.SGF_BENCH)("territory geometry benchmarks", () => {
  it("times Territories and placeLabels", { timeout: BENCH_TIMEOUT_MS }, () => {
    const { systems, laneCount, sizes } = buildGalaxy();
    const largestCountry = sizes[0].country;
    const bordered = sizes.map((s) => s.country);
    console.log(
      `territory bench galaxy: ${systems.length} systems, ${laneCount} lanes, ${sizes.length} countries, ` +
        `largest country ${largestCountry} has ${sizes[0].size} systems, ` +
        `then ${sizes
          .slice(1, 6)
          .map((s) => s.size)
          .join(", ")}`,
    );

    const movedSource = systems.find((s) => s.owner === largestCountry);
    if (!movedSource) throw new Error("territory bench: no system found in the largest country");
    const movedSystem: SystemNode = { ...movedSource, x: movedSource.x + MOVE_DISTANCE };

    const model = new Territories();
    const requests: LabelRequest[] = [];
    for (const [country, shape] of model.reset(systems, PARAMS, bordered, FAR)) {
      const nameWidth = LETTER_WIDTH * (6 + (country % 13));
      const label = { nameWidth, nameHeight: NAME_HEIGHT, emblem: EMBLEM, drop: DROP };
      const minScale = Math.min(6, NARROWEST / nameWidth);
      for (const scan of shape.scans) {
        requests.push({ scan, shape: label, maxScale: MAX_SCALE, minScale });
      }
    }

    const results: BenchResult[] = [
      runBench(
        "Territories.reset over the whole galaxy, banded",
        () => {
          new Territories().reset(systems, PARAMS, bordered, FAR);
        },
        BENCH_OPTIONS,
      ),
      runBench(
        "Territories.apply of one system moved inside the largest country",
        () => {
          model.apply([movedSystem], []);
        },
        { ...BENCH_OPTIONS, setup: () => model.reset(systems, PARAMS, bordered, FAR) },
      ),
      runBench(
        "Territories.band from the near widths to the far ones",
        () => {
          model.band(FAR);
        },
        { ...BENCH_OPTIONS, setup: () => model.reset(systems, PARAMS, bordered, NEAR) },
      ),
      runBench(
        `placeLabels over every piece of every country (${requests.length})`,
        () => {
          placeLabels(requests);
        },
        BENCH_OPTIONS,
      ),
    ];

    console.log(
      "bench                                                              mean (ms)   iterations",
    );
    for (const result of results) {
      console.log(
        `${result.name.padEnd(64)}  ${result.meanMs.toFixed(3).padStart(9)}  ${String(
          result.iterations,
        ).padStart(10)}`,
      );
    }
  });
});
