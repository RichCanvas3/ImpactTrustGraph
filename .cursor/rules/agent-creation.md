---
description: Agent Creation Guidelines
globs: "**/*"
---
# Agent Creation Guidelines

When creating new agents using `createAgentWithWallet`:

1. **ALWAYS** set `useAA: true` to ensure Account Abstraction is used.
2. **ALWAYS** provide `ensOptions` (if applicable) to handle ENS registration.
3. **ALWAYS** follow the standard configuration structure with `agentData`, `account`, `ethereumProvider`, and `chainId`.

## Required Configuration Pattern

```typescript
const result = await createAgentWithWallet({
  agentData: {
    agentName, // e.g., 'my-agent.8004-agent.eth'
    agentAccount: agentAccountAddress as `0x${string}`,
    description: 'Agent description', // e.g. 'itg account'
    image: 'https://...', // Agent image URL
    agentUrl: 'https://...', // Agent homepage/endpoint URL
  },
  account: account as `0x${string}`, // The EOA/Signer address
  ethereumProvider: provider as any, // EIP-1193 provider
  ensOptions: {
    enabled: true,
    orgName: ensOrgName // e.g. '8004-agent.eth'
  },
  useAA: true, // CRITICAL: Always true
  chainId: sepolia.id // Target chain ID
});
```

## Rationale
- **Account Abstraction**: Ensures all agents are deployed with smart accounts for better capability management.
- **Consistency**: Standardizes how agent metadata and ENS names are handled during creation.

