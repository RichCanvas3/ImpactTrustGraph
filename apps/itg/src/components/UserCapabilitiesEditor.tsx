"use client";

import * as React from "react";
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, FormGroup, Stack, TextField, Typography } from "@mui/material";
import type { AppRole } from "./AppShell";

type CatalogOption = { key: string; label: string };
type CatalogType = {
  id: number;
  key: string;
  label: string;
  description: string | null;
  value_kind: "text" | "number" | "enum" | "multi_enum" | "location" | string;
  unit: string | null;
  options: CatalogOption[];
};
type CatalogClassification = { id: number; key: string; label: string; description: string | null; types: CatalogType[] };

type CapabilityValue = {
  type_key: string;
  value_kind: string;
  value_text?: string | null;
  value_number?: number | null;
  value_json?: any | null;
  location?: any | null;
};

function normalizeRole(raw: unknown): AppRole {
  const r = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (r === "admin") return "admin";
  if (r === "coordinator" || r === "coalition") return "coordinator";
  if (r === "org_admin" || r === "org-admin" || r === "org") return "org_admin";
  if (r === "contributor") return "contributor";
  if (r === "funder") return "funder";
  return "org_admin";
}

export function UserCapabilitiesEditor(props: { individualId: number | null; role: AppRole | null }) {
  const { individualId, role } = props;
  const effectiveRole = normalizeRole(role);

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [catalog, setCatalog] = React.useState<CatalogClassification[]>([]);
  const [values, setValues] = React.useState<Record<string, CapabilityValue>>({});

  const [locationRegionKey, setLocationRegionKey] = React.useState<string>("");
  const [locationCity, setLocationCity] = React.useState<string>("");
  const [locationState, setLocationState] = React.useState<string>("");
  const [locationCountry, setLocationCountry] = React.useState<string>("US");

  const load = React.useCallback(async () => {
    if (!individualId) return;
    setLoading(true);
    setErr(null);
    try {
      const catRes = await fetch(`/api/capabilities/catalog?role=${encodeURIComponent(effectiveRole)}`);
      const catJson = await catRes.json().catch(() => null as any);
      if (!catRes.ok) throw new Error(catJson?.message || catJson?.error || `Failed to load catalog (${catRes.status})`);
      setCatalog(Array.isArray(catJson?.classifications) ? (catJson.classifications as CatalogClassification[]) : []);

      const valRes = await fetch(`/api/users/capabilities?individualId=${encodeURIComponent(String(individualId))}`);
      const valJson = await valRes.json().catch(() => null as any);
      if (!valRes.ok) throw new Error(valJson?.message || valJson?.error || `Failed to load capabilities (${valRes.status})`);
      const caps = (valJson?.capabilities ?? {}) as Record<string, CapabilityValue>;
      setValues(caps);

      const loc = caps?.home_location?.location ?? null;
      if (loc) {
        setLocationRegionKey(typeof loc?.region?.key === "string" ? loc.region.key : "");
        setLocationCity(typeof loc?.city === "string" ? loc.city : "");
        setLocationState(typeof loc?.state === "string" ? loc.state : "");
        setLocationCountry(typeof loc?.country === "string" ? loc.country : "US");
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [individualId, effectiveRole]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const updateLocal = React.useCallback((type_key: string, patch: Partial<CapabilityValue>) => {
    setValues((prev) => ({
      ...prev,
      [type_key]: {
        ...(function () {
          const existing = prev?.[type_key] ?? null;
          if (!existing) return {};
          // Avoid spreading type_key twice (TS duplicate key error).
          const { type_key: _tk, ...rest } = existing as any;
          return rest;
        })(),
        ...patch,
        type_key,
        value_kind: (patch.value_kind ?? prev?.[type_key]?.value_kind ?? "") as any,
      },
    }));
  }, []);

  const save = React.useCallback(async () => {
    if (!individualId) return;
    setSaving(true);
    setErr(null);
    try {
      // Convert local state into API updates.
      const updates: any[] = [];
      for (const c of catalog) {
        for (const t of c.types) {
          const v = values?.[t.key] ?? null;
          if (t.value_kind === "location") {
            if (t.key === "home_location") {
              updates.push({
                type_key: t.key,
                location: {
                  label: "Home",
                  city: locationCity || null,
                  state: locationState || null,
                  country: locationCountry || null,
                  region_key: locationRegionKey || null,
                },
              });
            }
            continue;
          }
          if (t.value_kind === "number") {
            updates.push({ type_key: t.key, value_number: typeof v?.value_number === "number" ? v.value_number : null });
          } else if (t.value_kind === "text") {
            updates.push({ type_key: t.key, value_text: typeof v?.value_text === "string" ? v.value_text : "" });
          } else if (t.value_kind === "enum") {
            updates.push({ type_key: t.key, value: typeof v?.value_json === "string" ? v.value_json : typeof v?.value_text === "string" ? v.value_text : "" });
          } else if (t.value_kind === "multi_enum") {
            updates.push({ type_key: t.key, value: Array.isArray(v?.value_json) ? v.value_json : [] });
          }
        }
      }

      const res = await fetch("/api/users/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ individual_id: individualId, updates }),
      });
      const json = await res.json().catch(() => null as any);
      if (!res.ok || !json || json.success !== true) {
        throw new Error(json?.message || json?.error || `Failed to save (${res.status})`);
      }
      await load();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [individualId, catalog, values, load, locationCity, locationState, locationCountry, locationRegionKey]);

  if (!individualId) {
    return <Alert severity="info">Complete onboarding first (missing individual profile).</Alert>;
  }

  return (
    <Stack spacing={2}>
      {err ? <Alert severity="error">{err}</Alert> : null}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        <Typography sx={{ fontWeight: 800, flex: 1 }}>Capabilities</Typography>
        <Button variant="outlined" onClick={() => void load()} disabled={loading || saving}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={loading || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Stack>

      {catalog.length === 0 ? <Alert severity="warning">No capability catalog found for role: {effectiveRole}</Alert> : null}

      {catalog.map((cls) => (
        <Card key={cls.key} variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Typography sx={{ fontWeight: 800 }}>{cls.label}</Typography>
            {cls.description ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {cls.description}
              </Typography>
            ) : (
              <Box sx={{ height: 8 }} />
            )}

            <Stack spacing={1.5}>
              {cls.types.map((t) => {
                const v = values?.[t.key] ?? ({ type_key: t.key, value_kind: t.value_kind } as CapabilityValue);

                if (t.value_kind === "number") {
                  return (
                    <TextField
                      key={t.key}
                      label={t.unit ? `${t.label} (${t.unit})` : t.label}
                      type="number"
                      value={typeof v.value_number === "number" ? String(v.value_number) : ""}
                      onChange={(e) => {
                        const n = e.target.value === "" ? null : Number(e.target.value);
                        updateLocal(t.key, { value_kind: t.value_kind, value_number: Number.isFinite(n as any) ? (n as any) : null });
                      }}
                      fullWidth
                      InputLabelProps={{ shrink: true }}
                    />
                  );
                }

                if (t.value_kind === "text") {
                  return (
                    <TextField
                      key={t.key}
                      label={t.label}
                      value={typeof v.value_text === "string" ? v.value_text : ""}
                      onChange={(e) => updateLocal(t.key, { value_kind: t.value_kind, value_text: e.target.value })}
                      fullWidth
                    />
                  );
                }

                if (t.value_kind === "enum") {
                  const current = typeof v.value_json === "string" ? v.value_json : typeof v.value_text === "string" ? v.value_text : "";
                  return (
                    <TextField
                      key={t.key}
                      label={t.label}
                      select
                      value={current}
                      onChange={(e) => updateLocal(t.key, { value_kind: t.value_kind, value_json: String(e.target.value) })}
                      SelectProps={{ native: true }}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                    >
                      <option value="">Select…</option>
                      {t.options.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </TextField>
                  );
                }

                if (t.value_kind === "multi_enum") {
                  const selected = new Set<string>(Array.isArray(v.value_json) ? v.value_json.map(String) : []);
                  return (
                    <Card key={t.key} variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{t.label}</Typography>
                        {t.description ? (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {t.description}
                          </Typography>
                        ) : null}
                        <FormGroup>
                          {t.options.map((o) => {
                            const checked = selected.has(o.key);
                            return (
                              <FormControlLabel
                                key={o.key}
                                control={
                                  <Checkbox
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = new Set(selected);
                                      if (e.target.checked) next.add(o.key);
                                      else next.delete(o.key);
                                      updateLocal(t.key, { value_kind: t.value_kind, value_json: Array.from(next) });
                                    }}
                                  />
                                }
                                label={o.label}
                              />
                            );
                          })}
                        </FormGroup>
                      </CardContent>
                    </Card>
                  );
                }

                if (t.value_kind === "location" && t.key === "home_location") {
                  return (
                    <Card key={t.key} variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 700, mb: 1 }}>{t.label}</Typography>
                        <Stack spacing={1}>
                          <TextField
                            label="Region key (admin-managed)"
                            value={locationRegionKey}
                            onChange={(e) => setLocationRegionKey(e.target.value)}
                            placeholder="e.g. us-tx"
                            fullWidth
                          />
                          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                            <TextField label="City" value={locationCity} onChange={(e) => setLocationCity(e.target.value)} fullWidth />
                            <TextField label="State" value={locationState} onChange={(e) => setLocationState(e.target.value)} fullWidth />
                          </Stack>
                          <TextField label="Country" value={locationCountry} onChange={(e) => setLocationCountry(e.target.value)} fullWidth />
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                }

                return null;
              })}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

