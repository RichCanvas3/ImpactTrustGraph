"use client";

import * as React from "react";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { ConnectionProvider } from "../components/connection-context";
import { SiteHeader } from "../components/site-header";
import { ConnectionRestorer } from "../components/ConnectionRestorer";
import { DefaultOrgAgentProvider } from "../components/useDefaultOrgAgent";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: "light",
          primary: {
            main: "#12345b" // deep, formal blue
          },
          secondary: {
            main: "#b58900" // muted gold accent
          },
          background: {
            default: "#f3f4f6",
            paper: "#ffffff"
          },
          text: {
            primary: "#111827",
            secondary: "#4b5563"
          }
        },
        typography: {
          fontFamily:
            '"Source Sans 3", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          h1: {
            fontWeight: 600,
            letterSpacing: "0.03em",
            textTransform: "uppercase"
          },
          h2: {
            fontWeight: 600,
            letterSpacing: "0.02em"
          },
          button: {
            textTransform: "none",
            fontWeight: 600
          }
        },
        shape: {
          borderRadius: 8
        },
        components: {
          MuiPaper: {
            styleOverrides: {
              root: {
                borderRadius: 8
              }
            }
          }
        }
      }),
    []
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
    <ConnectionProvider>
        <DefaultOrgAgentProvider>
          <ConnectionRestorer />
      <div
        style={{
          minHeight: "100vh",
              backgroundColor: "#f3f4f6",
              color: "#111827"
        }}
      >
        <SiteHeader />
        <div style={{ paddingTop: "0.5rem" }}>{children}</div>
      </div>
        </DefaultOrgAgentProvider>
    </ConnectionProvider>
    </ThemeProvider>
  );
}


