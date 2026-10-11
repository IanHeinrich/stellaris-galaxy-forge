import { useState } from "react";
import type { SystemNode } from "../../../../generated/SystemNode";
import { hiddenContentLines } from "../../../../lib/special";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { FilterField, FILTER_MIN } from "../../../parts";
import { Empty, Section } from "../../parts";

/**
 * The system's flags, led by what galaxy generation hid here; open whenever it hid something.
 * `flags` lists others in place of the system's own.
 */
export function FlagsSection({
  system,
  flags = system.flags,
}: {
  system: SystemNode;
  flags?: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const kinds = useGameDataStore((s) => s.special.get(system.id)?.kinds);
  const needle = query.trim().toLowerCase();
  const shown = needle === "" ? flags : flags.filter((f) => f.toLowerCase().includes(needle));
  const hidden = hiddenContentLines(kinds ?? []);
  return (
    <Section id="system.flags" title="Flags" count={flags.length} startClosed={hidden.length === 0}>
      {hidden.map((line) => (
        <div key={line} className="ins-line">
          {line}
        </div>
      ))}
      {flags.length === 0 ? (
        <Empty>No flags on this system.</Empty>
      ) : (
        <>
          {flags.length > FILTER_MIN && (
            <FilterField label={`Filter ${flags.length} flags`} value={query} onChange={setQuery} />
          )}
          <div className="ins-flags mono">
            {shown.map((f) => (
              <div key={f}>{f}</div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
