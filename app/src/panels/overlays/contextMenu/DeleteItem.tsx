import { useDeletion, type DeletionTarget } from "../../inspector/entity/useDeletion";
import { RefusableMenuItem } from "./MenuItem";

/** Deletes `target` (its whole ring world where it belongs to one), or says why it cannot: offered once the core has answered. */
export function DeleteItem({ target }: { target: DeletionTarget }) {
  const { label, refusal, run } = useDeletion(target);
  return (
    <RefusableMenuItem refusal={refusal} run={run}>
      {label}
    </RefusableMenuItem>
  );
}
