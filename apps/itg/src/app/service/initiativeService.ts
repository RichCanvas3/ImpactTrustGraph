export type InitiativeState =
  | "draft"
  | "chartered"
  | "funded"
  | "executing"
  | "evaluating"
  | "closed";

export type InitiativeScope = "active" | "mine" | "all";

export interface InitiativeRow {
  id: number;
  title: string;
  summary?: string | null;
  state: InitiativeState;
  created_by_individual_id?: number | null;
  created_by_org_id?: number | null;
  governance_json?: string | null;
  budget_json?: string | null;
  payout_rules_json?: string | null;
  metadata_json?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface InitiativeParticipantRow {
  id: number;
  initiative_id: number;
  participant_kind: "individual" | "organization";
  individual_id?: number | null;
  organization_id?: number | null;
  role: string;
  status: string;
  invited_by_individual_id?: number | null;
  created_at?: number;
  updated_at?: number;
  // optional joins from dashboard endpoint
  individual_first_name?: string | null;
  individual_last_name?: string | null;
  individual_email?: string | null;
  individual_eoa?: string | null;
  org_ens_name?: string | null;
  org_name?: string | null;
  org_agent_name?: string | null;
}

export interface InitiativeWorkstreamRow {
  id: number;
  initiative_id: number;
  title: string;
  description?: string | null;
  status: string;
  sort_order: number;
  created_at?: number;
  updated_at?: number;
}

export interface InitiativeOutcomeRow {
  id: number;
  initiative_id: number;
  title: string;
  metric_json?: string | null;
  status: string;
  created_at?: number;
  updated_at?: number;
}

export interface OpportunityRow {
  id: number;
  initiative_id: number;
  workstream_id?: number | null;
  title: string;
  description?: string | null;
  required_skills_json?: string | null;
  budget_json?: string | null;
  status: string;
  created_by_individual_id?: number | null;
  created_by_org_id?: number | null;
  created_at?: number;
  updated_at?: number;
}

export interface EngagementRow {
  id: number;
  initiative_id: number;
  opportunity_id: number;
  requesting_organization_id?: number | null;
  contributor_individual_id?: number | null;
  contributor_agent_row_id?: number | null;
  terms_json?: string | null;
  status: string;
  created_at?: number;
  updated_at?: number;
  // optional joins from dashboard endpoint
  opportunity_title?: string | null;
  requesting_org_ens_name?: string | null;
  requesting_org_name?: string | null;
  contributor_first_name?: string | null;
  contributor_last_name?: string | null;
  contributor_eoa?: string | null;
}

export interface MilestoneRow {
  id: number;
  engagement_id: number;
  title: string;
  due_at?: number | null;
  status: string;
  evidence_json?: string | null;
  payout_json?: string | null;
  created_at?: number;
  updated_at?: number;
  // from dashboard endpoint join
  opportunity_id?: number;
}

export interface AttestationRow {
  id: number;
  attestation_type: string;
  payload_json?: string | null;
  initiative_id?: number | null;
  opportunity_id?: number | null;
  engagement_id?: number | null;
  milestone_id?: number | null;
  actor_individual_id?: number | null;
  actor_org_id?: number | null;
  chain_id?: number | null;
  tx_hash?: string | null;
  eas_uid?: string | null;
  created_at?: number;
}

export interface InitiativeDashboardResponse {
  initiative: InitiativeRow;
  counts: Record<string, number>;
  participants: InitiativeParticipantRow[];
  workstreams: InitiativeWorkstreamRow[];
  outcomes: InitiativeOutcomeRow[];
  opportunities: OpportunityRow[];
  engagements: EngagementRow[];
  milestones: MilestoneRow[];
  attestations: AttestationRow[];
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  const err = await res.json().catch(() => ({}));
  throw new Error(err.message || err.error || `Request failed (${res.status})`);
}

export async function listInitiatives(individualId: number, scope: InitiativeScope, signal?: AbortSignal): Promise<InitiativeRow[]> {
  const params = new URLSearchParams();
  params.set("individualId", String(individualId));
  params.set("scope", scope);
  const res = await fetch(`/api/initiatives?${params.toString()}`, { method: "GET", signal });
  const data = await jsonOrThrow<{ initiatives: InitiativeRow[] }>(res);
  return data.initiatives || [];
}

export async function createInitiative(input: {
  title: string;
  summary?: string | null;
  state?: InitiativeState;
  created_by_individual_id: number;
  created_by_org_id?: number | null;
  governance_json?: any;
  budget_json?: any;
  payout_rules_json?: any;
  metadata_json?: any;
  initial_participants?: Array<{
    participant_kind: "individual" | "organization";
    individual_id?: number | null;
    organization_id?: number | null;
    role?: string;
    status?: string;
  }>;
}): Promise<InitiativeRow> {
  const res = await fetch("/api/initiatives", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ initiative: InitiativeRow }>(res);
  return data.initiative;
}

export async function getInitiativeDashboard(id: number): Promise<InitiativeDashboardResponse> {
  const res = await fetch(`/api/initiatives/${id}`, { method: "GET" });
  return await jsonOrThrow<InitiativeDashboardResponse>(res);
}

export async function updateInitiative(
  id: number,
  patch: Partial<InitiativeRow> & { actor_individual_id?: number | null; actor_eoa?: string | null },
) {
  const res = await fetch(`/api/initiatives/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await jsonOrThrow<{ initiative: InitiativeRow }>(res);
  return data.initiative;
}

export async function updateParticipants(initiativeId: number, input: {
  action: "add" | "remove" | "update";
  participant_kind: "individual" | "organization";
  individual_id?: number | null;
  organization_id?: number | null;
  role?: string;
  status?: string;
  actor_individual_id?: number | null;
  actor_eoa?: string | null; // legacy fallback to resolve individual id
}) {
  const res = await fetch(`/api/initiatives/${initiativeId}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ participants: InitiativeParticipantRow[] }>(res);
  return data.participants || [];
}

export async function createWorkstream(initiativeId: number, input: {
  title: string;
  description?: string | null;
  sort_order?: number;
  status?: string;
  actor_individual_id?: number | null;
  actor_eoa?: string | null;
}) {
  const res = await fetch(`/api/initiatives/${initiativeId}/workstreams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ workstream: InitiativeWorkstreamRow }>(res);
  return data.workstream;
}

export async function createOutcome(initiativeId: number, input: {
  title: string;
  metric_json?: any;
  status?: string;
  actor_individual_id?: number | null;
  actor_eoa?: string | null;
}) {
  const res = await fetch(`/api/initiatives/${initiativeId}/outcomes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ outcome: InitiativeOutcomeRow }>(res);
  return data.outcome;
}

export async function createOpportunity(initiativeId: number, input: {
  title: string;
  description?: string | null;
  workstream_id?: number | null;
  required_skills_json?: any;
  budget_json?: any;
  status?: string;
  created_by_org_id?: number | null;
  actor_individual_id?: number | null;
  actor_eoa?: string | null;
}) {
  const res = await fetch(`/api/initiatives/${initiativeId}/opportunities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ opportunity: OpportunityRow }>(res);
  return data.opportunity;
}

export async function createEngagementFromOpportunity(opportunityId: number, input: {
  initiative_id: number;
  requesting_organization_id?: number | null;
  contributor_individual_id?: number | null;
  contributor_eoa?: string | null;
  contributor_agent_row_id?: number | null;
  terms_json?: any;
  status?: string;
  actor_individual_id?: number | null;
  actor_eoa?: string | null;
}) {
  const res = await fetch(`/api/opportunities/${opportunityId}/engagements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ engagement: EngagementRow }>(res);
  return data.engagement;
}

export async function createMilestone(engagementId: number, input: {
  title: string;
  due_at?: number | null;
  status?: string;
  evidence_json?: any;
  payout_json?: any;
  actor_individual_id?: number | null;
  actor_eoa?: string | null;
}) {
  const res = await fetch(`/api/engagements/${engagementId}/milestones`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ milestone: MilestoneRow }>(res);
  return data.milestone;
}

export async function updateMilestone(milestoneId: number, patch: {
  status?: string;
  evidence_json?: any;
  payout_json?: any;
  actor_individual_id?: number | null;
  actor_eoa?: string | null;
}) {
  const res = await fetch(`/api/milestones/${milestoneId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await jsonOrThrow<{ milestone: MilestoneRow }>(res);
  return data.milestone;
}

export async function listAttestations(initiativeId?: number): Promise<AttestationRow[]> {
  const params = new URLSearchParams();
  if (typeof initiativeId === "number") params.set("initiativeId", String(initiativeId));
  const res = await fetch(`/api/attestations?${params.toString()}`, { method: "GET" });
  const data = await jsonOrThrow<{ attestations: AttestationRow[] }>(res);
  return data.attestations || [];
}

export async function writeAttestation(
  input: Omit<AttestationRow, "id" | "created_at" | "payload_json"> & { payload?: any },
) {
  const res = await fetch("/api/attestations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attestation_type: input.attestation_type,
      payload: input.payload,
      initiative_id: input.initiative_id ?? null,
      opportunity_id: input.opportunity_id ?? null,
      engagement_id: input.engagement_id ?? null,
      milestone_id: input.milestone_id ?? null,
      actor_individual_id: input.actor_individual_id ?? null,
      actor_org_id: input.actor_org_id ?? null,
      chain_id: input.chain_id ?? null,
      tx_hash: input.tx_hash ?? null,
      eas_uid: input.eas_uid ?? null,
    }),
  });
  await jsonOrThrow(res);
}

