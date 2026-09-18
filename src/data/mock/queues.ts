import type { LocalizedText } from "@/domain/types";

export type Assignment = {
  id: string;
  requirement: string;
  clause: string;
  role: LocalizedText;
  person: LocalizedText;
  confidence: "high" | "review";
  reason: LocalizedText;
};

/** Owner-assignment review after contract analysis (demo data). */
export const DEMO_ASSIGNMENTS: Assignment[] = [
  {
    id: "as_142",
    requirement: "ob_002",
    clause: "14.2",
    role: { en: "Operations Manager", ar: "مدير العمليات" },
    person: { en: "Faisal Harbi", ar: "فيصل الحربي" },
    confidence: "high",
    reason: { en: "Matches the monthly SLA evidence loop — same cadence and system access.", ar: "يتوافق مع دورة أدلة مستوى الخدمة الشهرية — نفس الإيقاع وصلاحية النظام." },
  },
  {
    id: "as_217",
    requirement: "ob_005",
    clause: "21.3",
    role: { en: "Contract Manager", ar: "مدير العقود" },
    person: { en: "Rana Al-Otaibi", ar: "رنا العتيبي" },
    confidence: "high",
    reason: { en: "Acceptance certificates route through contract administration.", ar: "شهادات القبول تمر عبر إدارة العقود عادة." },
  },
  {
    id: "as_171",
    requirement: "ob_007",
    clause: "17.1",
    role: { en: "Finance Department", ar: "القسم المالي" },
    person: { en: "Finance Desk", ar: "المكتب المالي" },
    confidence: "review",
    reason: { en: "Payment-application packs usually need two reviewers — confirm the desk.", ar: "حزم طلبات الدفع تحتاج عادة مراجعين — أكّد المكتب." },
  },
  {
    id: "as_97",
    requirement: "ob_006",
    clause: "9.7",
    role: { en: "HSE Officer", ar: "مسؤول السلامة" },
    person: { en: "Omar Qahtani", ar: "عمر القحطاني" },
    confidence: "high",
    reason: { en: "Safety training registers sit with the HSE lead.", ar: "سجلات السلامة لدى مسؤول السلامة." },
  },
];


export type QueueAction = { key: string; label: LocalizedText; tone?: "primary" | "ghost" };

export type QueueItem = {
  id: string;
  title: LocalizedText;
  detail: LocalizedText;
  meta?: LocalizedText;
  href?: string;
  actions: QueueAction[];
};

/**
 * Demo decision surface: AI proposes, the human approves.
 * Each item is grounded in the demo contract dataset (clause refs, owners, exposure).
 */
export const DEMO_APPROVALS: QueueItem[] = [
  {
    id: "ap_owner_142",
    title: { en: "Assign an owner for obligation 14.2", ar: "تعيين مسؤول للالتزام 14.2" },
    detail: { en: "Monthly SLA records · due in 5 days", ar: "سجلات مستوى الخدمة الشهرية · تستحق خلال 5 أيام" },
    meta: { en: "VAZORA suggestion: Faisal Harbi", ar: "اقتراح VAZORA: فيصل الحربي" },
    href: "/app/contracts/ctr_rta_om_2026/obligations",
    actions: [
      { key: "approve", label: { en: "Approve", ar: "موافقة" }, tone: "primary" },
      { key: "change", label: { en: "Change person", ar: "تغيير الشخص" } },
    ],
  },
  {
    id: "ap_corrective_213",
    title: { en: "Corrective action proposed for clause 21.3", ar: "إجراء تصحيحي مقترح للمادة 21.3" },
    detail: { en: "Acceptance signature requested from the Employer's Representative. Exposure only if the deduction condition applies: SAR 640,000.", ar: "طلب توقيع شهادة القبول من ممثل صاحب العمل. التعرّض فقط عند سريان شرط الخصم: 640,000 ر.س." },
    href: "/app/contracts/ctr_rta_om_2026/risks",
    actions: [
      { key: "review", label: { en: "Review & approve", ar: "مراجعة واعتماد" }, tone: "primary" },
    ],
  },
  {
    id: "ap_due_121",
    title: { en: "Due-date adjustment requested", ar: "طلب تعديل موعد الاستحقاق" },
    detail: { en: "Clause 12.1 — September performance report. Requested: Sep 11 → Sep 13.", ar: "المادة 12.1 — تقرير أداء سبتمبر. المطلوب: 11 سبتمبر ← 13 سبتمبر." },
    href: "/app/contracts/ctr_rta_om_2026/obligations",
    actions: [
      { key: "approve", label: { en: "Approve", ar: "موافقة" }, tone: "primary" },
      { key: "reject", label: { en: "Reject", ar: "رفض" } },
    ],
  },
];

export const DEMO_ACTION_QUEUE: QueueItem[] = [
  {
    id: "ac_ack_missing",
    title: { en: "Client acknowledgement missing", ar: "إقرار العميل مفقود" },
    detail: { en: "Evidence exists but cannot verify the obligation without it.", ar: "الدليل موجود لكن لا يمكن تحقيق الالتزام بدونه." },
    meta: { en: "Requirement 12.1 · September report", ar: "المتطلب 12.1 · تقرير سبتمبر" },
    href: "/app/contracts/ctr_rta_om_2026/evidence",
    actions: [{ key: "request", label: { en: "Request evidence", ar: "طلب الدليل" }, tone: "primary" }],
  },
  {
    id: "ac_kpi6",
    title: { en: "Requirement 12.1 incomplete", ar: "المتطلب 12.1 غير مكتمل" },
    detail: { en: "KPI #6 (energy intensity) absent from the September report.", ar: "المؤشر 6 (كثافة الطاقة) غير مُدرج في تقرير سبتمبر." },
    meta: { en: "Detected during verification of Performance_Sep.pdf", ar: "رُصد أثناء فحص Performance_Sep.pdf" },
    href: "/app/contracts/ctr_rta_om_2026/obligations",
    actions: [{ key: "open", label: { en: "Open requirement", ar: "فتح المتطلب" } }],
  },
  {
    id: "ac_claim5",
    title: { en: "Claim #05 blocked by documents", ar: "المستخلص رقم 05 موقوف بمستندات" },
    detail: { en: "3 blockers: client acknowledgement, KPI #6, acceptance certificate.", ar: "3 معوقات: إقرار العميل، المؤشر 6، شهادة القبول." },
    meta: { en: "Readiness 82%", ar: "الجاهزية 82%" },
    href: "/app/contracts/ctr_rta_om_2026/claims",
    actions: [{ key: "resolve", label: { en: "Resolve blockers", ar: "معالجة المعوقات" }, tone: "primary" }],
  },
  {
    id: "ac_sla_breach",
    title: { en: "High-risk obligation approaching its due date", ar: "التزام عالي المخاطرة يقترب من استحقاقه" },
    detail: { en: "August SLA logs (14.2) missing — exposure SAR 420,000 if the deduction condition applies.", ar: "سجلات مستوى الخدمة لأغسطس (14.2) مفقودة — تعرّض 420,000 ر.س عند سريان شرط الخصم." },
    meta: { en: "Impact in 5 days", ar: "التأثير خلال 5 أيام" },
    href: "/app/contracts/ctr_rta_om_2026/risks",
    actions: [{ key: "escalate", label: { en: "Escalate", ar: "تصعيد" } }],
  },
];

export type OfficerTier = "critical" | "today" | "thisWeek" | "monitoring";

export type OfficerItem = {
  id: string;
  tier: OfficerTier;
  ref: string;
  title: LocalizedText;
  happened: LocalizedText;
  matters: LocalizedText;
  recommends: LocalizedText;
  exposure?: LocalizedText;
  dueIn?: LocalizedText;
  href: string;
  sourceHref: string;
};

export const DEMO_OFFICER_ITEMS: OfficerItem[] = [
  {
    id: "of_142",
    tier: "critical",
    ref: "§ 14.2",
    title: { en: "Requirement 14.2 · Monthly SLA records", ar: "المتطلب 14.2 · سجلات مستوى الخدمة الشهرية" },
    happened: { en: "Evidence for monthly SLA performance is missing.", ar: "دليل أداء مستوى الخدمة الشهري غير موجود." },
    matters: { en: "Without system-generated logs, the Employer may apply Schedule 6 deductions for August.", ar: "بدون سجلات مُستخرجة من النظام قد يطبق صاحب العمل خصومات الجدول 6 لشهر أغسطس." },
    recommends: { en: "Request evidence from Faisal Harbi.", ar: "طلب الدليل من فيصل الحربي." },
    exposure: { en: "SAR 420,000 — only if the deduction condition applies.", ar: "420,000 ر.س — فقط عند سريان شرط الخصم." },
    dueIn: { en: "Due in 5 days", ar: "تستحق خلال 5 أيام" },
    href: "/app/contracts/ctr_rta_om_2026/obligations",
    sourceHref: "/app/contracts/ctr_rta_om_2026",
  },
  {
    id: "of_ack",
    tier: "today",
    ref: "§ 12.1",
    title: { en: "Client acknowledgement missing", ar: "إقرار العميل مفقود" },
    happened: { en: "7/8 KPIs found in the September performance report; acknowledgement not detected.", ar: "رُصد 7/8 مؤشرات في تقرير سبتمبر؛ الإقرار غير موجود." },
    matters: { en: "Claim #05 stays at 82% until both gaps close.", ar: "يبقى المستخلص رقم 05 عند 82% حتى يُغلق الفراغان." },
    recommends: { en: "Request acknowledgement from the client representative and add KPI #6.", ar: "طلب الإقرار من ممثل العميل وإضافة المؤشر 6." },
    href: "/app/contracts/ctr_rta_om_2026/evidence",
    sourceHref: "/app/contracts/ctr_rta_om_2026",
  },
  {
    id: "of_accept",
    tier: "thisWeek",
    ref: "§ 21.3",
    title: { en: "Deliverable 4 acceptance unsigned", ar: "لم تُوقَّع شهادة قبول المُخرج 4" },
    happened: { en: "Only the commissioning report is on file.", ar: "تقرير التشغيل هو الوثيقة الوحيدة المسجلة." },
    matters: { en: "Payment for Deliverable 4 cannot enter Claim #05 without the certificate.", ar: "لا يمكن إدراج دفعة المُخرج 4 في المستخلص رقم 05 دون الشهادة." },
    recommends: { en: "Escalate to the Employer's Representative with a 2-day SLA.", ar: "تصعيد لممثل صاحب العمل بمهلة يومين." },
    exposure: { en: "SAR 640,000", ar: "640,000 ر.س" },
    href: "/app/contracts/ctr_rta_om_2026/risks",
    sourceHref: "/app/contracts/ctr_rta_om_2026",
  },
  {
    id: "of_hvac",
    tier: "monitoring",
    ref: "§ 8.4",
    title: { en: "PM records verified — HVAC", ar: "سجلات الصيانة الوقائية متحققة — التكييف" },
    happened: { en: "42/42 asset records present and signed by the Employer's Representative.", ar: "42/42 سجلات أصول مُدرجة وموقعة من ممثل صاحب العمل." },
    matters: { en: "No action needed. Baseline proof is secured for Claim #05.", ar: "لا حاجة لأي إجراء. أساس الإثبات مؤمَّن للمستخلص رقم 05." },
    recommends: { en: "Keep monitoring next month’s cycle automatically.", ar: "الاستمرار بالمراقبة التلقائية لدورة الشهر القادم." },
    href: "/app/contracts/ctr_rta_om_2026/evidence",
    sourceHref: "/app/contracts/ctr_rta_om_2026",
  },
];
