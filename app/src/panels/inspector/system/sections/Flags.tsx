import { useState } from "react";
import { Empty, FilterField, FILTER_MIN, Section } from "../../parts";

export function FlagsSection({ flags }: { flags: readonly string[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle === "" ? flags : flags.filter((f) => f.toLowerCase().includes(needle));
  return (
    <Section id="system.flags" title="Flags" count={flags.length} startClosed>
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
