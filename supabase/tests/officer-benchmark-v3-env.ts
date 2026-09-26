/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared offline scoring environment for v3 re-scoring and paired tests:
// entity → citable ids, and citation families, built ONLY from a persisted
// fixture identity (plus gap rows seen in saved tool results).

export function buildEntityCitations(fx: any): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const put = (key: string, ids: (string | null | undefined)[]) => m.set(key, new Set(ids.filter(Boolean) as string[]));
  for (const c of Object.values<any>(fx.contracts)) {
    const reqIds = [c.req, c.kpiReq].filter(Boolean).flatMap((r: any) => [r.reqId, r.itemId, r.checkId, r.versionId]);
    put(`contract:${c.number}`, [c.contractId, c.clauseId, c.docId, c.obligationId, c.discrepancyId, ...reqIds]);
    put(`clause:${c.clauseId}`, [c.clauseId, c.docId]);
    put(`obligation:${c.obligationId}`, [c.obligationId, c.clauseId, c.discrepancyId, ...reqIds]);
    for (const r of [c.req, c.kpiReq].filter(Boolean) as any[]) {
      put(`requirement:${r.reqId}`, [r.reqId, r.itemId, r.checkId, r.versionId, c.obligationId, c.discrepancyId]);
      if (r.itemId) put(`evidence_item:${r.itemId}`, [r.itemId, r.versionId, r.checkId, r.reqId, c.obligationId, c.discrepancyId]);
      put(`evidence_item:${r.reqId}`, [r.reqId, c.obligationId]);
    }
  }
  for (const e of fx.memberEmails ?? []) put(`member:${e}`, [fx.userId]);
  for (const g of fx.gapRows ?? []) {
    for (const key of [`requirement:${g.evidence_requirement_id}`, `obligation:${g.obligation_id}`,
      g.contract_id && `contract:${Object.values<any>(fx.contracts).find((c) => c.contractId === g.contract_id)?.number}`,
    ].filter(Boolean) as string[]) m.set(key, new Set([...(m.get(key) ?? []), g.id]));
  }
  return m;
}

export function buildCitationFamilies(fx: any): Map<string, Set<string>> {
  const fam = new Map<string, Set<string>>();
  const add = (id: string | null | undefined, ...ids: (string | null | undefined)[]) => {
    if (!id) return;
    fam.set(id, new Set([id, ...(fam.get(id) ?? []), ...(ids.filter(Boolean) as string[])]));
  };
  for (const c of Object.values<any>(fx.contracts)) {
    const reqItems: string[] = [];
    for (const r of [c.req, c.kpiReq].filter(Boolean) as any[]) {
      const rIds = [r.reqId, r.itemId, r.checkId, r.versionId, r.runId].filter(Boolean) as string[];
      reqItems.push(...rIds);
      add(r.reqId, r.itemId, r.checkId, r.versionId, r.runId);
      for (const x of rIds) if (x !== r.reqId) add(x, r.reqId);
    }
    add(c.contractId, c.clauseId, c.docId, c.obligationId, c.discrepancyId, ...reqItems);
    add(c.obligationId, c.clauseId, c.discrepancyId, ...reqItems);
    add(c.clauseId, c.docId);
    if (c.discrepancyId) add(c.discrepancyId, c.obligationId);
  }
  for (const g of fx.gapRows ?? []) {
    add(g.id); add(g.evidence_requirement_id, g.id); add(g.obligation_id, g.id);
    const c = Object.values<any>(fx.contracts).find((x) => x.contractId === g.contract_id);
    if (c) add(c.contractId, g.id);
  }
  return fam;
}
