// Browser check of the contract-health incomplete states — Command Center and
// dashboard, English and Arabic. No model calls: run the server with the
// Officer provider disabled (VAZORA_OFFICER_PROVIDER=none). QA state comes from
// qa-health-states.ts (/tmp/qa-health-states.json).
// Run: HS_STATE=<never|partial|readfail|recovered> node --import tsx supabase/tests/e2e-health-states.mts

import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const st = JSON.parse(readFileSync("/tmp/qa-health-states.json", "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const STATE = process.env.HS_STATE as "never" | "partial" | "readfail" | "recovered";
const SHOTS = process.env.HS_SHOTS ?? "/tmp";

const TXT = {
  en: { incomplete: "I could not complete the current assessment", quiet: "Nothing currently requires your attention.", history: "Last successful assessment" },
  ar: { incomplete: "لم أتمكن من إكمال التقييم الحالي", quiet: "لا شيء يحتاج انتباهك حاليًا.", history: "آخر تقييم ناجح" },
};
const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok, d }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };

async function login(page: Page, locale: "en" | "ar") {
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(st.email);
  await page.locator('input[name="password"]').fill(st.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 30000 });
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const locale of ["en", "ar"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: locale === "ar" ? "ar-SA" : "en-US" });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    await login(page, locale);
    const t = TXT[locale];
    for (const [name, path] of [["command-center", "app/agent"], ["dashboard", "app/dashboard"]] as const) {
      await page.goto(`${BASE}/${locale}/${path}`);
      await page.waitForLoadState("networkidle");
      const body = await page.locator("body").innerText();
      const tag = `${STATE} ${locale} ${name}`;
      await page.screenshot({ path: `${SHOTS}/hs-${STATE}-${locale}-${name}.png`, fullPage: false });
      const incomplete = body.includes(t.incomplete);
      const quiet = body.includes(t.quiet);
      const issues = /EPSILON-500|BETA-200|GAMMA-300|ZETA-600/.test(body);
      // In every state here there is either incomplete coverage or real issues.
      rec(`${tag}: no false "nothing needs attention"`, !quiet, quiet ? "quiet text shown" : "");
      if (STATE === "recovered") {
        rec(`${tag}: incomplete notice gone after recovery`, !incomplete);
        rec(`${tag}: known issues visible`, issues);
      } else {
        rec(`${tag}: incomplete assessment is stated`, incomplete);
      }
      if (STATE === "partial") rec(`${tag}: known issues remain visible`, issues);
      if (name === "command-center" && STATE === "partial") {
        rec(`${tag}: last successful assessment shown as history`, body.includes(t.history));
        // the history must point at the COMPLETED run, not the partial one
        const m = body.match(new RegExp(`${t.history}:?\\s*([^\\n]+)`));
        rec(`${tag}: history timestamp is the completed run (${st.completedAtLabel ?? "?"})`, !!m && !!st.completedAtLabel && m[1].includes(st.completedAtLabel), m?.[1] ?? "none");
      }
      if (name === "command-center" && STATE === "never") rec(`${tag}: no history claimed when never assessed`, !body.includes(t.history));
    }
    rec(`${STATE} ${locale}: no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nHEALTH STATES (${STATE}): ${results.length - failed.length}/${results.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
