import { useEffect } from "react";
import type { SystemDetails } from "../../../generated/SystemDetails";
import type { SystemNode } from "../../../generated/SystemNode";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useNamed } from "../../useNamed";
import { Empty } from "../parts";
import "./system.css";
import { Contents, Data, Lanes, Overview, Scripts, Source } from "./SystemTabs";

/** Every localisation key the inspector shows for a system that the details cache does not fetch. */
function extraNameKeys(system: SystemNode, details: SystemDetails | undefined): string[] {
  const keys = [system.star_class];
  if (!details) return keys;
  for (const p of details.planets) keys.push(p.class);
  for (const m of details.megastructures) keys.push(m.kind);
  for (const f of details.fleets_present) for (const s of f.ship_sizes) keys.push(s.key);
  if (details.starbase) keys.push(details.starbase.level);
  return keys;
}

export function SystemView({ id }: { id: number }) {
  const tab = useInspectorStore((s) => s.tab);
  const detail = useEditorStore((s) => s.inspected);
  const request = useDetailsStore((s) => s.request);
  const details = useDetailsStore((s) => s.details.get(id));
  const failed = useDetailsStore((s) => s.failed.get(id));
  const version = useDetailsStore((s) => s.version);

  // The cache bumps its version when it drops what it held, and asking again is how it refills.
  useEffect(() => request([id]), [id, request, version]);

  const system = detail?.system.id === id ? detail.system : null;
  useNamed(system ? extraNameKeys(system, details) : []);

  if (!detail || detail.system.id !== id) return <Empty>Loading #{id}…</Empty>;
  switch (tab) {
    case "overview":
      return <Overview detail={detail} details={details} />;
    case "scripts":
      return <Scripts detail={detail} />;
    case "contents":
      return <Contents detail={detail} details={details} failed={failed} />;
    case "lanes":
      return <Lanes detail={detail} />;
    case "data":
      return <Data detail={detail} />;
    case "source":
      return <Source detail={detail} />;
  }
}
