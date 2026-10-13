/**
 * One computation's last answer, kept while its inputs stay the same values by identity.
 * `compute` runs again when any input changes, handed the answer before, null the first time.
 */
export function lastOf<R>(): (inputs: readonly unknown[], compute: (previous: R | null) => R) => R {
  let last: { inputs: readonly unknown[]; result: R } | null = null;
  return (inputs, compute) => {
    if (
      last !== null &&
      last.inputs.length === inputs.length &&
      inputs.every((v, i) => v === last?.inputs[i])
    ) {
      return last.result;
    }
    last = { inputs, result: compute(last === null ? null : last.result) };
    return last.result;
  };
}
