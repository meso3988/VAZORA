/**
 * Study-tool source-reference resolution (not a product citation system).
 *
 *   pointer  RFC 6901 JSON Pointer into the reviewer input, rooted at
 *            /sources or /receipts only (case scope). "~1" = "/", "~0" = "~";
 *            dots are literal; array indexes must be canonical and in range.
 *   legacy   for SAVED dotted-path outputs only: tries every way of grouping
 *            the dot-separated segments into keys (so a key that itself
 *            contains a dot can be reached). Accepted only when exactly one
 *            grouping resolves; several → AMBIGUOUS; none → UNRESOLVED.
 *            Never fuzzy, never nearest-text.
 */

type Json = unknown;

function step(cur: Json, token: string): { ok: boolean; next?: Json } {
  if (Array.isArray(cur)) {
    if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= cur.length) return { ok: false };
    return { ok: true, next: cur[Number(token)] };
  }
  if (cur && typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, token)) return { ok: true, next: (cur as Record<string, Json>)[token] };
  return { ok: false };
}

export function resolvePointer(input: { sources: Json; receipts: Json }, pointer: string): boolean {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return false;
  const raw = pointer.slice(1).split("/");
  if (raw.some((t) => /~(?![01])/.test(t))) return false;
  const tokens = raw.map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (tokens[0] !== "sources" && tokens[0] !== "receipts") return false;
  let cur: Json = tokens[0] === "sources" ? input.sources : input.receipts;
  for (const t of tokens.slice(1)) {
    const s = step(cur, t);
    if (!s.ok) return false;
    cur = s.next;
  }
  return true;
}

export const toPointer = (keys: string[]) => "/" + keys.map((k) => k.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

export type LegacyResult = { status: "RESOLVED_UNIQUE" | "AMBIGUOUS" | "UNRESOLVED"; pointers: string[] };

export function resolveLegacyDotted(input: { sources: Json; receipts: Json }, path: string): LegacyResult {
  let p = path.replace(/^sources\./, "");
  let rootName = "sources";
  if (/^receipts[.[]/.test(p)) { rootName = "receipts"; p = p.replace(/^receipts\.?/, ""); }
  const segs = p.replace(/\[(\d+)\]/g, ".$1").split(".").filter((s) => s !== "");
  const found: string[] = [];
  const walk = (cur: Json, i: number, keys: string[]) => {
    if (found.length > 1) return;
    if (i === segs.length) { found.push(toPointer([rootName, ...keys])); return; }
    for (let j = i + 1; j <= segs.length; j++) {
      const key = segs.slice(i, j).join(".");
      const s = step(cur, key);
      if (s.ok) walk(s.next, j, [...keys, key]);
    }
  };
  if (segs.length) walk(rootName === "sources" ? input.sources : input.receipts, 0, []);
  return { status: found.length === 1 ? "RESOLVED_UNIQUE" : found.length > 1 ? "AMBIGUOUS" : "UNRESOLVED", pointers: found };
}
