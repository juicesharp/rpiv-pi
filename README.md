# rpiv-pi

Skill-based development workflow for Pi — research, design, plan, implement, review.

Version: 0.4.0

## Requirements

All dependencies are peer-dependencies — expected to be installed in the Pi environment.

### Runtime libraries
- `@mariozechner/pi-coding-agent` — the Pi CLI runtime
- `@mariozechner/pi-ai`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`

### Sibling Pi plugins (hard-required)
- `@tintinweb/pi-subagents` — provides the `Agent` tool and the `/agents` command. Without it, every rpiv-pi skill that dispatches a named subagent silently falls back to `general-purpose`.
- `@juicesharp/rpiv-ask-user-question` — provides the `ask_user_question` tool.
- `@juicesharp/rpiv-todo` — provides the `todo` tool, `/todos` command, and overlay widget.
- `@juicesharp/rpiv-advisor` — provides the `advisor` tool and `/advisor` command.
- `@juicesharp/rpiv-web-tools` — provides the `web_search` and `web_fetch` tools and `/web-search-config` command.

rpiv-pi emits an aggregated warning on session start listing any missing siblings, and `/rpiv-setup` installs them all in one go.

## Installation

```bash
pi install /Users/sguslystyi/rpiv-pi
```

Then from inside a Pi session, install all siblings in one go:

```
/rpiv-setup
```

Or install them manually:

```bash
pi install npm:@tintinweb/pi-subagents
pi install npm:@juicesharp/rpiv-ask-user-question
pi install npm:@juicesharp/rpiv-todo
pi install npm:@juicesharp/rpiv-advisor
pi install npm:@juicesharp/rpiv-web-tools
```

After the first install of `@juicesharp/rpiv-web-tools`, set the Brave Search API key from inside a Pi session:

```
/web-search-config
```

On first session start in any project, rpiv-pi auto-copies agent files to `<cwd>/.pi/agents/`.

## What's included

### Extension in this package

| Extension | Tools | Commands | Session hooks |
|-----------|-------|----------|---------------|
| `rpiv-core` | — | `/rpiv-update-agents`, `/rpiv-setup` | `session_start`, `session_compact`, `session_shutdown`, `tool_call`, `before_agent_start` |

Tool-owning plugins are shipped separately — see the Requirements section above.

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

## Migration from 0.3.x

Users upgrading from rpiv-pi 0.3.x need to install the four extracted sibling plugins. The fastest path:

1. `pi install <path-to-rpiv-pi>@0.4.0`
2. Start a Pi session.
3. Run `/rpiv-setup` and confirm.
4. Restart the session.

Saved configuration at `~/.config/rpiv-pi/advisor.json` and `~/.config/rpiv-pi/web-tools.json` is no longer read. Re-run `/advisor` and `/web-search-config` once after installing their respective sibling plugins. The `BRAVE_SEARCH_API_KEY` env var continues to work unchanged.

## Notes

- Agent files live at `<cwd>/.pi/agents/` and are editable; `/rpiv-update-agents` refreshes them from the bundled defaults.
- Artifacts written by skills land under `thoughts/shared/{research,questions,designs,plans,handoffs,reviews,solutions}/` in the current project.
- `@tintinweb/pi-subagents` defaults to 4 concurrent background agents per session; raise it per-session via `/agents → Settings → Max concurrency → 48` if skills stall on wide fan-outs.
