# CLAUDE.md

Express API + React frontend in a Turborepo monorepo.

## Project map

- `apps/api/` - Express REST API
- `apps/web/` - React SPA
- `packages/db/` - Prisma schema and client
- `packages/ui/` - Shared component library
- `packages/config/` - Shared configuration

## Commands

| Command | What it does |
|---|---|
| `turbo build` | Build all packages |
| `turbo test` | Run all tests |
| `turbo lint` | Lint all packages |
| `turbo dev` | Start dev server |
| `turbo db:generate` | Regenerate Prisma client after schema changes |
| `turbo db:migrate` | Run database migrations |

<important if="you are adding or modifying API routes">
- All routes go in `apps/api/src/routes/`
- Use Zod for request validation — see `apps/api/src/routes/connections.ts` for the pattern
- Error responses follow RFC 7807 format
- Authentication via JWT middleware
</important>

<important if="you are writing or modifying tests">
- API: Jest + Supertest, Frontend: Vitest + Testing Library
- Test fixtures in `__fixtures__/` directories
- Use `createTestClient()` helper for API integration tests
- Mock database with `prismaMock` from `packages/db/test`
</important>

<important if="you are working with client-side state, stores, or data fetching">
- Zustand for global client state
- React Query for server state
- URL state via `nuqs`
</important>
