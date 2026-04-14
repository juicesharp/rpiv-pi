# rpiv-pi

[![npm version](https://img.shields.io/npm/v/@juicesharp/rpiv-pi.svg)](https://www.npmjs.com/package/@juicesharp/rpiv-pi)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Skill-based development workflow for [Pi](https://github.com/badlogic/pi-mono) — research, design, plan, implement, review. rpiv-pi extends the Pi coding agent with a pipeline of chained AI skills, named subagents for parallel analysis, and session lifecycle hooks for automatic context injection.

## Prerequisites

- **[Pi CLI](https://github.com/badlogic/pi-mono)** — the `pi` command must be available
- **Node.js** — required by Pi
- **git** *(recommended)* — rpiv-pi works without it, but branch and commit context won't be available to skills

## Quick Start

1. Install rpiv-pi:

```bash
pi install npm:@juicesharp/rpiv-pi
```

2. Start a Pi session and install sibling plugins:

```
/rpiv-setup
```

3. Restart your Pi session.

4. *(Optional)* Configure web search:

```
/web-search-config
```

### First Session

On first session start, rpiv-pi automatically:
- Copies agent profiles to `<cwd>/.pi/agents/`
- Scaffolds `thoughts/shared/` directories for pipeline artifacts
- Shows a warning if any sibling plugins are missing

## Usage

### Typical Workflow

```
/skill:research-questions "how does X work"
/skill:research thoughts/shared/questions/<latest>.md
/skill:design thoughts/shared/research/<latest>.md
/skill:write-plan thoughts/shared/designs/<latest>.md
/skill:implement-plan thoughts/shared/plans/<latest>.md Phase <N>
```

Each skill produces an artifact consumed by the next. Run them in order, or jump in at any stage if you already have the input artifact.

### Skills

Invoke via `/skill:<name>` from inside a Pi session.

#### Research & Design

| Skill | Input | Output | Description |
|---|---|---|---|
| `research-questions` | — | `thoughts/shared/questions/` | Generate research questions from codebase discovery |
| `research` | Questions artifact | `thoughts/shared/research/` | Answer questions via parallel analysis agents |
| `research-solutions` | — | `thoughts/shared/solutions/` | Compare solution approaches with pros/cons |
| `design` | Research or solutions artifact | `thoughts/shared/designs/` | Design features via vertical-slice decomposition |

#### Implementation

| Skill | Input | Output | Description |
|---|---|---|---|
| `write-plan` | Design artifact | `thoughts/shared/plans/` | Create phased implementation plans |
| `implement-plan` | Plan artifact | Code changes | Execute plans phase by phase |
| `iterate-plan` | Plan artifact | Updated plan | Revise plans based on feedback |
| `validate-plan` | Plan artifact | Validation report | Verify plan execution |

#### Testing

| Skill | Input | Output | Description |
|---|---|---|---|
| `outline-test-cases` | — | `.rpiv/test-cases/` | Discover testable features with per-feature metadata |
| `write-test-cases` | Outline metadata | Test case specs | Generate manual test specifications |

#### Annotation

| Skill | Input | Output | Description |
|---|---|---|---|
| `annotate-guidance` | — | `.rpiv/guidance/*.md` | Generate architecture guidance files |
| `annotate-inline` | — | `CLAUDE.md` files | Generate inline documentation |
| `migrate-to-guidance` | CLAUDE.md files | `.rpiv/guidance/` | Convert inline docs to guidance format |

#### Utilities

| Skill | Description |
|---|---|
| `code-review` | Comprehensive code reviews analyzing changes in parallel |
| `commit` | Structured git commits grouped by logical change |
| `create-handoff` | Context-preserving handoff documents for session transitions |
| `resume-handoff` | Resume work from a handoff document |

### Commands

| Command | Description |
|---|---|
| `/rpiv-setup` | Install all sibling plugins in one go |
| `/rpiv-update-agents` | Refresh agent profiles from bundled defaults |
| `/advisor` | Configure advisor model and reasoning effort |
| `/todos` | Show current todo list |
| `/web-search-config` | Set Brave Search API key |

### Agents

Agents are dispatched automatically by skills via the `Agent` tool — you don't invoke them directly.

| Agent | Purpose |
|---|---|
| `codebase-analyzer` | Analyzes implementation details for specific components |
| `codebase-locator` | Locates files and components relevant to a task |
| `codebase-pattern-finder` | Finds similar implementations and usage patterns |
| `integration-scanner` | Maps inbound references, outbound deps, and config wiring |
| `precedent-locator` | Finds similar past changes in git history |
| `test-case-locator` | Finds existing test cases and reports coverage stats |
| `thoughts-analyzer` | Deep-dive analysis on research topics |
| `thoughts-locator` | Discovers relevant documents in the `thoughts/` directory |
| `web-search-researcher` | Researches web-based information and documentation |

## Architecture

```
rpiv-pi/
├── extensions/rpiv-core/   — runtime extension: hooks, commands, guidance injection
├── skills/                 — AI workflow skills (research → design → plan → implement)
├── agents/                 — named subagent profiles dispatched by skills
└── thoughts/shared/        — pipeline artifact store
```

Pi discovers extensions via `"extensions": ["./extensions"]` and skills via `"skills": ["./skills"]` in `package.json`.

## Configuration

- **Web search** — run `/web-search-config` to set the Brave Search API key, or set the `BRAVE_SEARCH_API_KEY` environment variable
- **Advisor** — run `/advisor` to select a reviewer model and reasoning effort
- **Agent concurrency** — `@tintinweb/pi-subagents` defaults to 4 concurrent agents; raise via `/agents → Settings → Max concurrency → 48` if skills stall on wide fan-outs
- **Agent profiles** — editable at `<cwd>/.pi/agents/`; refresh from bundled defaults with `/rpiv-update-agents`

## Upgrading from 0.3.x

Tool logic was extracted into sibling plugins in 0.4.0. After upgrading:

1. `pi install npm:@juicesharp/rpiv-pi`
2. Start a Pi session.
3. Run `/rpiv-setup` to install the four extracted plugins:
   - `@juicesharp/rpiv-ask-user-question`
   - `@juicesharp/rpiv-todo`
   - `@juicesharp/rpiv-advisor`
   - `@juicesharp/rpiv-web-tools`
4. Restart the session.
5. Re-run `/advisor` and `/web-search-config` — saved configuration at `~/.config/rpiv-pi/` is no longer read; each plugin now reads from its own config path.

The `BRAVE_SEARCH_API_KEY` environment variable continues to work unchanged.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Warning about missing siblings on session start | Sibling plugins not installed | Run `/rpiv-setup` |
| `/rpiv-setup` fails on a package | Network or registry issue | Check connection, retry with `pi install npm:<pkg>`, re-run `/rpiv-setup` |
| `/rpiv-setup` says "requires interactive mode" | Running in headless mode | Install manually: `pi install npm:<pkg>` for each sibling |
| `web_search` or `web_fetch` errors | Brave API key not configured | Run `/web-search-config` or set `BRAVE_SEARCH_API_KEY` |
| `advisor` tool not available after upgrade | Advisor model selection lost | Run `/advisor` to re-select a model |
| Skills hang or serialize agent calls | Agent concurrency too low | Raise via `/agents → Settings → Max concurrency → 48` |

## License

MIT
