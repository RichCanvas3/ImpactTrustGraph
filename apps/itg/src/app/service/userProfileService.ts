/**
 * User Profile Service
 * Handles user profile and organization association management
 */

export interface UserProfile {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  social_account_id?: string | null;
  social_account_type?: string | null;
  eoa_address?: string | null;
  aa_address?: string | null;
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
    email: profile.email,
    first_name: profile.first_name ?? undefined,
    last_name: profile.last_name ?? undefined,
    social_account_id: profile.social_account_id ?? undefined,
    social_account_type: profile.social_account_type ?? undefined,
    eoa_address: profile.eoa_address ?? undefined,
    aa_address: profile.aa_address ?? undefined,
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
 * Associate user with an organization
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

/**
 * Get primary organization for a user (based on email domain)
 */
export async function getPrimaryOrganization(email: string): Promise<OrganizationAssociation | null> {
  const organizations = await getUserOrganizations(email);
  return organizations.find((org: any) => org.is_primary) || null;
}

