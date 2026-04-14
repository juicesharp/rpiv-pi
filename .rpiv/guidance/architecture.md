# rpiv-pi

A Pi CLI plugin package that extends the Pi coding agent with TypeScript runtime tools, slash commands, and Markdown-based AI workflow skills.

# Architecture

```
rpiv-pi/
├── extensions/rpiv-core/   — Pi runtime extension: tools, commands, session hooks (TypeScript)
├── extensions/web-tools/   — web_search + web_fetch tools via Brave Search API (TypeScript)
├── scripts/                — migrate.js CLI for .rpiv/guidance/architecture.md → .rpiv/guidance/ migration
├── agents/                 — Named subagent profiles dispatched by skills (Markdown)
├── skills/                 — User-invocable AI workflow skills (Markdown)
└── thoughts/shared/        — Pipeline artifact store: questions/, research/, designs/, plans/, reviews/
```

Pi discovers extensions via `"extensions": ["./extensions"]` and skills via `"skills": ["./skills"]` in `package.json`.

Skill pipeline: `discover` → `research` → `design` → `plan` → `implement` → `validate`

# Commands

| Command | Description |
|---|---|
| `pi` | Start a Pi session with rpiv-pi loaded |
| `/skill:<name>` | Invoke a skill (e.g. `/skill:commit`, `/skill:discover`) |
| `/todos` | Show current todo list |
| `/advisor` | Configure advisor model + effort level |
| `/rpiv-update-agents` | Refresh `<cwd>/.pi/agents/` from bundled agent definitions |
| `/rpiv-setup` | Install missing sibling `@juicesharp/rpiv-*` and `@tintinweb/pi-subagents` plugins |

# Business Context

rpiv-pi augments the Pi agent with a research-design-implement skill pipeline and supporting tooling (guidance injection, advisor, todo tracking). Skills orchestrate named subagents in parallel; the extension provides the runtime tools those skills call.

<important if="you are adding a new end-to-end feature (tool + skill + agent)">
## Adding a Feature End-to-End
1. Runtime tool or command → see `.rpiv/guidance/extensions/rpiv-core/architecture.md`
2. Skill workflow → see `.rpiv/guidance/skills/architecture.md`
3. Named subagent (if the skill needs a new specialist) → see `.rpiv/guidance/agents/architecture.md`
</important>

<important if="you are modifying guidance injection behavior">
## Guidance Injection
`extensions/rpiv-core/guidance.ts` — single Pi delivery path. `pi.on("tool_call")` resolves per-depth at most one of `AGENTS.md > .rpiv/guidance/architecture.md > .rpiv/guidance/<sub>/architecture.md` (depth 0 skips AGENTS/CLAUDE — Pi's own resource-loader handles `<cwd>` already). Injects each new file via `pi.sendMessage({ display: false })`; in-process `Set` dedups across the session; cleared on `session_start`/`session_compact`/`session_shutdown`.
</important>
