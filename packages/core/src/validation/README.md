# Validation Core Functions

This module provides customizable validation request functions for the ITG project, similar to the `prepareValidationRequestCore` function from the [Agentic Trust Core Libraries](https://github.com/Agentic-Trust-Layer/agentic-trust).

## Functions

### `prepareValidationRequestCore`

Server-side function that prepares a validation request transaction without executing it. This function can be customized for the ITG project's specific requirements.

**Signature:**
```typescript
export async function prepareValidationRequestCore(
  ctx: AgentApiContext | undefined,
  input: PrepareValidationRequestPayload,
  getClient: () => Promise<AgenticTrustClient>,
): Promise<AgentOperationPlan>
```


**Example Usage:**
```typescript
import { prepareValidationRequestCore } from '@my-scope/core';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

const plan = await prepareValidationRequestCore(
  undefined, // ctx
  {
    did8004: 'did:8004:11155111:1234',
    mode: 'aa',
    requestUri: 'https://example.com/validation',
  },
  getAgenticTrustClient,
);
```

### `requestValidationWithWallet`

Client-side function that executes a validation request using an account client. This function wraps the original `@agentic-trust/core` function to allow for customization.

**Signature:**
```typescript
export async function requestValidationWithWallet(
  options: ValidationRequestOptions,
): Promise<ValidationRequestResult>
```

**Customization Points:**
- **Error Handling**: The function includes custom error handling for ITG-specific error cases (e.g., "exists" errors).
- **Implementation**: You can replace the wrapper with a fully custom implementation if needed.

**Example Usage:**
```typescript
import { requestValidationWithWallet } from '@my-scope/core';

const result = await requestValidationWithWallet({
  did8004: 'did:8004:11155111:1234',
  chain: sepolia,
  accountClient: myAccountClient,
  onStatusUpdate: (msg) => console.log(msg),
});
```

### `parseDid8004`

Custom implementation of `parseDid8004` that can be customized for ITG project needs.

**Signature:**
```typescript
export function parseDid8004(did8004: string): { chainId: number; agentId: bigint }
```

## Customization Guide

### Customizing Validator Account Creation

To customize how validator accounts are created in `prepareValidationRequestCore`, modify the section marked with `// CUSTOMIZE THIS SECTION FOR ITG PROJECT`:


// Option 2: Create validator account abstraction
const { createValidatorAccountAbstraction } = await import('../../server/lib/validations');
const { address } = await createValidatorAccountAbstraction(
  validatorName,
  validatorPrivateKey,
  parsed.chainId,
);
validatorAddress = address;
```

### Customizing Error Handling

The `requestValidationWithWallet` function includes custom error handling. You can extend this to handle additional error cases:

```typescript
catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Add your custom error handling here
  if (errorMessage.includes('your-custom-error')) {
    throw new ValidationApiError('Your custom error message', 400);
  }
  
  // ... existing error handling
}
```

## Types

### `AgentOperationPlan`

The return type for `prepareValidationRequestCore`, containing the prepared transaction plan:

```typescript
interface AgentOperationPlan {
  success: boolean;
  operation: 'create' | 'update';
  mode: 'aa' | 'eoa';
  chainId: number;
  bundlerUrl?: string;
  calls?: Array<{ to: string; data: string; value: string }>;
  transaction?: { /* ... */ };
  metadata?: Record<string, unknown>;
}
```

### `ValidationRequestOptions`

Options for `requestValidationWithWallet`:

```typescript
interface ValidationRequestOptions {
  did8004: string;
  chain: Chain;
  accountClient: any;
  onStatusUpdate?: (message: string) => void;
  requestUri?: string;
  requestHash?: string;
}
```

## Environment Variables

The following environment variables are used:


## Related

- [Agentic Trust Core Libraries](https://github.com/Agentic-Trust-Layer/agentic-trust)
- Reference implementation: `packages/core/src/validation/core.ts`

