# Database Layer Architecture

## Responsibility
SQLite persistence with better-sqlite3, repository pattern (plain types), QueryQueue concurrency, type transformations.

## Dependencies
- **better-sqlite3**: Native SQLite (requires rebuild for Electron)
- **@redis-ui/core**: Domain types
- **p-queue**: Query serialization

## Consumers
- **@redis-ui/services**: Repositories via RepositoryFactory
- **Main process**: DatabaseManager initialization

## Module Structure
```
src/
├── DatabaseManager.ts, QueryQueue.ts   # Singleton, concurrency
├── BaseRepository.ts, RepositoryFactory.ts
├── schema.ts
└── repositories/                        # One repo per entity
```

## Repository Boundary (CRITICAL: Plain Types, NOT Result<T>)

```typescript
export class ConnectionRepository extends BaseRepository<ConnectionDB, Connection, ConnectionId> {
  protected toApplication(db: ConnectionDB): Connection {
    return {
      id: ConnectionId.create(db.id),
      host: db.host,
      port: db.port,
      sslEnabled: Boolean(db.ssl_enabled),     // DB int → boolean
      createdAt: new Date(db.created_at),      // timestamp → Date
    };
  }

  async findById(id: ConnectionId): Promise<Connection | null> {
    return this.queue.enqueueRead((db) => {
      const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
      return row ? this.toApplication(row) : null;
    });
  }
}

// Service: Wraps repository in Result<T>
async createConnection(input: CreateInput): Promise<Result<Connection>> {
  try {
    const connection = await this.connectionRepo.create(input);
    return Result.ok(connection);
  } catch (error) {
    return Result.fail(new InfrastructureError(error.message));
  }
}
```

## QueryQueue Pattern (Write Serialization)

```typescript
export class QueryQueue {
  private writeQueue = new PQueue({ concurrency: 1 }) // Single writer
  private readQueue = new PQueue({ concurrency: 5 })  // Multiple readers

  async enqueueWrite<T>(op: (db: Database) => T): Promise<T> {
    return this.writeQueue.add(() => op(this.db))
  }
}
```

## Architectural Boundaries
- **NO Result<T> in repos**: Services wrap with Result
- **NO unqueued DB ops**: Always use QueryQueue
- **NO raw SQL in services**: Use repositories

<important if="you are adding a new repository to this layer">
## Adding a New Repository
1. Create `XRepository.ts` extending `BaseRepository<XDB, X, XId>`
2. Implement `toApplication()` and `toDatabase()` type mappers
3. Register in `RepositoryFactory`
4. Add table schema in `schema.ts`
</important>
