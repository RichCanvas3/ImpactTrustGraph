/**
 * User Profile Service
 * Handles user profile and organization association management
 */

export interface UserProfile {
  email?: string | null;
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
  participant_agent_account?: string | null;
  participant_agent_id?: string | null;
  participant_chain_id?: number | null;
  participant_did?: string | null;
}

export interface OrganizationAssociation {
  ens_name: string;
  agent_name: string;
  org_name?: string;
  org_address?: string;
  org_type?: string;
  email_domain: string;
  agent_account?: string;
  chain_id?: number;
  is_primary?: boolean;
  role?: string;
}

/**
 * Save or update user profile
 */
export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  // Convert null to undefined for API compatibility
  const cleanedProfile = {
    ...(profile.email ? { email: profile.email } : {}),
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
    participant_agent_account: profile.participant_agent_account ?? undefined,
    participant_agent_id: profile.participant_agent_id ?? undefined,
    participant_chain_id: profile.participant_chain_id ?? undefined,
    participant_did: profile.participant_did ?? undefined,
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
export async function getUserProfile(email?: string, eoa?: string): Promise<UserProfile | null> {
  if (!email && !eoa) {
    return null;
  }

  const params = new URLSearchParams();
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

/**
 * Get primary organization for a user (based on email domain)
 */
export async function getPrimaryOrganization(email: string): Promise<OrganizationAssociation | null> {
  const organizations = await getUserOrganizations(email);
  return organizations.find((org: any) => org.is_primary) || null;
}

