# Monorepo Structure Rules

This is a pnpm-based monorepo with separate `apps` and `packages` workspaces.

## Structure
- **Root**: pnpm workspace and shared configuration
- **`apps/`**: application projects
  - `itg`: Main Next.js web application for agent discovery and management
  - `impact-agent`: A2A (Agent-to-Agent) endpoints provider
- **`packages/`**: shared libraries and utilities
  - `core`: Core utilities and A2A server helpers

## Workspace Dependencies
- Use `workspace:*` for internal package references
- Always use pnpm for package management
- Run commands from root with `pnpm -r <command>` to run across all workspaces

## Import Paths
- Internal packages: `@my-scope/core`, `@my-scope/itg`, `@my-scope/impact-agent`
- External packages: Use exact versions from package.json

