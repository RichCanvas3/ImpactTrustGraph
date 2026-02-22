"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

export type AppRole = "admin" | "coordinator" | "org_admin" | "contributor" | "funder";

export type AppViewId =
  | "dashboard"
  | "agent-registry"
  | "user-tools"
  | "user-settings"
  | "user-capabilities"
  | "admin-capabilities"
  | "coordination-hub"
  | "trust-trail"
  | "opportunities"
  | "my-engagements"
  | "my-reputation"
  | "wallet"
  | "ecosystem-map"
  | "portfolio-overview"
  | "outcome-verification"
  | "compliance"
  | "analytics"
  | "initiative-dashboard"
  | "active-initiatives"
  | "proposed-initiatives"
  | "create-initiative"
  | "my-initiatives"
  | "initiative-matching"
  | "system-settings"
  | "user-management"
  | "protocol-config"
  | "agent-approvals"
  | "audit-log"
  | "coalition-settings"
  | "member-organizations"
  | "coordinator-sync"
  | "org-settings"
  | "team-management"
  | "budget-allocations"
  | "agent-configuration"
  | "grant-configuration"
  | "reporting-settings";

export interface AppNavItem {
  id: AppViewId;
  label: string;
  roles?: AppRole[];
  href?: string; // if provided, navigate to route instead of in-page view
}

export interface AppNavSection {
  id: string;
  label: string;
  items: AppNavItem[];
}

const DRAWER_WIDTH = 280;

export function AppShell(props: {
  role: AppRole;
  roleTitle?: string | null;
  sections: AppNavSection[];
  defaultView: AppViewId;
  children: (view: AppViewId) => React.ReactNode;
}) {
  const { role, roleTitle, sections, defaultView, children } = props;
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const viewParam = searchParams?.get("view") ?? "";
  const activeView = (viewParam ? (viewParam as AppViewId) : defaultView) as AppViewId;

  const setView = React.useCallback(
    (view: AppViewId) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("view", view);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const filteredSections = React.useMemo(() => {
    const allow = (item: AppNavItem) => !item.roles || item.roles.includes(role);
    return sections
      .map((s) => ({ ...s, items: s.items.filter(allow) }))
      .filter((s) => s.items.length > 0);
  }, [sections, role]);

  const sidebar = (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2.25, pt: 2.25, pb: 2 }}>
        <Typography sx={{ fontSize: 12, letterSpacing: "0.06em", fontWeight: 800, textTransform: "uppercase" }}>
          Impact Trust Graph
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {roleTitle ?? role}
        </Typography>
      </Box>
      <Divider />

      <Box sx={{ py: 1 }}>
        {filteredSections.map((section) => (
          <List
            key={section.id}
            dense
            subheader={
              <ListSubheader component="div" sx={{ bgcolor: "transparent", fontSize: 11, fontWeight: 800 }}>
                {section.label}
              </ListSubheader>
            }
          >
            {section.items.map((item) => {
              const selected = item.href ? pathname === item.href : activeView === item.id;
              return (
                <ListItemButton
                  key={item.id}
                  selected={selected}
                  onClick={() => {
                    if (item.href) {
                      router.push(item.href);
                      return;
                    }
                    setView(item.id);
                  }}
                  sx={{
                    mx: 1,
                    borderRadius: 1,
                    "&.Mui-selected": {
                      bgcolor: "rgba(18,52,91,0.10)",
                    },
                  }}
                >
                  <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13, fontWeight: selected ? 700 : 500 }} />
                </ListItemButton>
              );
            })}
          </List>
        ))}
      </Box>

      <Divider />
      <Stack direction="row" spacing={1} sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Prototype shell (role-driven)
        </Typography>
      </Stack>
    </Box>
  );

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: `${DRAWER_WIDTH}px 1fr` },
        gap: 0,
        minHeight: "calc(100vh - 64px)",
      }}
    >
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <Drawer
          variant="permanent"
          open
          PaperProps={{
            sx: {
              position: "relative",
              width: DRAWER_WIDTH,
              borderRight: `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          {sidebar}
        </Drawer>
      </Box>

      {/* Mobile: show content only (header already has nav) */}
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } }}>{children(activeView)}</Box>
      </Box>
    </Box>
  );
}

