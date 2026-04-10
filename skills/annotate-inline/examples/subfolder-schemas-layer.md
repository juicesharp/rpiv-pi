# Schemas Layer Architecture

## Responsibility
Zod validation schemas for dual-layer validation (preload UX + main security), type inference via z.infer<>.

## Dependencies
- **zod**: Runtime validation

## Consumers
- **@redis-ui/ipc**: Main process validation (security)
- **Preload**: Fail-fast validation (UX)
- **TypeScript**: Type inference

## Module Structure
```
src/
├── connection.ts, backup.ts    # Domain schemas
└── __tests__/                  # Validation tests
```

## Complete Schema Pattern (Types + Validation + Composition)

```typescript
export const createConnectionSchema = z.object({
  name: z.string().min(1).max(255),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  password: z.string().optional(),
  database: z.number().int().min(0).max(15).default(0),
})

// Type inference
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>

// Update schema (partial + ID required)
export const updateConnectionSchema = createConnectionSchema.partial().extend({
  id: z.string().min(1)
})
```

## Dual-Validation Flow

```
Renderer input → Preload (Zod parse, fail fast) → IPC → Main (Zod parse again, security)
```

## Architectural Boundaries
- **NO any types**: Use z.unknown()
- **NO skipping validation**: Always validate at boundaries
- **NO business logic**: Structure validation only
