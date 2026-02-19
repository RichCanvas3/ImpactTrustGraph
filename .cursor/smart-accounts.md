---
description: Smart Account Creation Guidelines
globs: "**/*"
---
# Smart Account Creation Guidelines

When creating or interacting with Smart Accounts (Account Abstraction):

1. **ALWAYS** use the `@metamask/smart-accounts-kit` for creating, deploying, and managing Smart Accounts.
2. **DO NOT** use `viem` (or `permissionless`) directly for Smart Account creation unless explicitly required for low-level operations not supported by the toolkit.
3. Prefer `getDeployedAccountClientByAgentName` or similar helpers from `@agentic-trust/core` (which wrap the delegation toolkit) when available.

## Rationale
- Ensures consistency across the codebase.
- Leverages the enhanced capabilities of the MetaMask Delegation Toolkit (delegation, hybrid accounts).
- Avoids fragmentation of account implementations.

## Example (Correct)
```typescript
import { getDeployedAccountClientByAgentName } from '@agentic-trust/core';
// or
import { toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
```

## Example (Avoid)
```typescript
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';
  const agentAccountClient = await toMetaMaskSmartAccount({
    address: agentOwnerAddress as `0x${string}`,
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer: { walletClient },
  } as any);

or using salt

    const accountClient = await toMetaMaskSmartAccount({
      client: adminApp.publicClient as any,
      implementation: Implementation.Hybrid,
      signer: adminApp.walletClient
        ? { walletClient: adminApp.walletClient as any }
        : (adminApp.account ? { account: adminApp.account } : {}),
      deployParams: [adminApp.address as `0x${string}`, [], [], []],
      deploySalt,
    } as any);


```

