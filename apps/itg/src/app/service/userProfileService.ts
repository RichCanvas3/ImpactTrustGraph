/**
 * User Profile Service
 * Handles user profile and organization association management
 */

export interface UserProfile {
  id?: number; // individuals.id
  email?: string | null;
  role?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  social_display_name?: string | null;
  social_account_id?: string | null;
  social_account_type?: string | null;
  eoa_address?: string | null;
  aa_address?: string | null;
  participant_ens_name?: string | null;
  participant_agent_name?: string | null;
  participant_uaid?: string | null;
  participant_agent_row_id?: number | null;
  participant_metadata?: string | null; // JSON string
  trust_tier?: string | null;
}

export function getPreferredIndividualDisplayName(profile: UserProfile | null | undefined): string | null {
  if (!profile) return null;
  const first = typeof profile.first_name === "string" ? profile.first_name.trim() : "";
  const last = typeof profile.last_name === "string" ? profile.last_name.trim() : "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) return full;
  const social = typeof profile.social_display_name === "string" ? profile.social_display_name.trim() : "";
  return social || null;
}

export interface OrganizationAssociation {
  id?: number; // organizations.id (when fetched by EOA/email)
  ens_name: string;
  agent_name: string;
  org_name?: string;
  org_address?: string;
  org_roles?: string[]; // coalition|contributor|funding|member
  email_domain: string;
  uaid?: string | null;
  agent_row_id?: number | null;
  session_package?: string | null;
  org_metadata?: string | null; // JSON string
  is_primary?: boolean;
  role?: string;
}

/**
 * Save or update user profile
 */
export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  // Convert null to undefined for API compatibility
  const cleanedProfile = {
    ...(typeof profile.id === "number" && Number.isFinite(profile.id) && profile.id > 0
      ? { individual_id: profile.id }
      : {}),
    ...(profile.email ? { email: profile.email } : {}),
    role: profile.role ?? undefined,
    first_name: profile.first_name ?? undefined,
    last_name: profile.last_name ?? undefined,
    phone_number: profile.phone_number ?? undefined,
    social_display_name: profile.social_display_name ?? undefined,
    social_account_id: profile.social_account_id ?? undefined,
    social_account_type: profile.social_account_type ?? undefined,
    eoa_address: profile.eoa_address ?? undefined,
    aa_address: profile.aa_address ?? undefined,
    participant_ens_name: profile.participant_ens_name ?? undefined,
    participant_agent_name: profile.participant_agent_name ?? undefined,
    participant_uaid: profile.participant_uaid ?? undefined,
    participant_metadata: profile.participant_metadata ?? undefined,
    trust_tier: profile.trust_tier ?? undefined,
  };

  const response = await fetch('/api/users/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cleanedProfile),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to save user profile');
  }

  const data = await response.json();
  return data.profile;
}

/**
 * Get user profile by email or EOA
 */
export async function getUserProfile(email?: string, eoa?: string, individualId?: number): Promise<UserProfile | null> {
  if (individualId == null && !email && !eoa) {
    return null;
  }

  const params = new URLSearchParams();
  if (typeof individualId === 'number' && individualId > 0) params.set('individualId', String(individualId));
  if (email) params.append('email', email);
  if (eoa) params.append('eoa', eoa);

  const response = await fetch(`/api/users/profile?${params.toString()}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get user profile');
  }

  const data = await response.json();
  return data.profile;
}

/**
 * Associate user with an organization (email-based, legacy)
 */
export async function associateUserWithOrganization(
  email: string,
  organization: OrganizationAssociation
): Promise<void> {
  if (!organization.uaid || typeof organization.uaid !== "string" || !organization.uaid.trim()) {
    throw new Error("Missing uaid for organization agent (UAID is the canonical identifier).");
  }
  const response = await fetch('/api/users/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      ...organization,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to associate user with organization');
  }
}

/**
 * Associate user with an organization by EOA (preferred).
 * Optionally include email if known.
 */
export async function associateUserWithOrganizationByEoa(
  eoa_address: string,
  organization: OrganizationAssociation,
  email?: string | null,
): Promise<void> {
  if (!organization.uaid || typeof organization.uaid !== "string" || !organization.uaid.trim()) {
    throw new Error("Missing uaid for organization agent (UAID is the canonical identifier).");
  }
  const response = await fetch('/api/users/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(email ? { email } : {}),
      eoa_address,
      ...organization,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to associate user with organization');
  }
}

/**
 * Get all organizations for a user
 */
export async function getUserOrganizations(email: string): Promise<OrganizationAssociation[]> {
  const response = await fetch(`/api/users/organizations?email=${encodeURIComponent(email)}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get user organizations');
  }

  const data = await response.json();
  return data.organizations || [];
}

export async function getUserOrganizationsByEoa(eoa_address: string): Promise<OrganizationAssociation[]> {
  const response = await fetch(`/api/users/organizations?eoa=${encodeURIComponent(eoa_address)}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get user organizations');
  }
  const data = await response.json();
  return data.organizations || [];
}

/** Prefer this when you already have the current user's individual id (e.g. from profile). */
export async function getUserOrganizationsByIndividualId(individualId: number): Promise<OrganizationAssociation[]> {
  const response = await fetch(`/api/users/organizations?individualId=${encodeURIComponent(individualId)}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get user organizations');
  }
  const data = await response.json();
  return data.organizations || [];
}

export async function upsertUserOrganizationByIndividualId(input: {
  individual_id: number;
  ens_name: string;
  agent_name: string;
  org_name?: string | null;
  org_address?: string | null;
  org_roles?: string[] | null;
  uaid: string;
  session_package?: string | null;
  org_metadata?: string | null;
  is_primary?: boolean;
  role?: string | null;
}): Promise<void> {
  if (!input.uaid || typeof input.uaid !== "string" || !input.uaid.trim()) {
    throw new Error("Missing uaid for organization agent (UAID is the canonical identifier).");
  }
  const response = await fetch('/api/users/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || 'Failed to upsert organization association');
  }
}

/** UAID-only association path (no EOA/email required). */
export async function upsertUserOrganizationByIndividualUaid(input: {
  individual_uaid: string;
  ens_name: string;
  agent_name: string;
  org_name?: string | null;
  org_address?: string | null;
  org_roles?: string[] | null;
  email_domain?: string | null;
  uaid: string;
  session_package?: string | null;
  org_metadata?: string | null;
  is_primary?: boolean;
  role?: string | null;
}): Promise<void> {
  if (!input.individual_uaid || typeof input.individual_uaid !== "string" || !input.individual_uaid.trim()) {
    throw new Error("Missing individual_uaid (participant UAID) for organization association.");
  }
  if (!input.uaid || typeof input.uaid !== "string" || !input.uaid.trim()) {
    throw new Error("Missing uaid for organization agent (UAID is the canonical identifier).");
  }
  const response = await fetch('/api/users/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || 'Failed to upsert organization association');
  }
}

/**
 * Get primary organization for a user (based on email domain)
 */
export async function getPrimaryOrganization(email: string): Promise<OrganizationAssociation | null> {
  const organizations = await getUserOrganizations(email);
  return organizations.find((org: any) => org.is_primary) || null;
}

