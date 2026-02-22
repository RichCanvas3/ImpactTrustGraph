"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Box, Divider, List, ListItemButton, ListItemText, ListSubheader, Typography } from "@mui/material";
import { APP_NAV_SECTIONS, navItemToHref } from "./appNav";
import type { AppRole, AppViewId } from "./AppShell";

const SIDEBAR_BG = "#1A3A5C";

function isAllowed(item: { roles?: AppRole[] }, role: AppRole | null): boolean {
  if (!item.roles) return true;
  if (!role) return false;
  return item.roles.includes(role);
}

export function SiteSidebar(props: { role: AppRole | null }) {
  const { role } = props;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeView = (searchParams?.get("view") ?? "") as AppViewId;

  const publicItems = React.useMemo(
    () => [
      { label: "🏠 Home", href: "/" },
      { label: "🚀 Onboarding", href: "/onboarding" },
      { label: "🧭 App", href: "/app" },
    ],
    [],
  );

  const sections = React.useMemo(() => {
    if (!role) return [];
    return APP_NAV_SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((it) => isAllowed(it, role)),
    })).filter((s) => s.items.length > 0);
  }, [role]);

  const selectedHref = (href: string) => {
    if (!href) return false;
    if (href.startsWith("/app?view=")) return pathname === "/app" && href.includes(`view=${activeView}`);
    return pathname === href;
  };

  return (
    <Box sx={{ bgcolor: SIDEBAR_BG, color: "white", minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em" }}>
          🔐 AGENTIC TRUST
        </Typography>
      </Box>
      <Divider sx={{ borderColor: "rgba(255,255,255,0.15)" }} />

      <Box sx={{ py: 1, flex: 1 }}>
        <List
          dense
          subheader={
            <ListSubheader
              component="div"
              sx={{
                bgcolor: "transparent",
                color: "rgba(255,255,255,0.55)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Public
            </ListSubheader>
          }
        >
          {publicItems.map((it) => (
            <ListItemButton
              key={it.href}
              component={Link}
              href={it.href}
              selected={pathname === it.href}
              sx={{
                mx: 1,
                my: 0.25,
                borderRadius: 1,
                color: "rgba(255,255,255,0.78)",
                "&:hover": { bgcolor: "rgba(255,255,255,0.10)", color: "white" },
                "&.Mui-selected": { bgcolor: "rgba(255,255,255,0.15)", color: "white" },
              }}
            >
              <ListItemText primary={it.label} primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }} />
            </ListItemButton>
          ))}
        </List>

        {role ? (
          <>
            {sections.map((section) => (
              <List
                key={section.id}
                dense
                subheader={
                  <ListSubheader
                    component="div"
                    sx={{
                      bgcolor: "transparent",
                      color: "rgba(255,255,255,0.55)",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      mt: 1.5,
                    }}
                  >
                    {section.label}
                  </ListSubheader>
                }
              >
                {section.items.map((item) => {
                  const href = navItemToHref(item);
                  return (
                    <ListItemButton
                      key={item.id}
                      component={Link}
                      href={href}
                      selected={selectedHref(href)}
                      sx={{
                        mx: 1,
                        my: 0.25,
                        borderRadius: 1,
                        color: "rgba(255,255,255,0.78)",
                        "&:hover": { bgcolor: "rgba(255,255,255,0.10)", color: "white" },
                        "&.Mui-selected": { bgcolor: "rgba(255,255,255,0.15)", color: "white" },
                      }}
                    >
                      <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }} />
                    </ListItemButton>
                  );
                })}
              </List>
            ))}
          </>
        ) : null}
      </Box>

      <Box sx={{ mt: "auto" }}>
        <Divider sx={{ borderColor: "rgba(255,255,255,0.15)" }} />
        <Box sx={{ px: 2.5, py: 1.5, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
          ETHDenver 2026 BUIDLathon
        </Box>
      </Box>
    </Box>
  );
}

