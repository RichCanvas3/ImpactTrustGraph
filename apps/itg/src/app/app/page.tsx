"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Box, Button, Card, CardContent, Grid, Stack, Typography } from "@mui/material";
import { useSearchParams } from "next/navigation";
import { useConnection } from "../../components/connection-context";
import { useCurrentUserProfile } from "../../components/useCurrentUserProfile";
import { getRoleTitle } from "../../components/appNav";
import type { AppViewId } from "../../components/AppShell";
import { getUserOrganizationsByEoa, type OrganizationAssociation } from "../service/userProfileService";

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

export default function ApplicationEnvironmentPage() {
  const { user } = useConnection();
  const searchParams = useSearchParams();
  const view = (searchParams?.get("view") ?? "trust-trail") as ViewId;

  const [orgs, setOrgs] = React.useState<OrganizationAssociation[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { walletAddress, profile, role } = useCurrentUserProfile();

  // Fetch organizations by EOA (profile is already hydrated in context).
  const hydratedEoaRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!user) {
      setOrgs(null);
      setLoading(false);
      return;
    }
    if (!walletAddress) return;
    const eoa = walletAddress.toLowerCase();
    if (hydratedEoaRef.current === eoa) return;
    hydratedEoaRef.current = eoa;

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const orgList = await getUserOrganizationsByEoa(eoa);
        if (!cancelled) setOrgs(orgList);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, walletAddress]);

  const primaryOrg = React.useMemo(() => {
    const list = Array.isArray(orgs) ? orgs : [];
    return list.find((o) => o.is_primary) ?? list[0] ?? null;
  }, [orgs]);

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

          {loading ? (
            <Placeholder title="Loading…" note="Fetching your organizations by EOA." />
          ) : !user ? (
            <Placeholder title="Not connected" links={[{ label: "Onboarding", href: "/onboarding" }]} />
          ) : !profile ? (
            <Placeholder
              title="No profile found"
              note="Complete onboarding to create your participant agent and role profile."
              links={[{ label: "Onboarding", href: "/onboarding" }]}
            />
          ) : (
            <>
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography sx={{ fontWeight: 800, mb: 0.5 }}>You</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {profile.first_name || profile.last_name
                          ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim()
                          : profile.social_display_name || "Participant"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Role: <strong>{profile.role ?? role ?? "unknown"}</strong>
                      </Typography>
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
                <Placeholder title="Initiative Dashboard" note="Initiative overview (mocked)." />
              ) : view === "active-initiatives" ? (
                <Placeholder title="Active Initiatives" note="Initiatives list (mocked)." />
              ) : view === "create-initiative" ? (
                <Placeholder title="Create Initiative" note="Create + configure an initiative (mocked)." />
              ) : view === "my-initiatives" ? (
                <Placeholder title="My Initiatives" note="Assigned initiatives (mocked)." />
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


