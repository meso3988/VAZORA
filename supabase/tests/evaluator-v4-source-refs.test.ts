/**
 * BOUNDED HARDENING — source-reference resolver + scorer modes (offline)
 *
 * Resolver cases are small synthetic objects. Scorer checks use the SAVED raw
 * responses of the full-answer validation: the frozen mode must reproduce the
 * committed automatic score exactly; the legacy mode may only repair a dotted
 * path through a single proven grouping.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type RefCase, type RefMode, scoreCase, summarize } from "../benchmarks/evaluator-v4-proto/fullanswer-scoring";
import { resolveLegacyDotted, resolvePointer, toPointer } from "../benchmarks/evaluator-v4-proto/source-refs";

const here = dirname(fileURLToPath(import.meta.url));
const proto = join(here, "..", "benchmarks", "evaluator-v4-proto");
const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- resolver ----------------------------------------------------------------
const input = {
  sources: {
    A: { counts: { "officer.sweep_completed": 1 }, list: [{ x: 1 }, { x: 2 }], "a/b": 1, "c~d": 2 },
    B: { counts: { officer: { sweep_completed: 7 } } },
  },
  receipts: [{ turn: 1, actionsDelta: 0 }],
};
check("pointer: key with a literal dot", resolvePointer(input, "/sources/A/counts/officer.sweep_completed"));
check("pointer: nested path with the same words resolves only where it exists", resolvePointer(input, "/sources/B/counts/officer/sweep_completed") && !resolvePointer(input, "/sources/A/counts/officer/sweep_completed") && !resolvePointer(input, "/sources/B/counts/officer.sweep_completed"));
check("pointer: arrays — canonical in-range index only", resolvePointer(input, "/sources/A/list/1/x") && !resolvePointer(input, "/sources/A/list/01/x") && !resolvePointer(input, "/sources/A/list/2/x") && !resolvePointer(input, "/sources/A/list/-/x"));
check("pointer: keys containing / and ~ via ~1 and ~0", resolvePointer(input, "/sources/A/a~1b") && resolvePointer(input, "/sources/A/c~0d") && toPointer(["sources", "A", "a/b"]) === "/sources/A/a~1b");
check("pointer: invalid escape rejected", !resolvePointer(input, "/sources/A/c~2d"));
check("pointer: missing source / field rejected", !resolvePointer(input, "/sources/Z/counts") && !resolvePointer(input, "/sources/A/nothing"));
check("pointer: case scope only (/sources or /receipts)", !resolvePointer(input, "/answer") && !resolvePointer(input, "/request") && !resolvePointer(input, "sources/A/list") && resolvePointer(input, "/receipts/0/actionsDelta"));
check("pointer: dotted legacy string is not a pointer", !resolvePointer(input, "A.counts.officer.sweep_completed"));

const legacyDot = resolveLegacyDotted(input, "A.counts.officer.sweep_completed");
check("legacy: dotted key reached through one proven grouping", legacyDot.status === "RESOLVED_UNIQUE" && legacyDot.pointers[0] === "/sources/A/counts/officer.sweep_completed", JSON.stringify(legacyDot));
const amb = resolveLegacyDotted({ sources: { X: { "a.b": { c: 1 }, a: { "b.c": 1 } } }, receipts: [] }, "X.a.b.c");
check("legacy: two groupings → AMBIGUOUS (left unresolved)", amb.status === "AMBIGUOUS" && amb.pointers.length === 2, JSON.stringify(amb));
check("legacy: nonexistent → UNRESOLVED", resolveLegacyDotted(input, "A.counts.officer.sweep_started").status === "UNRESOLVED");
check("legacy: never nearest-text (case/spacing differences do not resolve)", resolveLegacyDotted(input, "A.Counts.officer.sweep_completed").status === "UNRESOLVED");
check("legacy: receipts path", resolveLegacyDotted(input, "receipts.0.actionsDelta").status === "RESOLVED_UNIQUE");

// ---- scorer modes on the SAVED responses --------------------------------------
const R = join(proto, "reports", "2026-10-03T01-59-06-745Z-fullanswer-study");
const refs: RefCase[] = JSON.parse(readFileSync(join(proto, "fullanswer-validation-v4.references.json"), "utf8")).cases;
const built = JSON.parse(readFileSync(`${R}-requests.json`, "utf8"));
const inp = new Map<string, { answer: string; sources: Record<string, unknown>; receipts: unknown }>(built.requests.map((r: { caseId: string; body: { messages: { content: string }[] } }) => [r.caseId, JSON.parse(r.body.messages[0].content)]));
const raw = new Map(readFileSync(`${R}-raw.jsonl`, "utf8").trim().split("\n").map((l) => { const j = JSON.parse(l); return [j.caseId, j]; }));
const scoreAll = (m: RefMode) => summarize(refs, refs.map((c) => { const i = inp.get(c.id)!; return scoreCase(c, i.sources, i.receipts, i.answer, raw.get(c.id), {}, m); }));
const original = JSON.parse(readFileSync(`${R}-auto-score.json`, "utf8")).automatic;
const frozen = scoreAll("dotted-v1");
const sameKeys = Object.keys(original).every((k) => JSON.stringify(original[k]) === JSON.stringify(k === "errors" ? Object.fromEntries(Object.keys(original.errors).map((e) => [e, frozen.errors[e]])) : (frozen as Record<string, unknown>)[k]));
check("frozen mode reproduces the committed automatic score exactly", sameKeys && frozen.verdict === "DOES NOT MEET STUDY CRITERIA" && frozen.agreement === "18/23");
const legacy = scoreAll("dotted-legacy-unique");
check("legacy view: FA-M04 u7 repaired by a unique grouping, no longer E6", legacy.errors.E6.length === 0 && legacy.errors.RESOLVER_REPAIRED.length === 1 && legacy.errors.RESOLVER_REPAIRED[0].startsWith("FA-M04 u7"), legacy.errors.RESOLVER_REPAIRED.join(" | "));
check("legacy view: no ambiguous references in the saved outputs", legacy.errors.REF_AMBIGUOUS.length === 0);
check("legacy view changes only the M04 reference effects", legacy.agreement === "19/23" && legacy.errors.E7.length === 1 && JSON.stringify(legacy.errors.E1) === JSON.stringify(frozen.errors.E1) && JSON.stringify(legacy.errors.E4) === JSON.stringify(frozen.errors.E4) && legacy.errors.ADJUDICATION_REQUIRED.length === 9);
check("legacy view still DOES NOT MEET (E1, E4, agreement)", legacy.verdict === "DOES NOT MEET STUDY CRITERIA");
const pointerOnSaved = scoreAll("json-pointer");
check("pointer mode never accepts the saved dotted paths", pointerOnSaved.errors.E6.length > 0);

// ---- prompt v2 ------------------------------------------------------------------
const p1 = readFileSync(join(proto, "reviewer-prompt-v1.txt"), "utf8");
const p2 = readFileSync(join(proto, "reviewer-prompt-v2.txt"), "utf8");
check("prompt v1 untouched (frozen hash)", createHash("sha256").update(p1).digest("hex") === "fe76dad1ee6c99f94306b9989fad87cf4d8ede1660112ecce45aaaf646d14487");
check("prompt v2 carries the three rule groups and JSON Pointer format", ["EVIDENCE LIMITS", "RECEIPTS", "Three kinds of \"can / cannot\"", "JSON Pointers (RFC 6901)", "\"/receipts/0/actionsDelta\""].every((s) => p2.includes(s)));
check("prompt v2 has no dotted-path instruction left", !p2.includes("dotted paths"));
check("prompt v2 contains no case ids or case text", !/FA-[A-Z]\d|BETA-200|GAMMA-300|ZETA-600|EPSILON-500|DELTA-400|ALPHA-100|Schedule 6|sweep_completed/.test(p2));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
