# rpiv-pi

A Pi CLI plugin package that extends the Pi coding agent with TypeScript runtime infrastructure, two slash commands, and Markdown-based AI workflow skills.

# Architecture

```
rpiv-pi/
├── extensions/rpiv-core/   — Pi runtime extension: session hooks, /rpiv-* commands (TypeScript)
├── scripts/                — migrate.js CLI for legacy .rpiv/guidance/architecture.md migration
├── agents/                 — Named subagent profiles dispatched by skills (Markdown)
├── skills/                 — User-invocable AI workflow skills (Markdown)
└── thoughts/shared/        — Pipeline artifact store: questions/, research/, designs/, plans/, reviews/, handoffs/
```

Pi discovers extensions via `"extensions": ["./extensions"]` and skills via `"skills": ["./skills"]` in `package.json`.

Tools live in sibling plugins — `rpiv-pi` registers zero tools. Install missing siblings via `/rpiv-setup`.

Skill pipeline: `discover` → `research` → `design` → `plan` → `implement` → `validate`

# Commands

| Command | Description |
|---|---|
| `pi` | Start a Pi session with rpiv-pi loaded |
| `/skill:<name>` | Invoke a skill (e.g. `/skill:commit`, `/skill:discover`) |
| `/rpiv-update-agents` | Refresh `<cwd>/.pi/agents/` from bundled agent definitions |
| `/rpiv-setup` | Install missing sibling plugins |

Sibling-plugin commands (`/todos`, `/advisor`, `/web-search-config`) are registered by the siblings themselves once installed — see each sibling's README.

# Business Context

rpiv-pi augments the Pi agent with a research → design → implement skill pipeline and the runtime infrastructure those skills depend on: guidance injection, git-context injection, `thoughts/` scaffolding, and bundled-agent sync. Tool surfaces (ask_user_question, todo, advisor, web tools, subagents) live in sibling plugins.

<important if="you are adding a new end-to-end feature (skill + agent)">
## Adding a Feature End-to-End
1. Skill workflow → see `.rpiv/guidance/skills/architecture.md`
2. Named subagent (if the skill needs a new specialist) → see `.rpiv/guidance/agents/architecture.md`
3. Runtime infrastructure (session hooks, commands) → see `.rpiv/guidance/extensions/rpiv-core/architecture.md`

New tools belong in sibling plugins, not here — `rpiv-pi` is pure infrastructure.
</important>

<important if="you are modifying guidance injection behavior">
## Guidance Injection
`extensions/rpiv-core/guidance.ts` — single Pi delivery path. On `tool_call` for `read`/`edit`/`write`, resolves per-depth at most one of `AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/architecture.md` (depth 0 skips AGENTS/CLAUDE — Pi's own resource-loader handles `<cwd>` already). Injects each new file via `pi.sendMessage({ display: false })`; an in-process `Set` dedups across the session; cleared on `session_start`/`session_compact`/`session_shutdown`.
</important>
