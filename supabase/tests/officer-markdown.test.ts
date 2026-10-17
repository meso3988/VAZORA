// Safe Markdown display of stored Officer answers — no model call.
// Renders saved texts (including the stored live answer) to static HTML and
// checks structure, RTL and that model-written HTML / links / images never
// become executable markup, anchors or trusted citations.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-markdown.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfficerMarkdown } from "../../src/components/app/officer/markdown";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");
const html = (text: string) => renderToStaticMarkup(createElement(OfficerMarkdown, { text }));

async function main() {
  // The stored live answer (2026-10-05 journey) — table + bold.
  const msgs = JSON.parse(src("supabase/tests/evidence/2026-10-05-release-completion/live-journey/officer-conversation.json"));
  const stored: string = msgs.find((m: { role: string }) => m.role === "assistant").content;
  const before = stored;
  const h = html(stored);
  check("stored answer: table rendered (no raw pipes)", h.includes("<table") && h.includes("<th") && !h.includes("|---|"));
  check("stored answer: bold rendered (no ** markers)", h.includes("<strong>") && !h.includes("**"));
  check("stored answer: 6 obligation rows", (h.match(/<tr>/g) ?? []).length === 7, `${(h.match(/<tr>/g) ?? []).length - 1} body rows`);
  check("stored text itself unchanged by rendering", stored === before);
  check("table wrapped for horizontal scroll on mobile", h.includes("data-md-table") && h.includes("overflow-x-auto"));

  const ar = html("## الالتزامات\n\n- **تقرير الأداء** مستحق في 2026-10-05\n- شهادة الجاهزية\n\n| البند | الحالة |\n|---|---|\n| 5.1 | ناقص |");
  check("Arabic: heading, list, bold, table; dir=auto for RTL", ar.includes('dir="auto"') && ar.includes("<ul") && ar.includes("<strong>تقرير الأداء</strong>") && ar.includes("<table") && ar.includes("الالتزامات"));

  const evil = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<iframe src=\"https://evil.example\"></iframe>",
    "[click me](javascript:alert(1))",
    "[portal](https://evil.example/phish)",
    "https://evil.example/auto",
    "![x](https://evil.example/pixel.png)",
    "<a href=\"https://evil.example\">raw anchor</a>",
    "{alert(1)} <MDXComponent />",
  ].join("\n\n");
  const e = html(evil);
  check("no <script>, <iframe>, raw <img>, event handlers", !/<script|<iframe|<img|onerror|onload/i.test(e));
  check("no anchors at all (model links are text, not citations)", !/<a[\s>]/i.test(e) && !/href=/i.test(e));
  check("no javascript: URL anywhere", !/javascript:/i.test(e));
  check("link text preserved as plain text", e.includes("click me") && e.includes("portal"));
  check("image reduced to alt text", e.includes(">x<") && !e.includes("pixel.png\""));
  check("MDX/JSX not evaluated (no component element emitted)", !/<mdxcomponent/i.test(e));

  const thread = src("src/components/app/officer/thread.tsx");
  check("thread: assistant answers through OfficerMarkdown, user text verbatim", thread.includes("<OfficerMarkdown text={m.content} />") && thread.includes('whitespace-pre-wrap text-sm leading-relaxed">{m.content}'));
  check("thread: validated citations still rendered from server-checked records", thread.includes("m.citations.map"));
  const md = src("src/components/app/officer/markdown.tsx");
  check("renderer: no dangerouslySetInnerHTML; skipHtml + allow-list + empty urlTransform", !md.includes("dangerouslySetInnerHTML") && md.includes("skipHtml") && md.includes("allowedElements") && md.includes("urlTransform={() => \"\"}"));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
