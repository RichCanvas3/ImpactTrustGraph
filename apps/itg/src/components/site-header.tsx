"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LogoutIcon from "@mui/icons-material/Logout";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import MessageOutlinedIcon from "@mui/icons-material/MessageOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import WorkOutlineIcon from "@mui/icons-material/WorkOutline";
import { useConnection } from "./connection-context";
import { useWeb3Auth } from "./Web3AuthProvider";
import { useStandardConnect } from "./useStandardConnect";
import { useDefaultOrgAgent } from "./useDefaultOrgAgent";
import { OrgAgentSelector } from "./OrgAgentSelector";
import { getPreferredIndividualDisplayName } from "../app/service/userProfileService";
import { useCurrentUserProfile } from "./useCurrentUserProfile";
import type { AppRole } from "./AppShell";

const ROLE_COLORS: Record<AppRole, string> = {
  admin: "#DC3545",
  coordinator: "#7B1FA2",
  org_admin: "#2B5797",
  contributor: "#28A745",
  funder: "#F57C00",
};

function roleLabel(role: AppRole) {
  switch (role) {
    case "admin":
      return "Admin";
    case "coordinator":
      return "Coordinator";
    case "org_admin":
      return "Org Admin";
    case "contributor":
      return "Contributor";
    case "funder":
      return "Grantmaker";
  }
}

function titleForPath(pathname: string, viewParam: string | null): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/onboarding")) return "Onboarding";
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname === "/agents") return "Agent Registry";
  if (pathname === "/messages") return "Messages";
  if (pathname === "/profile") return "Profile";
  if (pathname === "/app") {
    if (!viewParam) return "Workspace";
    return viewParam
      .split("-")
      .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return "Workspace";
}

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, setUser } = useConnection();
  const { logout, web3auth } = useWeb3Auth();
  const { walletAddress, profile, role, setRole, loading: profileLoading } = useCurrentUserProfile();
  const { 
    handleStandardConnect, 
    showOrgSelector, 
    availableOrgs, 
    handleOrgSelect, 
    onCancelOrgSelect 
  } = useStandardConnect();
  const { setDefaultOrgAgent, defaultOrgAgent } = useDefaultOrgAgent();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [roleAnchorEl, setRoleAnchorEl] = React.useState<null | HTMLElement>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isSelectingAgent, setIsSelectingAgent] = React.useState(false);
  const accountDisplayName = React.useMemo(
    () => user?.name || user?.email || walletAddress || "Account",
    [user?.name, user?.email, walletAddress]
  );
  const accountInitial = accountDisplayName ? accountDisplayName[0]?.toUpperCase() ?? "A" : "A";
  const menuItems = React.useMemo(
    () => [
      { label: "Dashboard", icon: <DashboardOutlinedIcon fontSize="small" />, path: "/dashboard" },
      { label: "Messages", icon: <MessageOutlinedIcon fontSize="small" />, path: "/messages" },
      { label: "Organizations", icon: <GroupOutlinedIcon fontSize="small" />, path: "/agents" },
      { label: "My Initiatives", icon: <WorkOutlineIcon fontSize="small" />, path: "/app" },
      { label: "Profile", icon: <SettingsOutlinedIcon fontSize="small" />, path: "/profile" }
    ],
    []
  );

  const handleDisconnect = React.useCallback(async () => {
    try {
      await logout();
    } catch (e) {
      console.error(e);
    } finally {
      // Clear connection-related caches on explicit disconnect
      try {
        if (typeof window !== "undefined") {
          // Default org agent cache
          localStorage.removeItem("itg_default_org_agent");
          // Cached agent details per DID
          Object.keys(localStorage)
            .filter((key) => key.startsWith("itg_agent_details_"))
            .forEach((key) => localStorage.removeItem(key));
        }
      } catch (cacheError) {
        console.warn("[site-header] Failed to clear cached agent data on disconnect:", cacheError);
      }

      // Clear default org agent state
      setDefaultOrgAgent(null);
      setUser(null);
      setAnchorEl(null);
      router.push("/");
    }
  }, [logout, router, setUser, setDefaultOrgAgent]);

  const handleNavigate = React.useCallback(
    (path: string) => {
      setAnchorEl(null);
      router.push(path);
    },
    [router]
  );

  // If profile has first/last name, use it as the display name.
  React.useEffect(() => {
    if (!user || !profile) return;
    const preferred = getPreferredIndividualDisplayName(profile);
    if (preferred && preferred !== user.name) {
      setUser({ ...user, name: preferred });
    }
  }, [user, profile, setUser]);

  // When the org selector closes (after selection or cancel), clear the "selecting" spinner
  React.useEffect(() => {
    if (!showOrgSelector) {
      setIsSelectingAgent(false);
    }
  }, [showOrgSelector]);

  const headerTitle = React.useMemo(() => {
    const viewParam = searchParams?.get("view");
    return titleForPath(pathname, viewParam);
  }, [pathname, searchParams]);

  return (
    <>
      {showOrgSelector && availableOrgs.length > 0 && (
        <OrgAgentSelector
          organizations={availableOrgs}
          onSelect={handleOrgSelect}
          onCancel={onCancelOrgSelect}
        />
      )}
      <Box
        sx={{
          height: 64,
          px: { xs: 2, md: 4 },
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            <strong style={{ color: "#333" }}>{headerTitle}</strong>
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          {user ? (
            <Box
              sx={{
                fontSize: 12,
                px: 1.5,
                py: 0.75,
                borderRadius: 999,
                bgcolor: "#f0f0f0",
                color: "secondary.main",
                fontWeight: 600,
                display: { xs: "none", sm: "block" },
              }}
            >
              🔗 Connected via Web3Auth
            </Box>
          ) : null}

          {/* Role switcher */}
          <Button
            variant="outlined"
            size="small"
            disabled={!user || profileLoading}
            onClick={(e) => setRoleAnchorEl(e.currentTarget)}
            sx={{
              bgcolor: "background.default",
              borderColor: "divider",
              textTransform: "none",
              fontWeight: 600,
              borderRadius: 1.5,
              px: 1.5,
            }}
            startIcon={
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: role ? ROLE_COLORS[role] : "grey.400",
                }}
              />
            }
            endIcon={profileLoading ? <CircularProgress size={14} /> : <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
          >
            {role ? roleLabel(role) : "Role"}
          </Button>
          <Menu
            anchorEl={roleAnchorEl}
            open={Boolean(roleAnchorEl)}
            onClose={() => setRoleAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            PaperProps={{ sx: { mt: 1, minWidth: 220 } }}
          >
            {(["admin", "coordinator", "org_admin", "contributor", "funder"] as AppRole[]).map((r) => (
              <MenuItem
                key={r}
                selected={role === r}
                onClick={async () => {
                  try {
                    await setRole(r);
                  } finally {
                    setRoleAnchorEl(null);
                  }
                }}
              >
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: ROLE_COLORS[r], mr: 1.25 }} />
                {roleLabel(r)}
              </MenuItem>
            ))}
          </Menu>

          {/* Default agent indicator + quick switcher */}
          {user && defaultOrgAgent ? (
            <Tooltip title="Switch default agent">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    if (isSelectingAgent) return;
                    setIsSelectingAgent(true);
                    void handleStandardConnect().catch((err) => {
                      console.error("[site-header] Failed to open org selector from default agent button:", err);
                      setIsSelectingAgent(false);
                    });
                  }}
                  startIcon={
                    <Avatar
                      sx={{
                        width: 26,
                        height: 26,
                        fontSize: 12,
                        bgcolor: "rgba(43,87,151,0.12)",
                        color: "primary.main",
                      }}
                    >
                      {(defaultOrgAgent.name || defaultOrgAgent.agentName || "A").slice(0, 2).toUpperCase()}
                    </Avatar>
                  }
                  endIcon={isSelectingAgent ? <CircularProgress size={14} /> : <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
                  sx={{
                    textTransform: "none",
                    fontWeight: 600,
                    bgcolor: "background.default",
                    borderColor: "divider",
                    borderRadius: 1.5,
                    maxWidth: 240,
                    justifyContent: "space-between",
                    opacity: isSelectingAgent ? 0.8 : 1,
                  }}
                  disabled={isSelectingAgent}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {defaultOrgAgent.name || defaultOrgAgent.agentName || defaultOrgAgent.ensName}
                  </Typography>
                </Button>
              </span>
            </Tooltip>
          ) : null}

          {!user ? (
            <Button
              variant="contained"
              size="small"
              onClick={async () => {
                if (!web3auth) return;
                setIsConnecting(true);
                try {
                  const result = await handleStandardConnect();
                  if (result?.hasAgent && result?.needsSelection) return;
                  if (result?.hasAgent && !result?.needsSelection) {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                    const stored = typeof window !== "undefined" ? localStorage.getItem("itg_default_org_agent") : null;
                    if (!defaultOrgAgent && !stored) router.push("/onboarding");
                    return;
                  }
                  if (!result?.hasAgent) router.push("/onboarding");
                } catch (e) {
                  console.error(e);
                } finally {
                  setIsConnecting(false);
                }
              }}
              disabled={!web3auth || isConnecting}
              sx={{ borderRadius: 1.5, px: 2 }}
            >
              {isConnecting ? "Connecting…" : "Connect"}
            </Button>
          ) : (
            <>
              <Button
                variant="outlined"
                size="small"
                onClick={(event) => setAnchorEl(event.currentTarget)}
                startIcon={
                  <Avatar
                    sx={{
                      width: 26,
                      height: 26,
                      bgcolor: "rgba(43,87,151,0.12)",
                      color: "primary.main",
                      fontSize: 13,
                    }}
                  >
                    {accountInitial}
                  </Avatar>
                }
                endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
                sx={{
                  bgcolor: "background.default",
                  borderColor: "divider",
                  borderRadius: 1.5,
                  px: 1.5,
                  maxWidth: 260,
                  justifyContent: "space-between",
                  textTransform: "none",
                  fontWeight: 700,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    maxWidth: 170,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                    fontWeight: 700,
                  }}
                >
                  {accountDisplayName}
                </Typography>
              </Button>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                PaperProps={{ sx: { mt: 1, minWidth: 260 } }}
              >
                {menuItems.map((item) => (
                  <MenuItem key={item.path} onClick={() => handleNavigate(item.path)} sx={{ py: 1 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>{item.icon}</ListItemIcon>
                    <Typography variant="body2">{item.label}</Typography>
                  </MenuItem>
                ))}
                <MenuItem onClick={() => handleNavigate("/onboarding")} sx={{ py: 1 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <WorkOutlineIcon fontSize="small" />
                  </ListItemIcon>
                  <Typography variant="body2">Onboarding</Typography>
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleDisconnect} sx={{ color: (theme) => theme.palette.error.main, py: 1 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <LogoutIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  Disconnect
                </MenuItem>
              </Menu>
            </>
          )}
        </Box>
      </Box>
    </>
  );
}


