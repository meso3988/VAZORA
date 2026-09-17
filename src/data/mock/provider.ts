import type { DataProvider } from "@/data/repositories";

import {
  DEMO_ACTIONS,
  DEMO_ACTIVITY,
  DEMO_AGENT_EVENTS,
  DEMO_CLAIMS,
  DEMO_CLAUSES,
  DEMO_CONTRACTS,
  DEMO_EVIDENCE,
  DEMO_OBLIGATIONS,
  DEMO_RISKS,
} from "./contracts";
import { DEMO_MEMBERS, DEMO_ORGANIZATION, DEMO_PROJECTS } from "./organization";

const byOrg = <T extends { organizationId: string }>(items: T[], organizationId: string) =>
  items.filter((i) => i.organizationId === organizationId);

const byContract = <T extends { contractId?: string }>(items: T[], contractId?: string) =>
  contractId ? items.filter((i) => i.contractId === contractId) : items;

const newestFirst = <T extends { createdAt?: string; at?: string }>(items: T[]) =>
  [...items].sort((a, b) =>
    (b.createdAt ?? b.at ?? "").localeCompare(a.createdAt ?? a.at ?? ""),
  );

/** In-memory demo dataset. Read-only; clearly separated from any real persistence. */
export const mockDataProvider: DataProvider = {
  kind: "mock",
  organizations: {
    async getById(id) {
      return DEMO_ORGANIZATION.id === id ? DEMO_ORGANIZATION : null;
    },
    async listMembers(organizationId) {
      return byOrg(DEMO_MEMBERS, organizationId);
    },
    async listProjects(organizationId) {
      return byOrg(DEMO_PROJECTS, organizationId);
    },
  },
  contracts: {
    async list(organizationId) {
      return byOrg(DEMO_CONTRACTS, organizationId);
    },
    async getById(organizationId, id) {
      return byOrg(DEMO_CONTRACTS, organizationId).find((c) => c.id === id) ?? null;
    },
    async listClauses(organizationId, contractId) {
      const contract = byOrg(DEMO_CONTRACTS, organizationId).find((c) => c.id === contractId);
      return contract ? DEMO_CLAUSES.filter((c) => c.contractId === contractId) : [];
    },
  },
  obligations: {
    async list(organizationId, filter) {
      return byContract(byOrg(DEMO_OBLIGATIONS, organizationId), filter?.contractId);
    },
    async getById(organizationId, id) {
      return byOrg(DEMO_OBLIGATIONS, organizationId).find((o) => o.id === id) ?? null;
    },
  },
  evidence: {
    async list(organizationId, filter) {
      const items = byContract(byOrg(DEMO_EVIDENCE, organizationId), filter?.contractId);
      return filter?.obligationId
        ? items.filter((e) => e.obligationId === filter.obligationId)
        : items;
    },
  },
  risks: {
    async list(organizationId, filter) {
      return byContract(byOrg(DEMO_RISKS, organizationId), filter?.contractId);
    },
  },
  actions: {
    async list(organizationId, filter) {
      return byContract(byOrg(DEMO_ACTIONS, organizationId), filter?.contractId);
    },
  },
  claims: {
    async list(organizationId, filter) {
      return byContract(byOrg(DEMO_CLAIMS, organizationId), filter?.contractId);
    },
    async getById(organizationId, id) {
      return byOrg(DEMO_CLAIMS, organizationId).find((c) => c.id === id) ?? null;
    },
  },
  agent: {
    async listEvents(organizationId, filter) {
      const items = newestFirst(byContract(byOrg(DEMO_AGENT_EVENTS, organizationId), filter?.contractId));
      return filter?.limit ? items.slice(0, filter.limit) : items;
    },
  },
  activity: {
    async list(organizationId, filter) {
      const items = newestFirst(byContract(byOrg(DEMO_ACTIVITY, organizationId), filter?.contractId));
      return filter?.limit ? items.slice(0, filter.limit) : items;
    },
  },
  documents: {
    async list() {
      return [];
    },
  },
};
