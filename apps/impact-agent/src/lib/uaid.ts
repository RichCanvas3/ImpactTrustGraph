export type UaidParts = {
  chainId: number;
  agentAccount: `0x${string}`;
};

export function parseUaidParts(uaid: unknown): UaidParts | null {
  if (typeof uaid !== "string") return null;
  const raw = uaid.trim();
  if (!raw) return null;
  const m = raw.match(/did:ethr:(\d+):(0x[a-fA-F0-9]{40})/);
  if (!m) return null;
  const chainId = Number.parseInt(m[1] || "", 10);
  const acct = String(m[2] || "").toLowerCase();
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  if (!/^0x[a-f0-9]{40}$/.test(acct)) return null;
  return { chainId, agentAccount: acct as `0x${string}` };
}

