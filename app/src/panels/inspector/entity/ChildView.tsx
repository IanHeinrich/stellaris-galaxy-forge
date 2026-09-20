import type { Entry } from "../../../store/inspectorStore";
import { Placeholder } from "../parts";

/** What an entity the open document cannot answer for shows in place of its body. */
export function ChildView({ entry }: { entry: Entry }) {
  return (
    <>
      <div className="ins-head">
        <span className="name">{entry.label}</span>
      </div>
      <Placeholder>
        The open document holds no {entry.ref.kind.replace(/_/g, " ")} entities, so there is nothing
        to read here.
      </Placeholder>
    </>
  );
}
