```markdown
# Project Overview
[1-2 sentences: what it is, tech stack]

# Architecture
[monorepo structure tree + dependency flow diagram]
[process architecture if applicable]

# Commands
[key commands table — always bare, never wrapped in <important if>]

# Business Context
[1-2 sentences if applicable]
```

The sections above (Overview, Architecture, Commands, Business Context) are foundational — they stay bare because they're relevant to virtually every task.

Cross-cutting patterns and domain-specific conventions go in `<important if>` blocks with narrow, action-specific conditions. Do NOT group unrelated rules under a single broad condition like "you are writing or modifying code". Instead, shard by trigger.

Root conditional blocks are for **cross-cutting conventions that don't belong to any single layer**. Layer-specific recipes (like "adding a new controller" or "adding a new repository") belong in the subfolder CLAUDE.md, not the root.

**Deduplication rule:** If a layer has its own subfolder CLAUDE.md, do NOT add a root conditional block summarizing that layer's conventions. The subfolder file is the authoritative guide — the agent will see it when working in that directory. Root conditionals that mirror subfolder content waste attention budget and create staleness risk.

Root MAY include cross-layer vertical-slice checklists (e.g., "adding a new domain entity end-to-end") that reference multiple subfolder CLAUDE.md files — but each step should point to the relevant subfolder for details, not inline them.

Good root conditions — things that span multiple layers:

```markdown
<important if="you are writing or modifying tests">
- Unit: xUnit + NSubstitute / Jest + Testing Library
- Integration: WebApplicationFactory / Supertest
- Test fixtures in `__fixtures__/` or `tests/Fixtures/`
</important>

<important if="you are adding or modifying database migrations">
- Never modify existing migrations — always create new ones
- Run `dotnet ef migrations add` / `turbo db:migrate` after schema changes
</important>

<important if="you are adding or modifying environment configuration">
- All config via `IOptions<T>` pattern / environment variables
- Secrets in user-secrets locally, Key Vault in production
</important>
```

Each block should contain only rules that share the same trigger condition. If a codebase has 3 distinct convention areas, that's 3 blocks — not 1 block with a broad condition. Layer-specific checklists (adding a controller, adding a repository) go in the subfolder CLAUDE.md using `<important if="you are adding a new [entity] to this layer">`.
