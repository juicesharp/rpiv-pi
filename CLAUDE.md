# rpiv-pi

A Pi CLI plugin package that extends the Pi coding agent with TypeScript runtime tools, slash commands, and Markdown-based AI workflow skills.

# Architecture

```
rpiv-pi/
├── extensions/rpiv-core/   — Pi runtime extension: tools, commands, session hooks (TypeScript)
├── extensions/web-tools/   — web_search + web_fetch tools via Brave Search API (TypeScript)
├── scripts/                — migrate.js CLI + Claude Code hooks delivery for .rpiv/guidance/
├── agents/                 — Named subagent profiles dispatched by skills (Markdown)
├── skills/                 — User-invocable AI workflow skills (Markdown)
└── thoughts/shared/        — Pipeline artifact store: questions/, research/, designs/, plans/, reviews/
```

Pi discovers extensions via `"extensions": ["./extensions"]` and skills via `"skills": ["./skills"]` in `package.json`.

Skill pipeline: `research-questions` → `research` → `design` → `write-plan` → `implement-plan` → `validate-plan`

# Commands

| Command | Description |
|---|---|
| `pi` | Start a Pi session with rpiv-pi loaded |
| `/skill:<name>` | Invoke a skill (e.g. `/skill:commit`, `/skill:research-questions`) |
| `/todos` | Show current todo list |
| `/advisor` | Configure advisor model + effort level |
| `/rpiv-update-agents` | Refresh `<cwd>/.pi/agents/` from bundled agent definitions |
| `/rpiv-setup` | Seed `~/.pi/agent/pi-permissions.jsonc` if absent |

# Business Context

rpiv-pi augments the Pi agent with a research-design-implement skill pipeline and supporting tooling (guidance injection, advisor, todo tracking). Skills orchestrate named subagents in parallel; the extension provides the runtime tools those skills call.

<important if="you are adding a new end-to-end feature (tool + skill + agent)">
## Adding a Feature End-to-End
1. Runtime tool or command → see `extensions/rpiv-core/CLAUDE.md`
2. Skill workflow → see `skills/CLAUDE.md`
3. Named subagent (if the skill needs a new specialist) → see `agents/CLAUDE.md`
</important>

<important if="you are modifying guidance injection behavior">
## Guidance Injection Paths
Two delivery paths for `.rpiv/guidance/` shadow tree injection:
- **Pi extension** (active): `extensions/rpiv-core/guidance.ts` — in-process, session-scoped `Set` deduplication; injected via `pi.sendMessage({ display: false })`
- **Claude Code hooks** (alternate, not yet well battle-tested): `scripts/handlers/` — filesystem marker deduplication; injected via stdout `additionalContext`

CLAUDE.md files in Claude Code are resolved automatically — no hooks needed for that format.
</important>
