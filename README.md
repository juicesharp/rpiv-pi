# rpiv-pi — Pi Package

A skill-based development workflow plugin for [Pi](https://github.com/badlogic/pi). Ports the rpiv-skillbased Claude Code plugin to Pi's extension and skill system.

## What's Included

### 🤖 Agents (9)
Specialized subagents for codebase research and analysis:
- `codebase-analyzer` — Analyzes HOW code works with file:line references
- `codebase-locator` — Finds WHERE files and components live
- `codebase-pattern-finder` — Finds examples of similar implementations
- `integration-scanner` — Discovers inbound/outbound dependencies
- `precedent-locator` — Finds what went wrong in similar past changes
- `test-case-locator` — Locates existing test cases
- `thoughts-analyzer` — Extracts insights from thoughts/ documents
- `thoughts-locator` — Discovers thoughts/ documents by topic
- `web-search-researcher` — Researches external documentation and resources

### 🧰 Skills (21)
Structured workflows invoked via `/skill:name`:
- **Research:** `research-codebase`, `research-questions`, `research`, `research-solutions`, `evaluate-research`
- **Design:** `design-feature`, `design-feature-iterative`
- **Planning:** `create-plan`, `write-plan`, `iterate-plan`, `validate-plan`
- **Implementation:** `implement-plan`
- **Testing:** `outline-test-cases`, `write-test-cases`
- **Review:** `code-review`
- **Git:** `commit`
- **Handoff:** `create-handoff`, `resume-handoff`
- **Annotations:** `annotate-guidance`, `annotate-inline`, `migrate-to-guidance`

### 🔌 Extension
A core extension providing:
- **`ask_user_question` tool** — Structured questions with selectable options (replaces Claude Code's `AskUserQuestion`)
- **`todo` tool** — Task tracking with add/toggle/list/clear (replaces Claude Code's `TaskCreate`/`TaskUpdate`)
- **Guidance injection** — Auto-injects `.rpiv/guidance/*/architecture.md` context when reading/editing files
- **Git context injection** — Injects branch/commit info before each agent turn
- **`thoughts/` directory scaffolding** — Creates the artifact chain directories on session start
- **Session lifecycle management** — Cleans up state on compact/shutdown

## Installation

```bash
# 1. Install rpiv-pi itself
pi install ./path/to/rpiv-pi

# 2. Start a Pi session and run the setup command
/rpiv-setup
#   Confirms, then installs the sibling Pi packages rpiv-pi depends on:
#     • @tintinweb/pi-subagents      (required — Agent tool + /agents command)
#     • pi-permission-system         (recommended — rules enforcement)

# 3. Restart your session so the new extensions load
```

`/rpiv-setup` is idempotent — running it when everything is already installed
prints a one-line "already installed" message. If `@tintinweb/pi-subagents`
is missing on session start, rpiv-core emits a warning telling you to run
`/rpiv-setup`. Without that package, the `Agent` / `get_subagent_result` /
`steer_subagent` tools and the `/agents` command are not registered at all
(Pi core ships no built-in subagent system), and every rpiv-pi skill that
dispatches a named agent will fail with an unknown-tool error.

### Manual install (no interactive session)

If you prefer to skip `/rpiv-setup`:

```bash
pi install npm:@tintinweb/pi-subagents
pi install npm:pi-permission-system
pi install ./path/to/rpiv-pi
```

## Usage

```bash
# Invoke a skill
/skill:research-codebase How does the auth pipeline work?
/skill:design-feature Add SSO support
/skill:implement-plan thoughts/shared/plans/2026-04-10_sso.md

# Agents are available to the subagent tool
# (requires the subagent extension)
```

## Migration Status

| Component | Status | Notes |
|-----------|--------|-------|
| Extension skeleton | ✅ Ready | Core hooks, tools, session lifecycle |
| Agent `.md` files | ✅ Ready | Frontmatter updated for Pi |
| Skill SKILL.md files | 🔄 Placeholder | Need `$ARGUMENTS`/`AskUserQuestion`/`Glob` replacements |
| Skill templates/examples | 📋 To copy | Copy from source after skills are migrated |
| Web tools (web_search/web_fetch) | 📋 Stub | Needs HTTP API integration |

See the [migration guide](thoughts/MIGRATION.md) for details.
