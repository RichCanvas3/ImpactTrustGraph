"use client";

import * as React from "react";
import { Box, useMediaQuery, useTheme } from "@mui/material";
import { SiteHeader } from "./site-header";
import { SiteSidebar } from "./SiteSidebar";
import { useCurrentUserProfile } from "./useCurrentUserProfile";

const SIDEBAR_WIDTH = 260;
const HEADER_HEIGHT = 64;

export function SiteFrame({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const mdUp = useMediaQuery(theme.breakpoints.up("md"));
  const { role } = useCurrentUserProfile();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        width: "100%",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: `${SIDEBAR_WIDTH}px 1fr` },
        gridTemplateRows: `${HEADER_HEIGHT}px auto`,
        bgcolor: "background.default",
      }}
    >
      {/* Sidebar spans both rows (mockup layout) */}
      {mdUp ? (
        <Box sx={{ gridColumn: 1, gridRow: "1 / -1", minHeight: "100vh" }}>
          <SiteSidebar role={role} />
        </Box>
      ) : null}

      {/* Header */}
      <Box
        sx={{
          gridColumn: { xs: "1", md: "2" },
          gridRow: "1",
          position: "sticky",
          top: 0,
          zIndex: 1100,
          bgcolor: "background.paper",
          borderBottom: `1px solid ${theme.palette.divider}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <SiteHeader />
      </Box>

      {/* Main content scrolls */}
      <Box
        sx={{
          gridColumn: { xs: "1", md: "2" },
          gridRow: "2",
          bgcolor: "background.default",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

