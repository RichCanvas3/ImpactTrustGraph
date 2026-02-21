"use client";

import * as React from "react";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { ConnectionProvider } from "../components/connection-context";
import { ConnectionRestorer } from "../components/ConnectionRestorer";
import { DefaultOrgAgentProvider } from "../components/useDefaultOrgAgent";
import { CurrentUserProfileProvider } from "../components/useCurrentUserProfile";
import { SiteFrame } from "../components/SiteFrame";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: "light",
          primary: {
            // Mockup v3.0 primary
            main: "#2B5797",
          },
          secondary: {
            // Mockup v3.0 secondary
            main: "#0D7377",
          },
          success: { main: "#28A745" },
          warning: { main: "#F57C00" },
          error: { main: "#DC3545" },
          background: {
            default: "#f5f5f5",
            paper: "#ffffff"
          },
          text: {
            primary: "#333333",
            secondary: "#666666"
          }
        },
        typography: {
          fontFamily:
            '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
          borderRadius: 10
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: "#f5f5f5",
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                borderRadius: 10
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
          <CurrentUserProfileProvider>
            <SiteFrame>{children}</SiteFrame>
          </CurrentUserProfileProvider>
        </DefaultOrgAgentProvider>
    </ConnectionProvider>
    </ThemeProvider>
  );
}


