/**
 * EVALUATOR V4 — MORPHOLOGY UNIT TESTS
 *
 * Tests the Arabic morphology and English lemmatization primitives directly,
 * with no benchmark corpus involved. These exist so the morphology layer has
 * its own evidence independent of any evaluation set.
 */

import {
  hasArabicCapability, hasArabicCompletion, hasArabicConditional, hasArabicCopula, hasArabicNegation,
  hasArabicPerfectiveVerb, hasArabicStill, lightStemArabic, normalizeArabic, stripProclitics,
} from "../benchmarks/evaluator-v4-proto/arabic";
import { detectFrames, frameIds, lemmatizeEn } from "../benchmarks/evaluator-v4-proto/frames";

const checks: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- normalization ---------------------------------------------------------
check("diacritics removed", normalizeArabic("مُعيَّن") === "معين", normalizeArabic("مُعيَّن"));
check("hamza forms unified", normalizeArabic("إقرار") === normalizeArabic("اقرار"));
check("alef maqsura → ya", normalizeArabic("على") === "علي");
check("ta marbuta → ha", normalizeArabic("موافقة") === "موافقه");

// --- proclitics -----------------------------------------------------------
check("و + لن", stripProclitics("ولن").includes("لن"), stripProclitics("ولن").join("|"));
check("ف + لم", stripProclitics("فلم").includes("لم"));
check("ب + ال + عقد", stripProclitics(normalizeArabic("بالعقد")).includes("عقد"));
check("ل + ل + ال → سجل", stripProclitics("للسجل").includes("سجل"));
check("س + يغلق (future)", stripProclitics("سيغلق").includes("يغلق"));
check("و + ال + دليل", stripProclitics("والدليل").includes("دليل"));

// --- boundaries: the original \b bug -------------------------------------
check("bare لا does NOT match inside الالتزام", !hasArabicNegation("الالتزام قائم"), "negation must not fire inside a word");
check("لا matches as a word", hasArabicNegation("لا يوجد إقرار"));
check("لن matches with و attached", hasArabicNegation("ولن ينفذ التغيير"));
check("غير matches", hasArabicNegation("التقرير غير مكتمل"));
check("بلا matches", hasArabicNegation("الالتزام بلا مالك"));
check("ليس matches", hasArabicNegation("ليس هناك مبلغ"));

// --- particles ------------------------------------------------------------
check("إذا is conditional", hasArabicConditional("إذا رفع الإقرار ستغلق الفجوة"));
check("لو is conditional", hasArabicConditional("لو وصل التقرير"));
check("ما زال is continuation, not interrogative", hasArabicStill("ما زال التباين مفتوحًا"));
check("لا يزال is continuation", hasArabicStill("لا يزال الدليل مفقودًا"));
check("copula هو detected", hasArabicCopula("المالك هو فهد"));
check("copula هي detected", hasArabicCopula("الجهة المسؤولة هي الإدارة"));
check("positive capability detected", hasArabicCapability("أستطيع إعداد المقترحات"));

// --- completion / passive / perfective ----------------------------------
check("تم + مصدر is completion", hasArabicCompletion("تم إرسال التقرير"));
check("تمت + مصدر is completion", hasArabicCompletion("تمت الموافقة على الطلب"));
check("bare تم with no complement is not completion", !hasArabicCompletion("تم"));
check("perfective with نا + object pronoun", hasArabicPerfectiveVerb("أسندناه إلى الجهة"));
check("perfective سلّمناه", hasArabicPerfectiveVerb("سلّمناه أمس"));
check("perfective أنجزتها", hasArabicPerfectiveVerb("أنجزتها أمس"));
check("perfective أغلقت", hasArabicPerfectiveVerb("أغلقت الفجوة"));
check("plain noun phrase is not perfective", !hasArabicPerfectiveVerb("تقرير الصيانة الشهري"));

// --- light stemming -------------------------------------------------------
check("وأسندناه stems to اسند", lightStemArabic("وأسندناه").some((s) => s.startsWith("اسند")), lightStemArabic("وأسندناه").join("|"));
check("المستندات stems to مستند", lightStemArabic("المستندات").includes("مستند"), lightStemArabic("المستندات").join("|"));

// --- English lemmatization ----------------------------------------------
for (const [form, lemma] of [["approves", "approve"], ["approved", "approve"], ["sits", "sit"], ["handled", "handle"],
                             ["drafted", "draft"], ["acted", "act"], ["notifies", "notify"], ["settled", "settle"]] as const) {
  check(`lemmatize ${form} → ${lemma}`, lemmatizeEn(form).includes(lemma), lemmatizeEn(form).join("|"));
}

// --- frames: unseen verbs reach the right frame -------------------------
const frameOf = (s: string) => [...frameIds(detectFrames(s))].join(",");
check("'put forward as owner' → responsibility", frameOf("A manager has been put forward as owner").includes("A-responsibility"), frameOf("A manager has been put forward as owner"));
check("'sits with' → responsibility", frameOf("That obligation sits with the team").includes("A-responsibility"));
check("'handled by' → responsibility", frameOf("The filing is handled by Dana").includes("A-responsibility"));
check("'went out to the client' → communication", frameOf("The notice went out to the client").includes("C-communication"), frameOf("The notice went out to the client"));
check("'acted on' → execution", frameOf("I have not acted on it").includes("H-execution"), frameOf("I have not acted on it"));
check("'approves' → authorization", frameOf("The manager approves it").includes("D-authorization"));
check("'accepted' → authorization", frameOf("Nobody has accepted the role yet").includes("D-authorization"));
check("'drafted a proposal' → authorization or execution", /D-authorization|H-execution/.test(frameOf("I have drafted a proposal")), frameOf("I have drafted a proposal"));
check("تم إرسال → communication", frameOf("تم إرسال التقرير").includes("C-communication"), frameOf("تم إرسال التقرير"));
check("أغلقت الفجوة → evidence/state-change", /B-state-change|G-evidence/.test(frameOf("أغلقت الفجوة")), frameOf("أغلقت الفجوة"));
check("أسندناه → responsibility", frameOf("أسندناه إلى الجهة").includes("A-responsibility"), frameOf("أسندناه إلى الجهة"));
check("conversational filler → no frame", frameOf("Happy to help with whatever you need") === "", frameOf("Happy to help with whatever you need"));

const failed = checks.filter((c) => !c.pass);
console.log(`\nMORPHOLOGY: ${checks.length - failed.length}/${checks.length} pass`);
if (failed.length) process.exitCode = 1;
