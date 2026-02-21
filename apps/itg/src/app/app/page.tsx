"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection } from "../../components/connection-context";
import { useCurrentUserProfile } from "../../components/useCurrentUserProfile";
import { useDefaultOrgAgent } from "../../components/useDefaultOrgAgent";
import { getRoleTitle } from "../../components/appNav";
import type { AppViewId } from "../../components/AppShell";
import { getUserOrganizationsByIndividualId, upsertUserOrganizationByIndividualId, type OrganizationAssociation } from "../service/userProfileService";
import {
  createEngagementFromOpportunity,
  createInitiative,
  createMilestone,
  createOpportunity,
  getInitiativeDashboard,
  listInitiatives,
  updateMilestone,
  updateInitiative,
  updateParticipants,
  type AttestationRow,
  type EngagementRow,
  type InitiativeDashboardResponse,
  type InitiativeRow,
  type InitiativeState,
  type MilestoneRow,
  type OpportunityRow,
} from "../service/initiativeService";

type ViewId = AppViewId | "wallet";

function Placeholder(props: { title: string; note?: string; links?: Array<{ label: string; href: string }> }) {
  const { title, note, links } = props;
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Typography sx={{ fontWeight: 800, mb: 0.75 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: links?.length ? 1.25 : 0 }}>
          {note ?? "Coming soon — this view is mocked based on the HTML prototype."}
        </Typography>
        {links?.length ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {links.map((l) => (
              <Button key={l.href} component={Link} href={l.href} variant="outlined">
                {l.label}
              </Button>
            ))}
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatWhen(ts?: number | null): string {
  if (!ts) return "";
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return "";
  }
}

function truncateJson(raw: string | null | undefined, max = 120): string {
  if (!raw) return "";
  const s = String(raw);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stateLabel(state: InitiativeState): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "chartered":
      return "Chartered";
    case "funded":
      return "Funded";
    case "executing":
      return "Executing";
    case "evaluating":
      return "Evaluating";
    case "closed":
      return "Closed";
  }
}

export default function ApplicationEnvironmentPage() {
  const router = useRouter();
  const { user } = useConnection();
  const isConnected = Boolean(user);
  const searchParams = useSearchParams();
  const view = (searchParams?.get("view") ?? "trust-trail") as ViewId;
  const initiativeIdParam = searchParams?.get("initiativeId");
  const initiativeId = React.useMemo(() => {
    if (!initiativeIdParam) return null;
    const n = Number.parseInt(initiativeIdParam, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [initiativeIdParam]);

  const [orgs, setOrgs] = React.useState<OrganizationAssociation[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { walletAddress, profile, role, loading: profileLoading, hasHydrated } = useCurrentUserProfile();
  const { defaultOrgAgent } = useDefaultOrgAgent();
  const profileRole = React.useMemo(() => (typeof profile?.role === "string" ? profile.role : null), [profile?.role]);
  const individualId = React.useMemo(() => {
    const raw = (profile as any)?.id;
    if (raw == null) return null;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [profile]);

  // Fetch organizations by individualId only (after profile is loaded).
  const orgFetchKeyRef = React.useRef<string | null>(null); // last successful key
  React.useEffect(() => {
    if (!isConnected) {
      setOrgs(null);
      setLoading(false);
      return;
    }
    if (individualId == null || individualId < 1) {
      setLoading(false);
      orgFetchKeyRef.current = null;
      return;
    }
    const desiredEns = typeof defaultOrgAgent?.ensName === "string" ? defaultOrgAgent.ensName.toLowerCase() : "";
    const key = `${individualId}:${desiredEns}`;
    if (orgFetchKeyRef.current === key) {
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Enforce referential integrity: if a selected org agent exists, ensure it is linked
        // to this individual via organizations + individual_organizations (no EOA lookup).
        const ens = typeof defaultOrgAgent?.ensName === "string" ? defaultOrgAgent.ensName.trim() : "";
        const agentNameRaw = typeof defaultOrgAgent?.agentName === "string" ? defaultOrgAgent.agentName.trim() : "";
        const agentName = agentNameRaw || (ens ? String(ens.split(".")[0] || "").trim() : "");
        if (ens && agentName) {
          await upsertUserOrganizationByIndividualId({
            individual_id: individualId,
            ens_name: ens,
            agent_name: agentName,
            org_name: typeof defaultOrgAgent?.name === "string" ? defaultOrgAgent.name : null,
            agent_account: typeof defaultOrgAgent?.agentAccount === "string" ? defaultOrgAgent.agentAccount : null,
            uaid: typeof (defaultOrgAgent as any)?.uaid === "string" ? (defaultOrgAgent as any).uaid : null,
            chain_id: typeof defaultOrgAgent?.chainId === "number" ? defaultOrgAgent.chainId : null,
            is_primary: true,
            role: profileRole,
          });
        }

        if (ac.signal.aborted) return;
        const orgList = await getUserOrganizationsByIndividualId(individualId);
        if (!ac.signal.aborted) {
          setOrgs(orgList);
          orgFetchKeyRef.current = key;
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message || String(e));
        // allow retry on next render
        orgFetchKeyRef.current = null;
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      ac.abort();
      setLoading(false);
      // allow retry after abort (connect/select races)
      orgFetchKeyRef.current = null;
    };
  }, [isConnected, individualId, defaultOrgAgent?.ensName, profileRole]);

  const primaryOrg = React.useMemo(() => {
    const list = Array.isArray(orgs) ? orgs : [];
    const desiredEns = typeof defaultOrgAgent?.ensName === "string" ? defaultOrgAgent.ensName.toLowerCase() : "";
    const selected = desiredEns ? list.find((o) => String(o.ens_name || "").toLowerCase() === desiredEns) ?? null : null;
    return selected ?? list.find((o) => o.is_primary) ?? list[0] ?? null;
  }, [orgs, defaultOrgAgent?.ensName]);

  const renderInitiativesHeaderCard = (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography sx={{ fontWeight: 800, mb: 0.5 }}>You</Typography>
            <Typography variant="body2" color="text.secondary">
              {profile?.first_name || profile?.last_name
                ? `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim()
                : profile?.social_display_name || "Participant"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Role: <strong>{profile?.role ?? role ?? "unknown"}</strong>
            </Typography>
            {walletAddress ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontFamily: "monospace" }}>
                {walletAddress}
              </Typography>
            ) : null}
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography sx={{ fontWeight: 800, mb: 0.5 }}>Primary organization</Typography>
            <Typography variant="body2" color="text.secondary">
              {primaryOrg?.org_name || primaryOrg?.ens_name || "None"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Agent: <strong>{primaryOrg?.agent_name || "—"}</strong>
            </Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );

  function InitiativesList(props: { title: string; scope: "active" | "mine" | "all" }) {
    const { title, scope } = props;
    const [rows, setRows] = React.useState<InitiativeRow[]>([]);
    const [loadingRows, setLoadingRows] = React.useState(false);
    const [err, setErr] = React.useState<string | null>(null);
    const [q, setQ] = React.useState("");
    const [refreshTick, setRefreshTick] = React.useState(0);

    React.useEffect(() => {
      if (!individualId) {
        setRows([]);
        setLoadingRows(false);
        return;
      }
      const ac = new AbortController();
      setLoadingRows(true);
      setErr(null);
      (async () => {
        try {
          const list = await listInitiatives(individualId, scope, ac.signal);
          setRows(list);
        } catch (e: any) {
          if (e?.name !== "AbortError") setErr(e?.message || String(e));
        } finally {
          setLoadingRows(false);
        }
      })();
      return () => {
        ac.abort();
        setLoadingRows(false);
      };
    }, [scope, individualId, refreshTick]);

    const filtered = React.useMemo(() => {
      const query = q.trim().toLowerCase();
      if (!query) return rows;
      return rows.filter((r) => {
        const t = String(r.title || "").toLowerCase();
        const s = String(r.summary || "").toLowerCase();
        const st = String(r.state || "").toLowerCase();
        return t.includes(query) || s.includes(query) || st.includes(query) || String(r.id).includes(query);
      });
    }, [rows, q]);

    return (
      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack spacing={1.25}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
              <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setRows([]);
                  setQ("");
                  setRefreshTick((t) => t + 1);
                }}
              >
                Refresh
              </Button>
            </Box>
            <TextField
              size="small"
              placeholder="Search initiatives…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {err ? <Alert severity="error">{err}</Alert> : null}
            {loadingRows ? (
              <Box sx={{ py: 2, display: "flex", justifyContent: "center" }}>
                <CircularProgress size={22} />
              </Box>
            ) : filtered.length === 0 ? (
              <Alert severity="info">No initiatives found.</Alert>
            ) : (
              <Stack spacing={1}>
                {filtered.map((it) => (
                  <Card key={it.id} variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between">
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                            {it.title}
                          </Typography>
                          {it.summary ? (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                              {it.summary}
                            </Typography>
                          ) : null}
                          <Stack direction="row" spacing={1} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={`#${it.id}`} variant="outlined" />
                            <Chip size="small" label={stateLabel(it.state)} color={it.state === "closed" ? "default" : "primary"} variant={it.state === "closed" ? "outlined" : "filled"} />
                          </Stack>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            component={Link}
                            href={`/app?view=initiative-dashboard&initiativeId=${encodeURIComponent(String(it.id))}`}
                            variant="contained"
                            size="small"
                          >
                            Open
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  function CreateInitiativeView() {
    const [title, setTitle] = React.useState("");
    const [summary, setSummary] = React.useState("");
    const [state, setState] = React.useState<InitiativeState>("draft");
    const [includePrimaryOrg, setIncludePrimaryOrg] = React.useState(true);
    const [submitting, setSubmitting] = React.useState(false);
    const [err, setErr] = React.useState<string | null>(null);

    const primaryOrgId = typeof primaryOrg?.id === "number" ? primaryOrg.id : null;

    return (
      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography sx={{ fontWeight: 800 }}>Create Initiative</Typography>
            <Typography variant="body2" color="text.secondary">
              Draft → Charter → Fund → Execute. This creates the shared program container that will hold opportunities, engagements, milestones, and attestations.
            </Typography>
            {err ? <Alert severity="error">{err}</Alert> : null}
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />
            <TextField
              label="Summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              fullWidth
              multiline
              minRows={3}
            />
            <TextField
              label="State"
              select
              value={state}
              onChange={(e) => setState(e.target.value as InitiativeState)}
              SelectProps={{ native: true }}
              fullWidth
            >
              {(["draft", "chartered", "funded", "executing", "evaluating", "closed"] as InitiativeState[]).map((s) => (
                <option key={s} value={s}>
                  {stateLabel(s)}
                </option>
              ))}
            </TextField>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Button
                variant={includePrimaryOrg ? "contained" : "outlined"}
                size="small"
                disabled={!primaryOrgId}
                onClick={() => setIncludePrimaryOrg((v) => !v)}
              >
                {includePrimaryOrg ? "Include primary org: yes" : "Include primary org: no"}
              </Button>
              {primaryOrgId ? (
                <Typography variant="caption" color="text.secondary">
                  Org participant: {primaryOrg?.org_name || primaryOrg?.ens_name}
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  (No org id available; will create initiative without org participant)
                </Typography>
              )}
            </Box>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                disabled={submitting || !individualId || !title.trim()}
                onClick={async () => {
                  try {
                    setSubmitting(true);
                    setErr(null);
                    if (!individualId) throw new Error("Complete onboarding first (missing individual profile).");
                    const init = await createInitiative({
                      title: title.trim(),
                      summary: summary.trim() || null,
                      state,
                      created_by_individual_id: individualId,
                      created_by_org_id: includePrimaryOrg ? primaryOrgId : null,
                      initial_participants:
                        includePrimaryOrg && primaryOrgId
                          ? [
                              {
                                participant_kind: "organization",
                                organization_id: primaryOrgId,
                                role: "org_admin",
                                status: "active",
                              },
                            ]
                          : undefined,
                      metadata_json: {
                        createdVia: "ui",
                      },
                    });
                    router.push(`/app?view=initiative-dashboard&initiativeId=${encodeURIComponent(String(init.id))}`);
                  } catch (e: any) {
                    setErr(e?.message || String(e));
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {submitting ? "Creating…" : "Create"}
              </Button>
              <Button component={Link} href="/app?view=active-initiatives" variant="outlined">
                View active initiatives
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  function InitiativeDashboardView(props: { initiativeId: number | null }) {
    const { initiativeId } = props;
    const [data, setData] = React.useState<InitiativeDashboardResponse | null>(null);
    const [loadingData, setLoadingData] = React.useState(false);
    const [err, setErr] = React.useState<string | null>(null);

    const refreshKeyRef = React.useRef<string | null>(null);
    React.useEffect(() => {
      if (!initiativeId) return;
      const key = String(initiativeId);
      if (refreshKeyRef.current === key) return;
      refreshKeyRef.current = key;

      let cancelled = false;
      setLoadingData(true);
      setErr(null);
      (async () => {
        try {
          const d = await getInitiativeDashboard(initiativeId);
          if (!cancelled) setData(d);
        } catch (e: any) {
          if (!cancelled) setErr(e?.message || String(e));
        } finally {
          if (!cancelled) setLoadingData(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [initiativeId]);

    const initiative = data?.initiative ?? null;
    const opportunities = (data?.opportunities ?? []) as OpportunityRow[];
    const engagements = (data?.engagements ?? []) as EngagementRow[];
    const milestones = (data?.milestones ?? []) as MilestoneRow[];
    const attestations = (data?.attestations ?? []) as AttestationRow[];

    const [stateDraft, setStateDraft] = React.useState<InitiativeState>("draft");
    React.useEffect(() => {
      if (initiative?.state) setStateDraft(initiative.state);
    }, [initiative?.state]);

    // Create opportunity form
    const [oppTitle, setOppTitle] = React.useState("");
    const [oppDesc, setOppDesc] = React.useState("");
    const [oppStatus, setOppStatus] = React.useState("open");
    const [oppSubmitting, setOppSubmitting] = React.useState(false);

    // Create engagement form
    const openOpps = opportunities.filter((o) => o.status === "open" || o.status === "draft");
    const [engOppId, setEngOppId] = React.useState<number | "">("");
    const [engContributorEoa, setEngContributorEoa] = React.useState("");
    const [engStatus, setEngStatus] = React.useState("proposed");
    const [engSubmitting, setEngSubmitting] = React.useState(false);

    // Create milestone form
    const [msEngId, setMsEngId] = React.useState<number | "">("");
    const [msTitle, setMsTitle] = React.useState("");
    const [msDue, setMsDue] = React.useState(""); // yyyy-mm-dd
    const [msSubmitting, setMsSubmitting] = React.useState(false);

    if (!initiativeId) {
      return (
        <Placeholder
          title="Initiative Dashboard"
          note="Select an initiative from My Initiatives or Active Initiatives."
          links={[
            { label: "My Initiatives", href: "/app?view=my-initiatives" },
            { label: "Active Initiatives", href: "/app?view=active-initiatives" },
            { label: "Create Initiative", href: "/app?view=create-initiative" },
          ]}
        />
      );
    }

    return (
      <Stack spacing={2}>
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack spacing={1.25}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between">
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 900, letterSpacing: -0.2 }}>
                    {initiative?.title || `Initiative #${initiativeId}`}
                  </Typography>
                  {initiative?.summary ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {initiative.summary}
                    </Typography>
                  ) : null}
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={`#${initiativeId}`} variant="outlined" />
                    {initiative?.state ? <Chip size="small" label={stateLabel(initiative.state)} color="primary" /> : null}
                    {data?.counts ? (
                      <Chip size="small" variant="outlined" label={`${data.counts.openOpportunities || 0} open opps`} />
                    ) : null}
                    {data?.counts ? (
                      <Chip size="small" variant="outlined" label={`${data.counts.activeEngagements || 0} active engagements`} />
                    ) : null}
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button component={Link} href="/app?view=active-initiatives" variant="outlined" size="small">
                    Active initiatives
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={async () => {
                      if (!initiativeId) return;
                      try {
                        setLoadingData(true);
                        setErr(null);
                        const d = await getInitiativeDashboard(initiativeId);
                        setData(d);
                      } catch (e: any) {
                        setErr(e?.message || String(e));
                      } finally {
                        setLoadingData(false);
                      }
                    }}
                  >
                    Refresh
                  </Button>
                </Stack>
              </Stack>

              {err ? <Alert severity="error">{err}</Alert> : null}
              {loadingData ? (
                <Box sx={{ py: 1.5, display: "flex", justifyContent: "center" }}>
                  <CircularProgress size={22} />
                </Box>
              ) : null}

              <Divider />

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
                <TextField
                  label="Lifecycle state"
                  select
                  value={stateDraft}
                  onChange={(e) => setStateDraft(e.target.value as InitiativeState)}
                  SelectProps={{ native: true }}
                  size="small"
                  sx={{ width: { xs: "100%", md: 240 } }}
                >
                  {(["draft", "chartered", "funded", "executing", "evaluating", "closed"] as InitiativeState[]).map((s) => (
                    <option key={s} value={s}>
                      {stateLabel(s)}
                    </option>
                  ))}
                </TextField>
                <Button
                  variant="contained"
                  size="small"
                  disabled={!initiative}
                  onClick={async () => {
                    if (!initiative) return;
                    try {
                      setLoadingData(true);
                      setErr(null);
                      const updated = await updateInitiative(initiative.id, {
                        state: stateDraft,
                        actor_individual_id: individualId,
                      } as any);
                      const d = await getInitiativeDashboard(updated.id);
                      setData(d);
                    } catch (e: any) {
                      setErr(e?.message || String(e));
                    } finally {
                      setLoadingData(false);
                    }
                  }}
                >
                  Save state
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* Participants */}
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack spacing={1.25}>
              <Typography sx={{ fontWeight: 800 }}>Participants</Typography>
              <Typography variant="body2" color="text.secondary">
                Coalition membership and governance roles for this initiative.
              </Typography>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
                <TextField
                  label="Add my primary organization"
                  select
                  size="small"
                  value={String(primaryOrg?.id ?? "")}
                  SelectProps={{ native: true }}
                  sx={{ width: { xs: "100%", md: 360 } }}
                  disabled
                >
                  <option value={String(primaryOrg?.id ?? "")}>
                    {primaryOrg?.org_name || primaryOrg?.ens_name || "No primary org"}
                  </option>
                </TextField>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={!initiative || typeof primaryOrg?.id !== "number" || !individualId}
                  onClick={async () => {
                    if (!initiative || typeof primaryOrg?.id !== "number" || !individualId) return;
                    try {
                      setLoadingData(true);
                      await updateParticipants(initiative.id, {
                        action: "add",
                        participant_kind: "organization",
                        organization_id: primaryOrg.id,
                        role: "org_admin",
                        status: "active",
                        actor_individual_id: individualId,
                      });
                      const d = await getInitiativeDashboard(initiative.id);
                      setData(d);
                    } catch (e: any) {
                      setErr(e?.message || String(e));
                    } finally {
                      setLoadingData(false);
                    }
                  }}
                >
                  Add org participant
                </Button>
              </Stack>

              <Divider />
              <Stack spacing={0.75}>
                {(data?.participants ?? []).length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No participants yet.
                  </Typography>
                ) : (
                  (data?.participants ?? []).map((p: any) => (
                    <Box key={p.id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {p.participant_kind === "organization"
                            ? p.org_name || p.org_ens_name || `Org #${p.organization_id}`
                            : `${p.individual_first_name || ""} ${p.individual_last_name || ""}`.trim() ||
                              p.individual_email ||
                              p.individual_eoa ||
                              `Individual #${p.individual_id}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {p.role} • {p.status}
                        </Typography>
                      </Box>
                      <Chip size="small" variant="outlined" label={p.participant_kind} />
                    </Box>
                  ))
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* Opportunities + Engagements + Milestones */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Card variant="outlined" sx={{ borderRadius: 3, height: "100%" }}>
              <CardContent>
                <Stack spacing={1.25}>
                  <Typography sx={{ fontWeight: 800 }}>Opportunities</Typography>
                  <Stack spacing={1}>
                    <TextField label="Title" size="small" value={oppTitle} onChange={(e) => setOppTitle(e.target.value)} />
                    <TextField label="Description" size="small" value={oppDesc} onChange={(e) => setOppDesc(e.target.value)} multiline minRows={3} />
                    <TextField
                      label="Status"
                      size="small"
                      select
                      value={oppStatus}
                      onChange={(e) => setOppStatus(e.target.value)}
                      SelectProps={{ native: true }}
                    >
                      <option value="draft">Draft</option>
                      <option value="open">Open</option>
                    </TextField>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!initiative || oppSubmitting || !oppTitle.trim() || !individualId}
                      onClick={async () => {
                        if (!initiative || !individualId) return;
                        try {
                          setOppSubmitting(true);
                          setErr(null);
                          await createOpportunity(initiative.id, {
                            title: oppTitle.trim(),
                            description: oppDesc.trim() || null,
                            status: oppStatus,
                            created_by_org_id: typeof primaryOrg?.id === "number" ? primaryOrg.id : null,
                            actor_individual_id: individualId,
                          });
                          setOppTitle("");
                          setOppDesc("");
                          const d = await getInitiativeDashboard(initiative.id);
                          setData(d);
                        } catch (e: any) {
                          setErr(e?.message || String(e));
                        } finally {
                          setOppSubmitting(false);
                        }
                      }}
                    >
                      {oppSubmitting ? "Saving…" : "Create opportunity"}
                    </Button>
                  </Stack>
                  <Divider />
                  <Stack spacing={0.75}>
                    {opportunities.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No opportunities yet.
                      </Typography>
                    ) : (
                      opportunities.map((o) => (
                        <Box key={o.id} sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {o.title}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {o.status} • updated {formatWhen(o.updated_at)}
                            </Typography>
                          </Box>
                          <Chip size="small" variant="outlined" label={`#${o.id}`} />
                        </Box>
                      ))
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card variant="outlined" sx={{ borderRadius: 3, height: "100%" }}>
              <CardContent>
                <Stack spacing={1.25}>
                  <Typography sx={{ fontWeight: 800 }}>Engagements</Typography>
                  <Stack spacing={1}>
                    <TextField
                      label="From opportunity"
                      select
                      size="small"
                      value={engOppId === "" ? "" : String(engOppId)}
                      onChange={(e) => setEngOppId(e.target.value ? Number(e.target.value) : "")}
                      SelectProps={{ native: true }}
                    >
                      <option value="">Select an opportunity…</option>
                      {openOpps.map((o) => (
                        <option key={o.id} value={o.id}>
                          #{o.id} — {o.title}
                        </option>
                      ))}
                    </TextField>
                    <TextField
                      label="Contributor EOA (optional)"
                      size="small"
                      value={engContributorEoa}
                      onChange={(e) => setEngContributorEoa(e.target.value)}
                      placeholder="0x…"
                    />
                    <TextField
                      label="Status"
                      select
                      size="small"
                      value={engStatus}
                      onChange={(e) => setEngStatus(e.target.value)}
                      SelectProps={{ native: true }}
                    >
                      <option value="proposed">Proposed</option>
                      <option value="active">Active</option>
                    </TextField>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!initiative || engSubmitting || engOppId === "" || !individualId}
                      onClick={async () => {
                        if (!initiative || engOppId === "" || !individualId) return;
                        try {
                          setEngSubmitting(true);
                          setErr(null);
                          await createEngagementFromOpportunity(engOppId, {
                            initiative_id: initiative.id,
                            requesting_organization_id: typeof primaryOrg?.id === "number" ? primaryOrg.id : null,
                            contributor_individual_id: null,
                            status: engStatus,
                            actor_individual_id: individualId,
                            terms_json: {
                              note: "Created in UI prototype",
                            },
                          });
                          setEngOppId("");
                          setEngContributorEoa("");
                          setEngStatus("proposed");
                          const d = await getInitiativeDashboard(initiative.id);
                          setData(d);
                        } catch (e: any) {
                          setErr(e?.message || String(e));
                        } finally {
                          setEngSubmitting(false);
                        }
                      }}
                    >
                      {engSubmitting ? "Saving…" : "Create engagement"}
                    </Button>
                  </Stack>
                  <Divider />
                  <Stack spacing={0.75}>
                    {engagements.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No engagements yet.
                      </Typography>
                    ) : (
                      engagements.map((e) => (
                        <Box key={e.id} sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              #{e.id} — {e.opportunity_title || `Opportunity #${e.opportunity_id}`}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {e.status}
                              {e.contributor_first_name || e.contributor_last_name
                                ? ` • ${`${e.contributor_first_name || ""} ${e.contributor_last_name || ""}`.trim()}`
                                : e.contributor_eoa
                                  ? ` • ${e.contributor_eoa}`
                                  : ""}
                            </Typography>
                          </Box>
                          <Chip size="small" variant="outlined" label={`opp #${e.opportunity_id}`} />
                        </Box>
                      ))
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent>
                <Stack spacing={1.25}>
                  <Typography sx={{ fontWeight: 800 }}>Milestones</Typography>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                    <TextField
                      label="Engagement"
                      select
                      size="small"
                      value={msEngId === "" ? "" : String(msEngId)}
                      onChange={(e) => setMsEngId(e.target.value ? Number(e.target.value) : "")}
                      SelectProps={{ native: true }}
                      sx={{ width: { xs: "100%", md: 360 } }}
                    >
                      <option value="">Select engagement…</option>
                      {engagements.map((e) => (
                        <option key={e.id} value={e.id}>
                          #{e.id} — {e.opportunity_title || `Opportunity #${e.opportunity_id}`}
                        </option>
                      ))}
                    </TextField>
                    <TextField label="Title" size="small" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} sx={{ flex: 1 }} />
                    <TextField
                      label="Due date"
                      size="small"
                      type="date"
                      value={msDue}
                      onChange={(e) => setMsDue(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      sx={{ width: { xs: "100%", md: 200 } }}
                    />
                    <Button
                      variant="contained"
                      size="small"
                      disabled={msSubmitting || msEngId === "" || !msTitle.trim() || !individualId}
                      onClick={async () => {
                        if (msEngId === "" || !individualId) return;
                        try {
                          setMsSubmitting(true);
                          setErr(null);
                          const due = msDue ? Math.floor(new Date(msDue).getTime() / 1000) : null;
                          await createMilestone(msEngId, {
                            title: msTitle.trim(),
                            due_at: due,
                            actor_individual_id: individualId,
                          });
                          setMsEngId("");
                          setMsTitle("");
                          setMsDue("");
                          if (initiative) {
                            const d = await getInitiativeDashboard(initiative.id);
                            setData(d);
                          }
                        } catch (e: any) {
                          setErr(e?.message || String(e));
                        } finally {
                          setMsSubmitting(false);
                        }
                      }}
                    >
                      {msSubmitting ? "Saving…" : "Add milestone"}
                    </Button>
                  </Stack>

                  <Divider />
                  <Stack spacing={0.75}>
                    {milestones.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No milestones yet.
                      </Typography>
                    ) : (
                      milestones.map((m) => (
                        <Box key={m.id} sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {m.title}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {m.status}
                              {m.due_at ? ` • due ${formatWhen(m.due_at)}` : ""}
                              {m.engagement_id ? ` • engagement #${m.engagement_id}` : ""}
                            </Typography>
                          </Box>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {(m.status === "pending" || m.status === "submitted") && individualId ? (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={async () => {
                                  if (!initiative) return;
                                  try {
                                    setErr(null);
                                    await updateMilestone(m.id, {
                                      status: m.status === "pending" ? "submitted" : "verified",
                                      actor_individual_id: individualId,
                                    });
                                    const d = await getInitiativeDashboard(initiative.id);
                                    setData(d);
                                  } catch (e: any) {
                                    setErr(e?.message || String(e));
                                  }
                                }}
                              >
                                {m.status === "pending" ? "Submit" : "Verify"}
                              </Button>
                            ) : null}
                            <Chip size="small" variant="outlined" label={`#${m.id}`} />
                          </Stack>
                        </Box>
                      ))
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Trust trail (off-chain attestations) */}
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack spacing={1.25}>
              <Typography sx={{ fontWeight: 800 }}>Initiative audit trail</Typography>
              <Typography variant="body2" color="text.secondary">
                Off-chain attestations emitted during lifecycle events (ready to map to EAS later).
              </Typography>
              <Divider />
              {attestations.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No events yet.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {attestations.slice(0, 25).map((a) => (
                    <Box key={a.id} sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {a.attestation_type}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatWhen(a.created_at)} {a.actor_individual_id ? `• individual ${a.actor_individual_id}` : ""}
                        </Typography>
                        {a.payload_json ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                            {truncateJson(a.payload_json)}
                          </Typography>
                        ) : null}
                      </Box>
                      <Chip size="small" variant="outlined" label={`#${a.id}`} />
                    </Box>
                  ))}
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  return (
    <main>
      <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
              {role ? getRoleTitle(role) : "Workspace"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Prototype-aligned workspace (views filtered by role).
            </Typography>
          </Box>

          {error ? <Alert severity="error">{error}</Alert> : null}

          {!user ? (
            <Placeholder title="Not connected" links={[{ label: "Onboarding", href: "/onboarding" }]} />
          ) : !walletAddress ? (
            <Placeholder title="Loading…" note="Waiting for wallet…" />
          ) : profileLoading || !hasHydrated ? (
            <Placeholder title="Loading…" note="Loading your profile…" />
          ) : !profile ? (
            <Placeholder
              title="No profile found"
              note="Complete onboarding to create your participant agent and role profile."
              links={[{ label: "Onboarding", href: "/onboarding" }]}
            />
          ) : loading ? (
            <Placeholder title="Loading…" note="Fetching your organizations…" />
          ) : (
            <>
              {renderInitiativesHeaderCard}

              {view === "coordination-hub" ? (
                <Placeholder
                  title="Coordination Hub"
                  note="Wire up needs → search agents → match contributors. (Mocked; links go to existing pages.)"
                  links={[
                    { label: "Organizations (agents)", href: "/agents" },
                    { label: "Dashboard (agent tools)", href: "/dashboard" },
                  ]}
                />
              ) : view === "opportunities" ? (
                <Placeholder title="Opportunities" note="Skill-matched listings (mocked)." links={[{ label: "Organizations", href: "/agents" }]} />
              ) : view === "trust-trail" ? (
                <Placeholder title="Trust Trail" note="On-chain attestations timeline (mocked)." links={[{ label: "Dashboard", href: "/dashboard" }]} />
              ) : view === "portfolio-overview" ? (
                <Placeholder title="Portfolio Overview" note="Grant portfolio summary (mocked)." />
              ) : view === "outcome-verification" ? (
                <Placeholder title="Outcome Verification" note="Verify outcomes backed by EAS (mocked)." />
              ) : view === "compliance" ? (
                <Placeholder title="Compliance" note="Compliance rules + reports (mocked)." />
              ) : view === "analytics" ? (
                <Placeholder title="Analytics" note="Cross-ecosystem metrics (mocked)." />
              ) : view === "initiative-dashboard" ? (
                <InitiativeDashboardView initiativeId={initiativeId} />
              ) : view === "active-initiatives" ? (
                <InitiativesList title="Active Initiatives" scope="active" />
              ) : view === "create-initiative" ? (
                <CreateInitiativeView />
              ) : view === "my-initiatives" ? (
                <InitiativesList title="My Initiatives" scope="mine" />
              ) : view === "initiative-matching" ? (
                <Placeholder title="Smart Matching" note="Match needs ↔ contributors (mocked)." />
              ) : view === "wallet" ? (
                <Placeholder title="Wallet" note="Wallet + session key UI (mocked)." links={[{ label: "Profile", href: "/profile" }]} />
              ) : (
                <Placeholder title="Coming soon" note={`View: ${view}`} />
              )}
            </>
          )}
        </Stack>
      </Box>
    </main>
  );
}


