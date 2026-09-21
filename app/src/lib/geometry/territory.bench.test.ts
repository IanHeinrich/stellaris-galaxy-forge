import { describe, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { Territories } from "./territories";
import {
  affectedCountries,
  countryRegions,
  regionLabelAnchor,
  smoothRegion,
  type Region,
  type TerritoryParams,
} from "./territory";
import { buildGalaxy } from "./territory.fixture";

const PARAMS: TerritoryParams = { radius: 35, laneHalfWidth: 10 };
const BENCH_OPTIONS = { iterations: 5, warmupIterations: 1 };
const MOVE_DISTANCE = 20;

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
  it("times countryRegions, affectedCountries, Territories, smoothRegion and regionLabelAnchor", () => {
    const { systems, laneCount, sizes } = buildGalaxy();
    const largestCountry = sizes[0].country;
    const largestOnly = new Set([largestCountry]);
    const bordered = sizes.map((s) => s.country);
    console.log(
      `territory bench galaxy: ${systems.length} systems, ${laneCount} lanes, ${sizes.length} countries, ` +
        `largest country ${largestCountry} has ${sizes[0].size} systems, ` +
        `then ${sizes
          .slice(1, 6)
          .map((s) => s.size)
          .join(", ")}`,
    );

    const beforeMap = new Map(systems.map((s) => [s.id, s]));
    const movedSource = systems.find((s) => s.owner === largestCountry);
    if (!movedSource) throw new Error("territory bench: no system found in the largest country");
    const movedSystem: SystemNode = { ...movedSource, x: movedSource.x + MOVE_DISTANCE };
    const afterMap = new Map(beforeMap);
    afterMap.set(movedSystem.id, movedSystem);
    const systemsAfterMove = systems.map((s) => (s.id === movedSystem.id ? movedSystem : s));

    const allRegions = countryRegions(systems, PARAMS);
    const regionList: Region[] = [...allRegions.values()];

    const model = new Territories();

    const results: BenchResult[] = [
      runBench(
        "countryRegions: full reset of every country",
        () => {
          countryRegions(systems, PARAMS);
        },
        BENCH_OPTIONS,
      ),
      runBench(
        "countryRegions: only the largest country",
        () => {
          countryRegions(systems, PARAMS, largestOnly);
        },
        BENCH_OPTIONS,
      ),
      runBench(
        "affectedCountries + countryRegions after moving one system",
        () => {
          const affected = affectedCountries([movedSystem], beforeMap, afterMap, PARAMS);
          countryRegions(systemsAfterMove, PARAMS, affected);
        },
        BENCH_OPTIONS,
      ),
      runBench(
        "Territories.reset over the whole galaxy",
        () => {
          new Territories().reset(systems, PARAMS, bordered);
        },
        BENCH_OPTIONS,
      ),
      runBench(
        "Territories.apply of one system moved inside the largest country",
        () => {
          model.apply([movedSystem], []);
        },
        { ...BENCH_OPTIONS, setup: () => model.reset(systems, PARAMS, bordered) },
      ),
      runBench(
        "smoothRegion over every region",
        () => {
          for (const region of regionList) smoothRegion(region);
        },
        BENCH_OPTIONS,
      ),
      runBench(
        "regionLabelAnchor over every region",
        () => {
          for (const region of regionList) regionLabelAnchor(region);
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
