// VAZORA — synthetic benchmark contracts generator.
// Generates three safe, fictional contracts (Arabic / English / mixed) with
// known obligations so extraction accuracy can be measured objectively.
// Run: node --import tsx supabase/tests/fixtures/generate-synthetic.ts
// Output: supabase/tests/fixtures/*.docx + ground-truth JSON next to them.

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

type BenchObligation = {
  clause: string;
  requirement: string;
  frequency: string | null;
  due_rule: string | null;
  evidence: string[];
  payment_linked: boolean | null;
  financial: "penalty" | "deduction" | "retention" | null;
  external_dependency: string | null;
  submission: { destination: string; channel: string; deadline_rule: string } | null;
  owner_role: string | null;
};

type Bench = {
  id: string;
  language: "ar" | "en" | "mixed";
  files: { name: string; relationship: string; paragraphs: { heading?: string; text: string }[] }[];
  groundTruth: BenchObligation[];
  /** Optional addendum override variants for one obligation (document precedence conflicts). */
  addendumConflict?: {
    mainClause: string;
    requirement: string;
    addendumDueRule: string;
    addendumRaw: string;
  }[];
};

type GroundTruthFile = {
  benchmark: string;
  language: "ar" | "en" | "mixed";
  files: string[];
  obligations: BenchObligation[];
  addendumConflict?: Bench["addendumConflict"];
};

const AR: Bench = {
  id: "bench-ar-om",
  language: "ar",
  files: [
    {
      name: "bench-ar-om-main.docx",
      relationship: "main",
      paragraphs: [
        { heading: "عقد تشغيل وصيانة مرافق — بلدية النقل", text: "بين بلدية النقل (الجهة المشترية) والشركة (المقاول)." },
        { heading: "المادة 12 — تقارير الأداء الشهرية", text: "يقدم المقاول تقرير أداء شهريًا في اليوم الخامس من كل شهر عن الشهر السابق، متضمنًا ثمانية مؤشرات أداء رئيسية. توقّع التقرير مدير المشروع وتقرّه الجهة المشترية." },
        { heading: "المادة 14 — سجلات الصيانة الوقائية", text: "يحتفظ المقاول بسجلات الصيانة الوقائية الموقعة ويقدمها مع كل مستخلص شهري كشرط للصرف." },
        { heading: "المادة 18 — الربط بالمستخلص", text: "لا يُصرف المستخلص الشهري إلا بعد تقديم تقرير الأداء وتوقيع الجهة المشترية عليه بموجب المادة 18.3." },
        { heading: "المادة 21 — الجزاءات", text: "إذا تأخر المقاول عن التسليم في الموعد المحدد تُطبق غرامة خصم بمقدار 0.5% من قيمة البند لكل أسبوع تأخير." },
        { heading: "المادة 22 — الاعتمادات الخارجية", text: "يتطلب تشغيل المرحلة الثانية توقيع ممثل الجهة المشترية على شهادة جاهزية الموقع قبل البدء." },
        { heading: "المادة 23 — التقديم", text: "تقدم جميع التقارير عبر بوابة الجهة المشترية الإلكترونية إلى مكتب إدارة المشاريع PMO في اليوم الخامس من كل شهر." },
      ],
    },
    {
      name: "bench-ar-om-addendum.docx",
      relationship: "addendum",
      paragraphs: [
        { heading: "ملحق رقم 02 — تعديل المادة 23", text: "يعدّل ما ورد في المادة 23: تقدم التقارير الشهرية في اليوم السابع من كل شهر بدلًا من اليوم الخامس." },
      ],
    },
  ],
  groundTruth: [
    {
      clause: "12",
      requirement: "تقرير أداء شهري بثمانية مؤشرات",
      frequency: "monthly",
      due_rule: "monthly_day_5",
      evidence: ["تقرير أداء شهري", "ثمانية مؤشرات أداء", "توقيع مدير المشروع"],
      payment_linked: false,
      financial: null,
      external_dependency: "إقرار الجهة المشترية",
      submission: { destination: "PMO", channel: "portal", deadline_rule: "يوم 5 شهريًا" },
      owner_role: "مدير المشروع",
    },
    {
      clause: "14",
      requirement: "سجلات الصيانة الوقائية الموقعة",
      frequency: "monthly",
      due_rule: "with_monthly_claim",
      evidence: ["سجلات الصيانة الوقائية الموقعة"],
      payment_linked: true,
      financial: null,
      external_dependency: null,
      submission: null,
      owner_role: "مسؤول الصيانة",
    },
    {
      clause: "18",
      requirement: "المادة 18.3 — الربط بصرف المستخلص",
      frequency: "monthly",
      due_rule: "monthly_day_5",
      evidence: ["تقرير الأداء الموقّع"],
      payment_linked: true,
      financial: null,
      external_dependency: "توقيع الجهة المشترية",
      submission: { destination: "الجهة المشترية", channel: "portal", deadline_rule: "يوم 5 شهريًا" },
      owner_role: "مدير المشروع",
    },
    {
      clause: "21",
      requirement: "غرامة تأخير 0.5% أسبوعيًا",
      frequency: null,
      due_rule: null,
      evidence: [],
      payment_linked: null,
      financial: "penalty",
      external_dependency: null,
      submission: null,
      owner_role: null,
    },
    {
      clause: "22",
      requirement: "شهادة جاهزية الموقع قبل المرحلة الثانية",
      frequency: null,
      due_rule: null,
      evidence: ["شهادة جاهزية الموقع"],
      payment_linked: null,
      financial: null,
      external_dependency: "توقيع ممثل الجهة المشترية",
      submission: null,
      owner_role: null,
    },
    {
      clause: "23",
      requirement: "تقديم التقارير عبر بوابة PMO في اليوم الخامس",
      frequency: "monthly",
      due_rule: "monthly_day_5",
      evidence: ["تقرير أداء شهري"],
      payment_linked: false,
      financial: null,
      external_dependency: null,
      submission: { destination: "PMO", channel: "portal", deadline_rule: "يوم 5 شهريًا" },
      owner_role: "منسق التقارير",
    },
  ],
  addendumConflict: [
    {
      mainClause: "23",
      requirement: "تقديم التقارير عبر بوابة PMO في اليوم السابع",
      addendumDueRule: "monthly_day_7",
      addendumRaw: "يعدّل الملحق: التقديم في اليوم السابع من كل شهر بدل الخامس.",
    },
  ],
};

const EN: Bench = {
  id: "bench-en-svc",
  language: "en",
  files: [
    {
      name: "bench-en-svc.docx",
      relationship: "main",
      paragraphs: [
        { heading: "Services Contract — Regional Facilities", text: "Between the Client (Regional Facilities Authority) and the Contractor." },
        { heading: "Clause 5.1 — Monthly Service Report", text: "The Contractor shall submit a monthly service report by the 5th of each month covering the preceding month, including eight KPI results. The report is signed by the Project Manager and acknowledged by the Client." },
        { heading: "Clause 7.2 — Preventive Maintenance Records", text: "Signed preventive maintenance records shall accompany each monthly invoice as a condition of payment." },
        { heading: "Clause 10 — Payment Linkage", text: "The monthly invoice is payable only upon submission of the service report and written acknowledgement by the Client under 10.4." },
        { heading: "Clause 12 — Liquidated Damages", text: "Delay in deliverable submission incurs liquidated damages of 0.5% of the line value per week of delay." },
        { heading: "Clause 13 — External Dependency", text: "Phase Two commencement requires the Client's site-readiness certificate signed by the Client representative." },
        { heading: "Clause 15 — Submission", text: "All reports shall be submitted via the Client portal to the PMO by the 5th of each month." },
      ],
    },
  ],
  groundTruth: [
    { clause: "5.1", requirement: "Monthly service report with eight KPIs, acknowledged by the Client", frequency: "monthly", due_rule: "monthly_day_5", evidence: ["Monthly service report", "Eight KPI results", "Project Manager signature"], payment_linked: true, financial: null, external_dependency: "Client acknowledgement", submission: { destination: "PMO", channel: "portal", deadline_rule: "day 5 monthly" }, owner_role: "Project Manager" },
    { clause: "7.2", requirement: "Signed preventive maintenance records with each invoice", frequency: "monthly", due_rule: "with_monthly_claim", evidence: ["Signed maintenance records"], payment_linked: true, financial: null, external_dependency: null, submission: null, owner_role: "Maintenance Lead" },
    { clause: "10", requirement: "10.4 — invoice only after service report acknowledgement", frequency: "monthly", due_rule: "monthly_day_5", evidence: ["Service report acknowledgment"], payment_linked: true, financial: null, external_dependency: "Client written acknowledgement", submission: null, owner_role: "Project Manager" },
    { clause: "12", requirement: "Liquidated damages of 0.5% per week of delay", frequency: null, due_rule: null, evidence: [], payment_linked: null, financial: "penalty", external_dependency: null, submission: null, owner_role: null },
    { clause: "13", requirement: "Client site-readiness certificate before Phase Two", frequency: null, due_rule: null, evidence: ["Site readiness certificate"], payment_linked: null, financial: null, external_dependency: "Client representative signature", submission: null, owner_role: null },
    { clause: "15", requirement: "Submit reports via Client portal to PMO by day 5", frequency: "monthly", due_rule: "monthly_day_5", evidence: ["Monthly service report"], payment_linked: false, financial: null, external_dependency: null, submission: { destination: "Client PMO", channel: "portal", deadline_rule: "day 5 monthly" }, owner_role: "Project Coordinator" },
  ],
};

const MIXED: Bench = {
  id: "bench-mixed-dc",
  language: "mixed",
  files: [
    {
      name: "bench-mixed-dc.docx",
      relationship: "main",
      paragraphs: [
        { heading: "Data Center Operations — مركز البيانات", text: "Between الوزارة الرقمية and المشغل (الشركة)." },
        { heading: "المادة 8 — SLA الاستمرارية / uptime", text: "يلتزم المشغل بتحقيق uptime بنسبة لا تقل عن 99.9% شهريًا، مع قياس شهري موثق." },
        { heading: "Clause 9 — Monthly uptime report", text: "The Operator shall submit a monthly uptime report by the 10th day following the period end, through the Client portal." },
        { heading: "المادة 11 — خصم الالتزام بالخدمة", text: "إذا انخفض الـuptime عن 99.9% في شهر ما، يخصم 1% من قيمة المستخلص الشهري عن هذا الشهر." },
        { heading: "Clause 12 — Client acknowledgement", text: "Monthly reports require Client acknowledgement via the Client portal before payment release." },
      ],
    },
  ],
  groundTruth: [
    { clause: "8", requirement: "uptime ≥ 99.9% شهري", frequency: "monthly", due_rule: null, evidence: ["قياس uptime شهري موثق"], payment_linked: null, financial: null, external_dependency: null, submission: null, owner_role: "مدير العمليات" },
    { clause: "9", requirement: "Monthly uptime report by day 10 after period end", frequency: "monthly", due_rule: "day_10_after_period_end", evidence: ["Monthly uptime report"], payment_linked: true, financial: null, external_dependency: null, submission: { destination: "Client portal", channel: "portal", deadline_rule: "day 10 after period end" }, owner_role: "Operations Manager" },
    { clause: "11", requirement: "خصم 1% عند انخفاض الـuptime", frequency: null, due_rule: null, evidence: [], payment_linked: null, financial: "deduction", external_dependency: null, submission: null, owner_role: null },
    { clause: "12", requirement: "Client acknowledgement before payment release", frequency: "monthly", due_rule: "monthly_day_5", evidence: ["Client acknowledgement"], payment_linked: true, financial: null, external_dependency: "Client portal acknowledgement", submission: null, owner_role: "Operations Manager" },
  ],
};

const CONTRACTS: Bench[] = [AR, EN, MIXED];

async function make() {
  for (const bench of CONTRACTS) {
    for (const file of bench.files) {
      const doc = new Document({
        sections: [{
          children: file.paragraphs.flatMap((p) => [
            ...(p.heading ? [new Paragraph({ text: p.heading, heading: HeadingLevel.HEADING_2 })] : []),
            new Paragraph({ children: [new TextRun(p.text)] }),
          ]),
        }],
      });
      const buf = await Packer.toBuffer(doc);
      writeFileSync(join(here, file.name), buf);
      console.log("wrote", file.name);
    }
    const fileJson: GroundTruthFile = {
      benchmark: bench.id,
      language: bench.language,
      files: bench.files.map((f) => f.name),
      obligations: bench.groundTruth,
      ...(bench.addendumConflict ? { addendumConflict: bench.addendumConflict } : {}),
    };
    writeFileSync(
      join(here, `${bench.id}.ground-truth.json`),
      JSON.stringify(fileJson, null, 2),
    );
    console.log("wrote", `${bench.id}.ground-truth.json`);
  }
}

void make();
