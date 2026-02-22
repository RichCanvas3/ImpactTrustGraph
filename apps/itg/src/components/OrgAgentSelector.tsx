"use client";

import * as React from "react";
import { type DefaultOrgAgent } from "./useDefaultOrgAgent";
import { type OrganizationAssociation } from "../app/service/userProfileService";
import { parseUaidParts } from "../lib/uaid";

interface OrgAgentSelectorProps {
  organizations: OrganizationAssociation[];
  onSelect: (agent: DefaultOrgAgent) => void;
  onCancel?: () => void;
}

/**
 * Component to select a default org agent when user has multiple organizations
 * Enforces that only one account abstraction can be used per user
 */
export function OrgAgentSelector({ organizations, onSelect, onCancel }: OrgAgentSelectorProps) {
  const [selectedIndex, setSelectedIndex] = React.useState<number>(0);

  const handleSelect = () => {
    const selectedOrg = organizations[selectedIndex];
    if (!selectedOrg) return;

    const parsed = parseUaidParts(selectedOrg.uaid);

    // Convert OrganizationAssociation to DefaultOrgAgent
    const defaultAgent: DefaultOrgAgent = {
      ensName: selectedOrg.ens_name,
      agentName: selectedOrg.agent_name,
      agentAccount: parsed?.agentAccount ?? "",
      chainId: parsed?.chainId ?? 11155111,
      name: selectedOrg.org_name,
      description: undefined,
      image: undefined,
      agentUrl: undefined,
      uaid: selectedOrg.uaid ?? undefined,
    };

    onSelect(defaultAgent);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "0.75rem",
          padding: "2rem",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
        }}
      >
        <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem", fontWeight: 600 }}>
          Select Default Organization Agent
        </h2>
        <p style={{ marginBottom: "1.5rem", color: "#64748b", fontSize: "0.9rem" }}>
          Your account is associated with multiple organization agents. Please select which one to use as your default.
          <br />
          <strong style={{ color: "#1e40af" }}>Note:</strong> You can only use one account abstraction address, which is already set for your account.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {organizations.length === 0 ? (
            <div style={{ padding: "1rem", textAlign: "center", color: "#64748b" }}>
              No organizations found.
            </div>
          ) : (
            organizations.map((org, index) => (
            <label
              key={index}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "1rem",
                borderRadius: "0.5rem",
                border: selectedIndex === index ? "2px solid #2563eb" : "1px solid #e2e8f0",
                backgroundColor: selectedIndex === index ? "#eff6ff" : "white",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="orgAgent"
                checked={selectedIndex === index}
                onChange={() => setSelectedIndex(index)}
                style={{ marginTop: "0.25rem", cursor: "pointer" }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  {org.org_name || org.agent_name}
                </div>
                <div style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "0.25rem" }}>
                  <strong>ENS Name:</strong> {org.ens_name}
                </div>
                <div style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "0.25rem" }}>
                  <strong>Agent Name:</strong> {org.agent_name}
                </div>
                {Array.isArray((org as any).org_roles) && (org as any).org_roles.length ? (
                  <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
                    <strong>Roles:</strong> {(org as any).org_roles.join(", ")}
                  </div>
                ) : null}
                {org.is_primary && (
                  <div
                    style={{
                      display: "inline-block",
                      marginTop: "0.5rem",
                      padding: "0.25rem 0.5rem",
                      backgroundColor: "#dbeafe",
                      color: "#1e40af",
                      borderRadius: "0.25rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    Primary
                  </div>
                )}
              </div>
            </label>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "0.5rem",
                border: "1px solid #cbd5f5",
                backgroundColor: "white",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSelect}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "none",
              backgroundColor: "#2563eb",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Use Selected Agent
          </button>
        </div>
      </div>
    </div>
  );
}

