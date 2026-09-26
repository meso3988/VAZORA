/**
 * Canonical identity of an Officer proposal.
 *
 * Two proposals are the SAME business action when they have the same action
 * type, the same authorized structured target and the same operational
 * parameters. Free text (titles, summaries, reasons) never participates, so a
 * paraphrase of an unresolved follow-up resolves to the existing proposal.
 *
 * Explicit policy for things that are NOT merged:
 *   - a different target (another contract, obligation or evidence gap)
 *     → a different identity;
 *   - a different operational parameter (another assignee, another due date)
 *     → a different identity: competing proposals stay separate and a human
 *     chooses between them; nothing is silently rewritten;
 *   - granularity is whatever the caller resolved: a proposal about one gap
 *     and a proposal about the whole obligation are different identities.
 *
 * Targets must already be resolved server-side (gap → obligation → contract)
 * so an argument that omits a parent id cannot produce a second identity.
 */

/** Per action type: the argument keys that change WHAT would be done. */
const OPERATIONAL_PARAMS: Record<string, readonly string[]> = {
  "obligation.assign_owner": ["assigneeUserId"],
  "obligation.change_due_date": ["dueDate"],
};

export type ActionTarget = {
  contractId: string | null;
  obligationId: string | null;
  gapId: string | null;
};

export function actionIdentityKey(
  actionType: string,
  target: ActionTarget,
  args: Record<string, unknown> = {},
): string {
  const norm = (v: unknown) => (typeof v === "string" && v ? v.trim().toLowerCase() : "-");
  const params = [...(OPERATIONAL_PARAMS[actionType] ?? [])]
    .sort()
    .map((k) => `${k}=${norm(args[k])}`);
  return [
    "v1", actionType,
    `c=${norm(target.contractId)}`, `o=${norm(target.obligationId)}`, `g=${norm(target.gapId)}`,
    ...params,
  ].join("|");
}
