"use client";

import type { AppNavSection, AppRole, AppViewId } from "./AppShell";

export function normalizeAppRole(raw: unknown): AppRole {
  const r = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (r === "admin" || r === "system-admin") return "admin";
  if (r === "coordinator" || r === "coalition") return "coordinator";
  if (r === "org_admin" || r === "org-admin" || r === "orgadmin" || r === "organization-admin" || r === "org") return "org_admin";
  if (r === "contributor") return "contributor";
  if (r === "funder" || r === "grantmaker" || r === "grant-maker") return "funder";
  return "org_admin";
}

export function getRoleTitle(role: AppRole): string {
  switch (role) {
    case "admin":
      return "System Administrator";
    case "coordinator":
      return "Coalition Coordinator";
    case "org_admin":
      return "Organization Admin";
    case "contributor":
      return "Contributor";
    case "funder":
      return "Grantmaker";
  }
}

export const APP_NAV_SECTIONS: AppNavSection[] = [
  {
    id: "main",
    label: "Main",
    items: [
      { id: "dashboard", label: "📊 Dashboard", href: "/dashboard" },
      { id: "agent-registry", label: "🤖 Agent Registry", href: "/agents", roles: ["admin", "coordinator", "org_admin"] },
      { id: "coordination-hub", label: "🔄 Coordination Hub", roles: ["coordinator"] },
      { id: "trust-trail", label: "📜 Trust Trail" },
      { id: "opportunities", label: "💼 Opportunities", roles: ["contributor"] },
      { id: "my-engagements", label: "✅ My Engagements", roles: ["contributor"] },
      { id: "my-reputation", label: "⭐ My Reputation", roles: ["contributor"] },
      { id: "wallet", label: "💰 Wallet", roles: ["coordinator", "org_admin", "contributor", "admin"] },
      { id: "ecosystem-map", label: "🌐 Ecosystem Map", roles: ["admin", "coordinator", "funder"] },
      { id: "portfolio-overview", label: "📈 Portfolio Overview", roles: ["funder"] },
      { id: "outcome-verification", label: "✔️ Outcome Verification", roles: ["funder"] },
      { id: "compliance", label: "📋 Compliance", roles: ["funder"] },
      { id: "analytics", label: "📊 Analytics", roles: ["admin", "coordinator", "funder"] },
    ],
  },
  {
    id: "initiatives",
    label: "Initiatives",
    items: [
      { id: "initiative-dashboard", label: "🎯 Initiative Dashboard" },
      { id: "active-initiatives", label: "📋 Active Initiatives" },
      { id: "create-initiative", label: "➕ Create Initiative", roles: ["coordinator", "org_admin", "admin"] },
      { id: "my-initiatives", label: "📌 My Initiatives", roles: ["contributor", "org_admin"] },
      { id: "initiative-matching", label: "🔗 Smart Matching", roles: ["coordinator", "admin"] },
    ],
  },
  {
    id: "admin",
    label: "Admin Tools",
    items: [
      { id: "system-settings", label: "⚙️ System Settings", roles: ["admin"] },
      { id: "user-management", label: "👥 User Management", roles: ["admin"] },
      { id: "protocol-config", label: "📡 Protocol Config", roles: ["admin"] },
      { id: "agent-approvals", label: "✋ Agent Approvals", roles: ["admin", "coordinator"] },
      { id: "audit-log", label: "🔍 Audit Log", roles: ["admin"] },
    ],
  },
  {
    id: "coordination",
    label: "Coordination Tools",
    items: [
      { id: "coalition-settings", label: "⚙️ Coalition Settings", roles: ["coordinator"] },
      { id: "member-organizations", label: "🏢 Member Organizations", roles: ["coordinator"] },
      { id: "coordinator-sync", label: "🔗 Coordinator Sync", roles: ["coordinator"] },
    ],
  },
  {
    id: "org",
    label: "Organization Tools",
    items: [
      { id: "org-settings", label: "⚙️ Organization Settings", roles: ["org_admin"] },
      { id: "team-management", label: "👤 Team Management", roles: ["org_admin"] },
      { id: "budget-allocations", label: "💵 Budget & Allocations", roles: ["org_admin"] },
      { id: "agent-configuration", label: "🤖 Agent Configuration", roles: ["org_admin"] },
    ],
  },
  {
    id: "grant",
    label: "Grant Admin",
    items: [
      { id: "grant-configuration", label: "📋 Grant Configuration", roles: ["funder"] },
      { id: "reporting-settings", label: "📝 Reporting Settings", roles: ["funder"] },
    ],
  },
];

export function navItemToHref(item: { id: AppViewId; href?: string }): string {
  if (item.href) return item.href;
  return `/app?view=${encodeURIComponent(item.id)}`;
}

