# agents/

## Responsibility
Named subagent profile library — isolated, single-purpose LLM workers dispatched by skills via the `Agent` tool. Each performs one narrow task (locate, analyze, connect, or fetch externally) and returns structured text. Agents never write files, dispatch other agents, or modify state.

At session start, `extensions/rpiv-core/agents.ts` syncs bundled `.md` files to `<cwd>/.pi/agents/` — adding new files and detecting outdated or removed agents (detect-only, no overwrite). Use `/rpiv-update-agents` to apply full sync: add new, update changed, remove stale managed files.

## Dependencies
- **`@tintinweb/pi-subagents`** (sibling plugin): provides the `Agent` tool and subagent dispatch runtime; without it, skills fall back silently to `general-purpose`

## Consumers
Skills only — agents are never user-invoked:
```yaml
Agent(subagent_type: "codebase-analyzer", prompt: "Analyze src/services/ in detail. …")
```

## Module Structure
```
codebase-locator.md, integration-scanner.md, test-case-locator.md, thoughts-locator.md
  — Locators: grep/find/ls only; report WHERE, never read file contents
codebase-analyzer.md, thoughts-analyzer.md, codebase-pattern-finder.md
  — Analyzers: + read; understand HOW; include ultrathink directive in strategy
precedent-locator.md    — Git history mining: + bash (git commands only; `@tintinweb/pi-subagents` provides the Agent dispatch runtime)
web-search-researcher.md — External research: + web_search, web_fetch (tools provided by `@juicesharp/rpiv-web-tools`)
```

## Agent Definition Pattern

```markdown
---
name: codebase-locator       # matches filename stem exactly; used as subagent_type: value
description: "What it finds. Call when [trigger]. [Contrast with nearest sibling agent]."
tools: grep, find, ls        # allowlist only; add read for content; bash only for git
---

You are a specialist at [ONE action + domain]. Your job is to [primary output], NOT to [sibling's job].

## Core Responsibilities
1. **Verb Title**: 3-5 imperative bullets

## [Search/Analysis] Strategy
### Step 1: [Action]

## Output Format

[Fenced block with realistic filled-in example — NOT an abstract schema.
Prefix with "CRITICAL: Use EXACTLY this format." if machine-parsed downstream.]

## What NOT to Do
- Don't [sibling agent's job] — that's [sibling-name]'s role

Remember: You're a [identity noun]. [One sentence on what success looks like for a caller].
```

**Tool set determines capability tier:**
- `grep, find, ls` only → locator (WHERE — no file content access)
- `+ read` → analyzer (HOW — full content understanding; use `ultrathink` in strategy)
- `+ bash` → only `precedent-locator` (git read-only commands)
- `+ web_search, web_fetch` → only `web-search-researcher`

## Architectural Boundaries
- **NO agent dispatches another agent** — no `Agent` tool in any allowlist
- **NO write or edit** — all agents are strictly read-only; `bash` is for git reads only
- **Locators have no `read`** — this is the load-bearing distinction; `codebase-locator` reports paths, `codebase-analyzer` reads them

<important if="you are adding a new agent to this layer">
## Adding a New Agent
1. Choose the capability tier — tool set flows directly from whether the agent locates, reads, uses git, or fetches from web
2. Name the file `kebab-case.md`; `name` frontmatter field must match the filename stem exactly
3. Frontmatter has exactly three fields: `name`, `description`, `tools`; `description` addresses the caller ("Use when…"), not the agent itself
4. Opening sentence: "You are a specialist at X. Your job is to Y, NOT to Z." — Z names the adjacent/sibling agent
5. Include `## What NOT to Do` and a closing `Remember:` sentence in every agent
6. Output Format section: one fenced block with realistic filled-in example; prefix with `CRITICAL: Use EXACTLY this format.` if downstream code parses the output
7. If the agent depends on external state (e.g., git), add a `## Pre-flight` check with an explicit fallback output block
8. The file is auto-synced to `<cwd>/.pi/agents/` at session start — no registration step needed. `/rpiv-update-agents` applies full sync including new agents
</important>
