# rpiv-pi

Skill-based development workflow for Pi — research, design, plan, implement, review.

Version: 0.3.0

## Requirements

Peer dependencies (expected to be installed in the Pi environment):

- `@mariozechner/pi-coding-agent` — the Pi CLI runtime
- `@mariozechner/pi-ai`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`

Direct dependency, declared in `package.json`:

- `@tintinweb/pi-subagents ^0.5.2` — provides the `Agent` tool and the `/agents` command. Without it, every rpiv-pi skill that dispatches a named subagent silently falls back to `general-purpose`.

Recommended, separate install:

- `pi-permission-system` — enforces the permission rules in `~/.pi/agent/pi-permissions.jsonc`. rpiv-pi seeds this file with sensible defaults on first session start but does not enforce them itself.

## Installation

```bash
pi install /Users/sguslystyi/rpiv-pi
```

```bash
pi install npm:pi-permission-system
```

From inside a Pi session (one-time, sets the Brave Search API key used by `web_search`):

```
/web-search-config
```

On first session start in any project, rpiv-pi auto-copies 9 agent files to `<cwd>/.pi/agents/` and seeds `~/.pi/agent/pi-permissions.jsonc` if missing.

## What's included

### Extensions (2)

| Extension | Tools | Commands | Session hooks |
|-----------|-------|----------|---------------|
| `rpiv-core` | `ask_user_question`, `todo` | `/todos`, `/rpiv-update-agents`, `/rpiv-setup` | `session_start`, `session_tree`, `session_compact`, `session_shutdown`, `tool_call`, `before_agent_start` |
| `web-tools` | `web_search`, `web_fetch` | `/web-search-config` | — |

### Skills (17)

Invoke via `/skill:<name>` from inside a Pi session.

| Skill | Description |
|---|---|
| `annotate-guidance` | Generate architecture.md guidance files in `.rpiv/guidance/` by analyzing architecture and patterns in parallel. |
| `annotate-inline` | Generate CLAUDE.md files across a project by analyzing architecture and patterns in parallel. |
| `code-review` | Conduct comprehensive code reviews by analyzing changes in parallel. |
| `commit` | Create structured git commits grouped by logical change. |
| `create-handoff` | Create context-preserving handoff documents for session transitions. |
| `design` | Design features through iterative vertical-slice decomposition with developer micro-checkpoints. Accepts research or solutions artifacts. |
| `implement-plan` | Execute approved implementation plans phase by phase. |
| `iterate-plan` | Update existing implementation plans based on feedback. |
| `migrate-to-guidance` | Migrate existing CLAUDE.md files to the `.rpiv/guidance/` system. |
| `outline-test-cases` | Discover testable features and create a folder outline under `.rpiv/test-cases/` with per-feature metadata. |
| `research` | Answer structured research questions via targeted parallel analysis agents. |
| `research-questions` | Generate trace-quality research questions from codebase discovery. |
| `research-solutions` | Analyze solution options for features or changes with pros/cons. |
| `resume-handoff` | Resume work from a handoff document. |
| `validate-plan` | Verify that an implementation plan was correctly executed. |
| `write-plan` | Create phased implementation plans from design artifacts. |
| `write-test-cases` | Generate manual test case specifications for a single feature by analyzing code in parallel. |

### Agents (9)

Dispatched via the `Agent` tool (provided by `@tintinweb/pi-subagents`) with `subagent_type: "<name>"`.

| Agent | Purpose |
|---|---|
| `codebase-analyzer` | Analyzes codebase implementation details for specific components. |
| `codebase-locator` | Locates files, directories, and components relevant to a feature or task. |
| `codebase-pattern-finder` | Finds similar implementations, usage examples, and existing patterns with concrete code. |
| `integration-scanner` | Finds inbound references, outbound dependencies, config registrations, and event subscriptions. |
| `precedent-locator` | Finds similar past changes in git history — commits, blast radius, follow-up fixes. |
| `test-case-locator` | Finds existing manual test cases in `.rpiv/test-cases/` and reports coverage stats. |
| `thoughts-analyzer` | Deep-dive analysis on research topics in `thoughts/`. |
| `thoughts-locator` | Discovers relevant documents in the `thoughts/` directory by topic. |
| `web-search-researcher` | Researches web-based information and modern documentation via `web_search` / `web_fetch`. |

## Typical workflow

```
/skill:research-questions "how does X work"
/skill:research thoughts/shared/questions/<latest>.md
/skill:design thoughts/shared/research/<latest>.md
/skill:write-plan thoughts/shared/designs/<latest>.md
/skill:implement-plan thoughts/shared/plans/<latest>.md Phase <N>
```

## Notes

- Agent files live at `<cwd>/.pi/agents/` and are editable; `/rpiv-update-agents` refreshes them from the bundled defaults.
- Artifacts written by skills land under `thoughts/shared/{research,questions,designs,plans,handoffs,reviews,solutions}/` in the current project.
- `@tintinweb/pi-subagents` defaults to 4 concurrent background agents per session; raise it per-session via `/agents → Settings → Max concurrency → 48` if skills stall on wide fan-outs.
