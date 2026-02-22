"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useConnection } from "../../../components/connection-context";
import { useCurrentUserProfile } from "../../../components/useCurrentUserProfile";

type ClassificationRow = { id: number; key: string; label: string; description?: string | null; sort_order?: number };
type TypeRow = {
  id: number;
  classification_id: number;
  key: string;
  label: string;
  description?: string | null;
  value_kind: string;
  unit?: string | null;
  sort_order?: number;
};
type RoleRow = { capability_type_id: number; role: string };
type OptionRow = { capability_type_id: number; key: string; label: string; sort_order?: number };
type RegionRow = { id: number; key: string; name: string; kind: string; parent_region_id?: number | null };

export default function AdminCapabilitiesPage() {
  const { user } = useConnection();
  const { role } = useCurrentUserProfile();
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [classifications, setClassifications] = React.useState<ClassificationRow[]>([]);
  const [types, setTypes] = React.useState<TypeRow[]>([]);
  const [typeRoles, setTypeRoles] = React.useState<RoleRow[]>([]);
  const [typeOptions, setTypeOptions] = React.useState<OptionRow[]>([]);
  const [regions, setRegions] = React.useState<RegionRow[]>([]);

  const [newClassKey, setNewClassKey] = React.useState("");
  const [newClassLabel, setNewClassLabel] = React.useState("");

  const [newTypeKey, setNewTypeKey] = React.useState("");
  const [newTypeLabel, setNewTypeLabel] = React.useState("");
  const [newTypeKind, setNewTypeKind] = React.useState("multi_enum");
  const [newTypeClassKey, setNewTypeClassKey] = React.useState("identity");
  const [newTypeRolesCsv, setNewTypeRolesCsv] = React.useState("coordinator,contributor");

  const [newRegionKey, setNewRegionKey] = React.useState("");
  const [newRegionName, setNewRegionName] = React.useState("");
  const [newRegionKind, setNewRegionKind] = React.useState("custom");
  const [newRegionParentKey, setNewRegionParentKey] = React.useState("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/capabilities/admin");
      const json = await res.json().catch(() => null as any);
      if (!res.ok) throw new Error(json?.message || json?.error || `Failed to load (${res.status})`);
      setClassifications(Array.isArray(json?.classifications) ? json.classifications : []);
      setTypes(Array.isArray(json?.types) ? json.types : []);
      setTypeRoles(Array.isArray(json?.type_roles) ? json.type_roles : []);
      setTypeOptions(Array.isArray(json?.type_options) ? json.type_options : []);
      setRegions(Array.isArray(json?.regions) ? json.regions : []);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = React.useCallback(async (payload: any) => {
    const res = await fetch("/api/capabilities/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null as any);
    if (!res.ok || !json || json.success !== true) {
      throw new Error(json?.message || json?.error || `Failed (${res.status})`);
    }
  }, []);

  if (!user) {
    return (
      <main>
        <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
          <Alert severity="warning">
            Not connected. Go to <Link href="/onboarding">onboarding</Link>.
          </Alert>
        </Box>
      </main>
    );
  }

  if (role !== "admin") {
    return (
      <main>
        <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
          <Alert severity="error">Admin only.</Alert>
        </Box>
      </main>
    );
  }

  return (
    <main>
      <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
        <Stack spacing={2.5}>
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
                    Capabilities Admin
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Manage capability classifications, types, options, and regions.
                  </Typography>
                </Box>
                <Button component={Link} href="/app" variant="outlined">
                  Workspace
                </Button>
                <Button variant="contained" onClick={() => void refresh()} disabled={loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </Button>
              </Stack>
              {err ? <Alert severity="error" sx={{ mt: 1 }}>{err}</Alert> : null}
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>Add classification</Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField label="key" value={newClassKey} onChange={(e) => setNewClassKey(e.target.value)} fullWidth />
                <TextField label="label" value={newClassLabel} onChange={(e) => setNewClassLabel(e.target.value)} fullWidth />
                <Button
                  variant="contained"
                  onClick={async () => {
                    try {
                      setErr(null);
                      await post({ action: "upsertClassification", key: newClassKey, label: newClassLabel, sort_order: 50 });
                      setNewClassKey("");
                      setNewClassLabel("");
                      await refresh();
                    } catch (e: any) {
                      setErr(e?.message || String(e));
                    }
                  }}
                >
                  Add
                </Button>
              </Stack>
            </CardContent>
            <Divider />
            <CardContent>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>Classifications</Typography>
              <pre style={{ margin: 0, fontSize: 12, overflowX: "auto" }}>{JSON.stringify(classifications, null, 2)}</pre>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>Add / update type</Typography>
              <Stack spacing={1}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                  <TextField label="classification_key" value={newTypeClassKey} onChange={(e) => setNewTypeClassKey(e.target.value)} fullWidth />
                  <TextField label="key" value={newTypeKey} onChange={(e) => setNewTypeKey(e.target.value)} fullWidth />
                  <TextField label="label" value={newTypeLabel} onChange={(e) => setNewTypeLabel(e.target.value)} fullWidth />
                </Stack>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                  <TextField
                    label="value_kind"
                    value={newTypeKind}
                    onChange={(e) => setNewTypeKind(e.target.value)}
                    fullWidth
                    helperText="text | number | enum | multi_enum | location"
                  />
                  <TextField
                    label="roles (csv)"
                    value={newTypeRolesCsv}
                    onChange={(e) => setNewTypeRolesCsv(e.target.value)}
                    fullWidth
                    helperText="admin,coordinator,org_admin,contributor,funder"
                  />
                  <Button
                    variant="contained"
                    onClick={async () => {
                      try {
                        setErr(null);
                        const roles = newTypeRolesCsv
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                        await post({
                          action: "upsertType",
                          classification_key: newTypeClassKey,
                          key: newTypeKey,
                          label: newTypeLabel,
                          value_kind: newTypeKind,
                          roles,
                          sort_order: 50,
                        });
                        setNewTypeKey("");
                        setNewTypeLabel("");
                        await refresh();
                      } catch (e: any) {
                        setErr(e?.message || String(e));
                      }
                    }}
                  >
                    Save
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
            <Divider />
            <CardContent>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>Types / roles / options</Typography>
              <pre style={{ margin: 0, fontSize: 12, overflowX: "auto" }}>
                {JSON.stringify({ types, typeRoles, typeOptions }, null, 2)}
              </pre>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>Add / update region</Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                <TextField label="key" value={newRegionKey} onChange={(e) => setNewRegionKey(e.target.value)} fullWidth />
                <TextField label="name" value={newRegionName} onChange={(e) => setNewRegionName(e.target.value)} fullWidth />
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mt: 1 }}>
                <TextField label="kind" value={newRegionKind} onChange={(e) => setNewRegionKind(e.target.value)} fullWidth />
                <TextField
                  label="parent_key"
                  value={newRegionParentKey}
                  onChange={(e) => setNewRegionParentKey(e.target.value)}
                  fullWidth
                  placeholder="e.g. us"
                />
                <Button
                  variant="contained"
                  onClick={async () => {
                    try {
                      setErr(null);
                      await post({
                        action: "upsertRegion",
                        key: newRegionKey,
                        name: newRegionName,
                        kind: newRegionKind,
                        parent_key: newRegionParentKey || null,
                      });
                      setNewRegionKey("");
                      setNewRegionName("");
                      setNewRegionParentKey("");
                      await refresh();
                    } catch (e: any) {
                      setErr(e?.message || String(e));
                    }
                  }}
                >
                  Save
                </Button>
              </Stack>
            </CardContent>
            <Divider />
            <CardContent>
              <Typography sx={{ fontWeight: 800, mb: 1 }}>Regions</Typography>
              <pre style={{ margin: 0, fontSize: 12, overflowX: "auto" }}>{JSON.stringify(regions, null, 2)}</pre>
            </CardContent>
          </Card>
        </Stack>
      </Box>
    </main>
  );
}

