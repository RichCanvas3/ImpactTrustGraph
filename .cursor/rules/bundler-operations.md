---
description: Bundled User Operation Guidelines
globs: "**/*"
---
# Bundled User Operation Guidelines

When sending UserOperations (especially for Account Abstraction), always use a `bundlerClient` with sponsored paymaster support.

## Implementation Pattern

1. **Create Bundler Client**: Configure with `transport`, `chain`, and `paymaster: true`.
2. **Gas Estimation (Optional)**: Attempt to fetch gas prices from Pimlico if available.
3. **Send Operation**: Use `bundlerClient.sendUserOperation` with the account client and calls.
4. **Wait for Receipt**: Use `bundlerClient.waitForUserOperationReceipt`.

## Example

```typescript
import { createBundlerClient, http } from 'viem/account-abstraction';

// 1. Create Bundler Client
const bundlerClient = createBundlerClient({
  transport: http(bundlerUrl),
  paymaster: true as any,
  chain: chain as any,
  paymasterContext: { mode: 'SPONSORED' },
} as any);

// 2. Optional Gas Estimation (Pimlico)
let fee: any = {};
try {
  const { createPimlicoClient } = await import('permissionless/clients/pimlico');
  const pimlico = createPimlicoClient({ transport: http(bundlerUrl) } as any);
  const gas = await (pimlico as any).getUserOperationGasPrice();
  fee = gas.fast || {};
} catch {
  // Fallback to standard estimation
}

// 3. Send UserOperation
const userOperationHash = await (bundlerClient as any).sendUserOperation({
  account: accountClient as any,
  calls: calls, // Array of { to, data, value }
  ...fee,
});

// 4. Wait for Receipt
const receipt = await (bundlerClient as any).waitForUserOperationReceipt({ 
  hash: userOperationHash 
});
```

