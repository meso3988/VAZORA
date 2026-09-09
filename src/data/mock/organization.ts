import type { SessionUser } from "@/data/auth/session";
import type { Organization, OrganizationMember, Project } from "@/domain/types";

/** Fixed "today" for the demo dataset so relative dates stay coherent. */
export const DEMO_TODAY = "2026-09-08";

export const DEMO_ORGANIZATION_ID = "org_demo_northline";

export const DEMO_ORGANIZATION: Organization = {
  id: DEMO_ORGANIZATION_ID,
  name: {
    en: "Northline Operations & Maintenance",
    ar: "نورث لاين للتشغيل والصيانة",
  },
  slug: "northline",
  country: "SA",
  createdAt: "2026-01-12",
};

export const DEMO_USER: SessionUser = {
  id: "usr_demo_rana",
  name: "Rana Al-Otaibi",
  email: "rana@northline.example",
  organizationId: DEMO_ORGANIZATION_ID,
  role: "contract_manager",
};

export const DEMO_MEMBERS: OrganizationMember[] = [
  {
    id: "mem_1",
    organizationId: DEMO_ORGANIZATION_ID,
    userId: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    role: "contract_manager",
  },
  {
    id: "mem_2",
    organizationId: DEMO_ORGANIZATION_ID,
    userId: "usr_demo_faisal",
    name: "Faisal Harbi",
    email: "faisal@northline.example",
    role: "member",
  },
  {
    id: "mem_3",
    organizationId: DEMO_ORGANIZATION_ID,
    userId: "usr_demo_lina",
    name: "Lina Saad",
    email: "lina@northline.example",
    role: "member",
  },
  {
    id: "mem_4",
    organizationId: DEMO_ORGANIZATION_ID,
    userId: "usr_demo_omar",
    name: "Omar Qahtani",
    email: "omar@northline.example",
    role: "admin",
  },
];

export const DEMO_PROJECTS: Project[] = [
  {
    id: "prj_riyadh_metro_om",
    organizationId: DEMO_ORGANIZATION_ID,
    name: { en: "Riyadh Transit Facilities O&M", ar: "تشغيل وصيانة مرافق النقل - الرياض" },
    client: { en: "Regional Transport Authority", ar: "هيئة النقل الإقليمية" },
    sector: "operations_maintenance",
  },
  {
    id: "prj_data_center",
    organizationId: DEMO_ORGANIZATION_ID,
    name: { en: "Jeddah Data Center Services", ar: "خدمات مركز البيانات - جدة" },
    client: { en: "National Digital Services Co.", ar: "الشركة الوطنية للخدمات الرقمية" },
    sector: "technology_services",
  },
  {
    id: "prj_hospital_fm",
    organizationId: DEMO_ORGANIZATION_ID,
    name: { en: "Eastern Hospital Facilities Management", ar: "إدارة مرافق المستشفى الشرقي" },
    client: { en: "Eastern Health Cluster", ar: "التجمع الصحي الشرقي" },
    sector: "facilities_management",
  },
];
