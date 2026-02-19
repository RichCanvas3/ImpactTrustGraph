## @my-scope/core

React 18-ready core components and hooks for the `arr` monorepo.

### Installation

Using pnpm:

```bash
pnpm add @my-scope/core react react-dom
```

Using npm:

```bash
npm install @my-scope/core react react-dom
```

### Usage

```tsx
import * as React from "react";
import { HelloMessage, useToggle } from "@my-scope/core";

export function Example() {
  const { on, toggle } = useToggle(false);

  return (
    <div>
      <HelloMessage name="Developer" />
      <button type="button" onClick={toggle}>
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}
```

### Development

From the monorepo root:

```bash
pnpm install
pnpm build       # builds all workspace packages, including @my-scope/core
pnpm test        # runs tests in all workspaces (Vitest)
pnpm lint        # runs ESLint in all workspaces
pnpm format      # checks formatting in all workspaces
```

From this package directory (`packages/core`):

```bash
pnpm build
pnpm test
pnpm lint
pnpm format
```

### Build

This library is built with `tsup` and outputs:

- CommonJS: `dist/index.cjs`
- ES module: `dist/index.esm.js`
- Type declarations: `dist/index.d.ts`

### License

MIT (inherited from the root repo).


