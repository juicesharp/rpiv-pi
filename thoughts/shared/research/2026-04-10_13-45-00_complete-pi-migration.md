---
date: 2026-04-10T13:45:00Z
researcher: Claude Code
git_commit: no-commit
branch: no-branch
repository: rpiv-pi
topic: "Complete the rpiv-skillbased → Pi migration (skill text + infra gaps + web-tools + subagent wiring)"
tags: [research, migration, pi, subagent, tintinweb, web-tools, ask-user-question, todo-tool, skill-rewrite, rpiv-core, agent-discovery]
status: complete
last_updated: 2026-04-10
last_updated_by: Claude Code
---

# Research: Complete the rpiv-skillbased → Pi Migration

## Research Question

Plan next steps to complete the rpiv-skillbased → Pi migration. Eight concrete sub-questions from `thoughts/shared/questions/2026-04-10_08-45-32_complete-pi-migration.md`:

1. Which Pi subagent implementation to target — bundled `subagent` example vs `@tintinweb/pi-subagents@0.5.2`?
2. How to make the 9 agent `.md` files in `/Users/sguslystyi/rpiv-pi/agents/` discoverable, given `pi.agents` is a silent no-op?
3. Minimum viable web-tools extension shape, and where should it live?
4. Safest order/mechanism for ~240 Claude-Code-specific text replacements across 19 SKILL.md files?
5. What should `allowed-tools:` frontmatter become across the 11 skills still declaring it?
6. How to rewrite the inline YAML `AskUserQuestion:` teaching blocks into prose that teaches `ask_user_question` tool calls?
7. How to convert 14 `TaskCreate`/`TaskUpdate` references into `todo` tool instructions?
8. What end-to-end validation loop proves a migrated skill actually runs correctly against Pi?

## Summary

**Every architectural question has a concrete answer backed by code evidence. The scope is larger than MIGRATION.md suggested because three load-bearing surprises surfaced during the investigation:**

1. **The `rpiv-next:` prefix silently falls back to `general-purpose`.** Every one of the 14 skills that dispatches named agents today lands on the wrong subagent type. `@tintinweb/pi-subagents/src/index.ts:730-732` resolves unknown `subagent_type` values without warning: `const resolved = resolveType(rawType); const subagentType = resolved ?? "general-purpose";`. Stripping the prefix is mandatory; there is no namespacing in Pi.

2. **`pi.agents` is completely dead** — `package-manager.js:38` defines `RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"]` and `package-manager.js:1514` iterates only those four. The 9 agent files at `/Users/sguslystyi/rpiv-pi/agents/` have zero runtime effect today. `@tintinweb/pi-subagents` discovers agents only at `<cwd>/.pi/agents/*.md` (project) and `~/.pi/agent/agents/*.md` (global) via `custom-agents.ts:22-23`.

3. **The web-tools blocker is real for distribution but invisible in the current dev environment.** The user already has a private `~/.pi/agent/extensions/web-search/index.ts` that registers `web_search` at line 240 and `web_fetch` at line 380 with Tavily/Serper/Brave backends. It's the reason the agents directory appears to "almost work". For a distributable package this extension must be vendored or re-implemented.

**Target architecture (decided via developer checkpoint — see Developer Context):**

- **Subagent target: `@tintinweb/pi-subagents@0.5.2`** — vendored into `extensions/pi-subagents/` with its source copied from `/usr/local/lib/node_modules/@tintinweb/pi-subagents/src/`. Its tool is literally named `Agent`, runs subagents **in-process** (not subprocess) via `createAgentSession` + `DefaultResourceLoader` at `src/agent-runner.ts:236-244`, so `ask_user_question`/`todo` Just Work inside subagents by default (`extensions: true` is the default per `custom-agents.ts:60, 132-136`).
- **`pi-permission-system@0.4.1` vendored alongside** into `extensions/pi-permission-system/`. Both added to `package.json` `pi.extensions` manifest.
- **Web tools: new `extensions/web-tools/index.ts`** — copy `~/.pi/agent/extensions/web-search/index.ts` into the repo, strip Tavily/Serper, keep Brave only as the default backend, add a `/web-search-config` slash command to prompt for `BRAVE_SEARCH_API_KEY` via `ctx.ui.input()` and persist.
- **Agent discovery: auto-copy at `session_start`** — extend `extensions/rpiv-core/index.ts` with a handler that locates itself via `import.meta.url`, walks to the package root, and copies `<pkg>/agents/*.md` → `<cwd>/.pi/agents/*.md` if missing. Keep the `agents/` directory at its current location; delete the dead `pi.agents: ["./agents"]` field from `package.json:10`.
- **`ask_user_question` promptSnippet**: add `promptSnippet` + `promptGuidelines` fields to the `pi.registerTool` call at `extensions/rpiv-core/index.ts:169-229`, mirroring the `todo` tool pattern at lines 268-273. This eliminates 42 inline YAML block rewrites — skills get one-line prose nudges instead.
- **Execution plan: Plan B (canary-first)** — migrate `commit/SKILL.md` (83 lines, 7 total pattern hits) first, validate end-to-end, fix surprises, then apply the same sequence to `implement-plan/SKILL.md` (91 lines), then the heavy files (`create-plan` 492 lines, `design-feature-iterative` 532 lines).
- **`allowed-tools:` KEPT** as self-guidance for the running agent (Pi silently ignores it per `skills.js:211-251`, so it's harmless documentation — not enforceable without building the P3 gating extension).
- **`$ARGUMENTS` REWRITTEN as prose** ("If the user hasn't provided input, ask them for it") — because `agent-session.js:812-836` does NOT interpolate the token; user args arrive as a trailing paragraph after the skill body.

**Total pattern scope: 367 hits across 23 files** (see Code References and the Pattern Density Table below).

## Detailed Findings

### A. Subagent implementation target — `@tintinweb/pi-subagents` v0.5.2

**Confirmed: this is the only subagent system loaded in the user's environment today.** `/Users/sguslystyi/.pi/agent/settings.json:7` lists `npm:@tintinweb/pi-subagents` in its `packages` array. The bundled pi example at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/subagent/` is ship-as-example — its README at lines 32-53 explicitly instructs manual symlinking into `~/.pi/agent/extensions/subagent/` and is NOT auto-loaded.

**Tool name is literally `Agent`** (capital A) at `@tintinweb/pi-subagents/src/index.ts:553-554` with these parameters (TypeBox schema at lines 577-628):
- `prompt: string` (required) — the task for the subagent
- `description: string` (required, 3-5 words) — shown in UI
- `subagent_type: string` (required) — exact name match against `DEFAULT_AGENTS` or `.pi/agents/*.md` basenames
- `model?: string`, `thinking?: string`, `max_turns?: number`, `run_in_background?: boolean`, `resume?: string`, `isolated?: boolean`, `inherit_context?: boolean`, `isolation?: "worktree"` (all optional)

**Implication for skill text**: the 24 "Agent tool" prose references across 19 SKILL.md files are **already correct** — the tool IS named `Agent`. No rewrite needed for the tool name itself. Only the `rpiv-next:<name>` prefix inside `subagent_type` strings needs stripping.

**In-process execution model** at `src/agent-runner.ts:154-368`: unlike the bundled example which spawns `pi` child processes (`examples/extensions/subagent/index.ts:264-309`), tintinweb calls `createAgentSession` inside the parent process with a fresh `DefaultResourceLoader` at `agent-runner.ts:236-244`. Consequences:
- **rpiv-core tools (`ask_user_question`, `todo`) are visible inside subagents by default**. The child session re-runs `session.bindExtensions` (line 299-306) so `pi.registerTool` fires again for rpiv-core. Subagents can ask questions and track todos.
- **The child shares the parent's TUI instance** (there is only one terminal), so `ctx.ui.select`/`ctx.ui.input` prompts from inside a subagent land on the same terminal as the parent.
- **Per-agent exclusions exist**: `EXCLUDED_TOOL_NAMES = ["Agent","get_subagent_result","steer_subagent"]` at `agent-runner.ts:25` prevents subagents from spawning further subagents. Individual frontmatter fields (`disallowed_tools`, `extensions: false`, `isolated: true`) can narrow further.

**Default agents shipped in `src/default-agents.ts`**: `general-purpose` (all builtins, extensions:true, skills:true, promptMode append), `Explore` (read-only, forced model `claude-haiku-4-5`), `Plan` (read-only architect mode). Any custom `.md` file with matching name (case-insensitive via `resolveType` at `agent-types.ts:59-66`) overrides the defaults.

**Silent fallback bug** at `src/index.ts:730-732`:
```
const rawType = params.subagent_type as SubagentType;
const resolved = resolveType(rawType);
const subagentType = resolved ?? "general-purpose";
```
Unknown `subagent_type` values — including every `rpiv-next:codebase-locator` — return `undefined` from `resolveType` and fall through to `"general-purpose"` with zero diagnostic output. Today, 14 of 21 rpiv-pi skills are hitting this fallback.

**Dead code note**: `@tintinweb/pi-subagents/src/index.ts:433` has `pi.on("session_switch", ...)` — there is no `session_switch` event in Pi's event union (`types.d.ts:703-728`; the correct event is `session_before_switch` at line 704). This handler is a silent no-op — not relevant to our migration but worth knowing if upstream issues surface.

### B. Agent discovery blocker — `pi.agents` is a silent no-op

**Confirmed with direct code evidence**:

- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/package-manager.js:38` — `const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"];`
- `package-manager.js:1512-1518` — manifest iteration loop only iterates `RESOURCE_TYPES`
- `package-manager.js:1587-1599` — `readPiManifest` reads `pkg.pi` as an opaque object; any key outside the four resource types is silently ignored
- `loader.js:337` — the ONLY `manifest.*` read is `manifest.extensions`

A global grep across `@mariozechner/pi-coding-agent/dist/` and `@tintinweb/pi-subagents/src/` found ZERO references to `manifest.agents` or `pi.agents`. The field at `/Users/sguslystyi/rpiv-pi/package.json:10` is documentation-only.

**Where agents ARE loaded from** — `@tintinweb/pi-subagents/src/custom-agents.ts:21-28`:
```
const globalDir  = join(homedir(), ".pi", "agent", "agents");  // ~/.pi/agent/agents/*.md
const projectDir = join(cwd, ".pi", "agents");                  // <cwd>/.pi/agents/*.md
loadFromDir(globalDir,  agents, "global");   // lower priority
loadFromDir(projectDir, agents, "project");  // higher priority
```

Both directories were verified absent on the developer's machine: `/Users/sguslystyi/rpiv-pi/.pi/agents/` does not exist, `/Users/sguslystyi/.pi/agent/agents/` does not exist. **The only agent types currently registered are the three defaults** (`general-purpose`, `Explore`, `Plan`) from `src/default-agents.ts`.

**Decided fix**: rpiv-core's `session_start` handler will copy `<package-dir>/agents/*.md` → `<cwd>/.pi/agents/*.md` on first invocation if absent. The package dir is derivable from `import.meta.url` inside the ESM extension file. This keeps `agents/` as live documentation of what the package ships with.

**Frontmatter fields honored by tintinweb's loader** at `custom-agents.ts:52-75`: `name`, `display_name`, `description`, `tools` (CSV), `disallowed_tools` (CSV), `extensions` / `inherit_extensions` (tri-state), `skills` / `inherit_skills` (tri-state), `model`, `thinking`, `max_turns`, `prompt_mode` (`replace`|`append`), `inherit_context`, `run_in_background`, `isolated`, `memory` (`user`|`project`|`local`), `isolation` (`worktree`), `enabled`. The body after frontmatter is `systemPrompt`.

The 9 agent files at `/Users/sguslystyi/rpiv-pi/agents/*.md` only use `name`, `description`, `tools` — all compatible.

**`BUILTIN_TOOL_NAMES` filter surprise** at `@tintinweb/pi-subagents/src/agent-types.ts:23-34`: `TOOL_FACTORIES = {read, bash, edit, write, grep, find, ls}`. The `getToolsForType` function at `agent-types.ts:139-145` filters the frontmatter `tools:` CSV to only keys of `TOOL_FACTORIES`, silently dropping anything else. For `agents/web-search-researcher.md:4` which declares `tools: web_search, web_fetch, read, grep, find, ls`, the `web_search`/`web_fetch` names are dropped from the builtin set. BUT because `extensions:` defaults to `true` (`custom-agents.ts:132-136`), all extension-registered tools pass through at `agent-runner.ts:277-288`, so the agent would still have access to `web_search`/`web_fetch` via the vendored `extensions/web-tools/` path. **The `tools:` frontmatter line on web-search-researcher.md is effectively cosmetic** — it doesn't grant web tools; the extension inheritance path does.

### C. Web tools — new `extensions/web-tools/index.ts`, Brave-only

**Reference implementation**: `/Users/sguslystyi/.pi/agent/extensions/web-search/index.ts` (user-local, auto-discovered by `package-manager.js:1685` via `collectAutoExtensionEntries(userDirs.extensions)`). It registers:
- `web_search` at line 240 — params `{query, allowed_domains?, blocked_domains?, max_results?}`
- `web_fetch` at line 380 — params `{url, prompt?}` with the schema declared similar to Anthropic's built-in tool

Backends selectable via `WEB_SEARCH_BACKEND` env var: `tavily` (default), `serper`, `brave`. Required keys: `TAVILY_API_KEY`, `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`. `web_fetch` uses Node.js built-in `fetch()`.

**Decided action**: copy this file into `/Users/sguslystyi/rpiv-pi/extensions/web-tools/index.ts`, strip Tavily/Serper backend code, keep Brave only, change default to Brave. Add a `/web-search-config` slash command (like `pi-perplexity`'s `/perplexity-config` at `/usr/local/lib/node_modules/pi-perplexity/src/commands/config.ts`) to prompt for `BRAVE_SEARCH_API_KEY` interactively via `ctx.ui.input()` and persist to a config file.

Register in `package.json`:
```json
"pi": {
  "extensions": ["./extensions"],   // rpiv-core + web-tools + pi-subagents + pi-permission-system all auto-discovered
  "skills": ["./skills"]
  // DELETE: "agents": ["./agents"]
}
```

### D. Skill text replacements — the 367 pattern-hit scope

**Exact counts from an exhaustive grep by a codebase-locator agent** (grouped by category, file:line-level detail in Code References):

| Pattern | Count | Files | Classification |
|---|---|---|---|
| `AskUserQuestion` (prose + YAML block openers) | 42 | 15 | Semantic — rewrite to one-line prose once `ask_user_question` gets promptSnippet |
| `TaskCreate` / `TaskUpdate` prose | 13 | 10 | DELETE entirely — `todo.promptGuidelines` already teaches this |
| `$ARGUMENTS` token | 13 (12 frontmatter body + 1 prose) | 12 | Rewrite as prose — NOT interpolated by Pi |
| `` !`git ...` `` shell eval | 36 | 16 | DELETE — `extensions/rpiv-core/index.ts:141` injects git context via `before_agent_start` |
| `${CLAUDE_SKILL_DIR}` | 19 lines (~24 tokens) | 4 | Strip — just use `./` relative paths or `templates/...` |
| `rpiv-next:` prefix | 128 lines (~135 tokens) | 19 | Strip — mandatory to fix silent fallback |
| "Agent tool" prose | 24 | 19 | **KEEP** — tintinweb's tool IS named `Agent` |
| Tool-name prose (Read/Edit/Write/Glob/Grep/LS) | 59 explicit + ~60 verb-form | many | Mostly keep lowercase; `Glob` → `find` mandatory (6 × 5 files); other cases are stylistic |
| `allowed-tools:` frontmatter | 11 | 11 | **KEEP** as advisory self-guidance (silently ignored by Pi loader but harmless) |
| `disable-model-invocation: true` | 2 | 2 (implement-plan, create-handoff) | **KEEP** — Pi honors this at `skills.js:241` |
| `argument-hint:` frontmatter | 21 | all | **KEEP** — silently ignored but useful UX documentation |

**Pattern Density Table** (per-skill hit counts — heaviest to lightest):

| Skill | AQ | TC | $A | !git | CSD | rn: | At | Tool | aT | dMI | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| design-feature-iterative | 7 | 0 | 1 | 2 | 0 | 9 | 1 | 11 | 0 | 0 | **32** |
| create-plan | 2 | 2 | 1 | 2 | 0 | 18 | 4 | 1 | 0 | 0 | **31** |
| write-test-cases | 4 | 0 | 1 | 2 | 5 | 10 | 1 | 5 | 0 | 0 | **29** |
| design-feature | 4 | 1 | 1 | 2 | 0 | 12 | 1 | 4 | 0 | 0 | **26** |
| outline-test-cases | 5 | 1 | 1 | 2 | 2 | 6 | 1 | 6 | 1 | 0 | **26** |
| annotate-guidance | 4 | 0 | 0 | 0 | 6 | 5 | 2 | 4 | 1 | 0 | **23** |
| annotate-inline | 4 | 0 | 0 | 0 | 6 | 5 | 2 | 4 | 1 | 0 | **23** |
| iterate-plan | 2 | 2 | 0 | 2 | 0 | 8 | 2 | 4 | 1 | 0 | **22** |
| code-review | 0 | 1 | 0 | 3 | 0 | 12 | 2 | 0 | 1 | 0 | **20** |
| research-codebase | 3 | 1 | 1 | 2 | 0 | 8 | 1 | 1 | 0 | 0 | **18** |
| research | 2 | 0 | 1 | 2 | 0 | 7 | 1 | 3 | 0 | 0 | **17** |
| evaluate-research | 0 | 0 | 2 | 2 | 0 | 7 | 1 | 3 | 1 | 0 | **17** |
| research-questions | 1 | 1 | 1 | 2 | 0 | 4 | 1 | 3 | 0 | 0 | **14** |
| write-plan | 1 | 1 | 1 | 2 | 0 | 4 | 0 | 3 | 0 | 0 | **13** |
| research-solutions | 0 | 1 | 0 | 2 | 0 | 5 | 2 | 1 | 0 | 0 | **12** |
| resume-handoff | 1 | 2 | 0 | 0 | 0 | 2 | 1 | 4 | 0 | 0 | **11** |
| validate-plan | 0 | 0 | 0 | 3 | 0 | 3 | 1 | 0 | 1 | 0 | **9** |
| commit | 1 | 0 | 1 | 3 | 0 | 0 | 0 | 0 | 1 | 0 | **7** |
| create-handoff | 0 | 0 | 0 | 3 | 0 | 1 | 0 | 0 | 1 | 1 | **7** |
| implement-plan | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | **6** |
| migrate-to-guidance | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 1 | 0 | **5** |

Legend: AQ=AskUserQuestion, TC=TaskCreate, $A=$ARGUMENTS, !git=shell eval, CSD=CLAUDE_SKILL_DIR, rn:=rpiv-next: prefix, At="Agent tool", Tool=Read/Edit/Write/Glob/Grep/LS prose, aT=allowed-tools, dMI=disable-model-invocation.

**Canary order** (lightest → heaviest, respecting Plan B):
1. `migrate-to-guidance` (5 hits)
2. `implement-plan` (6 hits) — also exercises `disable-model-invocation: true`
3. `commit` (7 hits) — exercises `!`git`` removal, `AskUserQuestion` rewrite, `allowed-tools` keep
4. `create-handoff` (7 hits) — also exercises `disable-model-invocation: true`
5. `validate-plan` (9 hits)
6. `resume-handoff` (11 hits)
7. `research-solutions` (12 hits) ... etc ascending.

Start with `commit` as the TRUE canary per the question doc's recommendation — it exercises the broadest cross-section of patterns (AskUserQuestion + `!`git`` + allowed-tools + $ARGUMENTS + agent-free). After `commit` lands and validates, the harder skills follow.

### E. `ask_user_question` promptSnippet gap

`extensions/rpiv-core/index.ts:169-229` registers `ask_user_question` WITHOUT `promptSnippet` or `promptGuidelines`. The sibling `todo` tool at lines 268-273 has both:
```
promptSnippet: "Manage a task list to track multi-step progress",
promptGuidelines: [
  "Use the todo tool (add action) to create a task list when starting multi-step work...",
  "Use the todo tool (toggle action) to mark tasks as completed as you finish each step.",
  "This replaces TaskCreate/TaskUpdate from other systems.",
],
```

**Consequence** per `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js:42-46`:
```
const visibleTools = tools.filter(name => !!toolSnippets?.[name]);
```
Tools without a `promptSnippet` are EXCLUDED from the system prompt's "Available tools:" section. The LLM still knows `ask_user_question` exists via the provider's native tool-calling schema (`description` field at `rpiv-core/index.ts:172`), but it gets no narrative teaching about WHEN to use it.

**Decided fix**: add both fields to `ask_user_question` registration. The 42 inline YAML blocks across 15 skill files become one-line prose nudges ("Use the `ask_user_question` tool to confirm…"). The tool's shape is taught once at the extension level, not 42 times in skill bodies.

Similarly, `todo`'s `promptGuidelines` already teaches "This replaces TaskCreate/TaskUpdate from other systems" — so the 13 `TaskCreate`/`TaskUpdate` prose references in skills are redundant and should be **deleted entirely**, not rewritten.

### F. `$ARGUMENTS` is NEVER interpolated in skills

**Confirmed** at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:812-836` — `_expandSkillCommand` wraps the skill body in a `<skill name="..." location="...">...body...</skill>` block and appends user args as a trailing paragraph:
```
return args ? `${skillBlock}\n\n${args}\` : skillBlock;
```

`$ARGUMENTS` substitution exists only for prompt templates (`prompt-templates.js:54-82`), NOT for skills. So a skill body containing the literal text `$ARGUMENTS` sends that literal text to the LLM unchanged.

**Decided rewrite**: convert each `$ARGUMENTS` frontmatter body block into prose like:
```
## Task
If the user hasn't already provided a specific [plan path / research question / feature description], ask them for it before proceeding. Their input will appear as a follow-up paragraph.
```
This preserves the user-input anchor without relying on token substitution.

### G. `allowed-tools` + other frontmatter is silently ignored

`/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/skills.js:211-251` (`loadSkillFromFile`) reads exactly three frontmatter fields:
- `frontmatter.description` — validated non-empty, ≤1024 chars (lines 218-222, 231-233)
- `frontmatter.name` — pattern-validated against parent dir (lines 224-229)
- `frontmatter["disable-model-invocation"]` — checked only as `=== true` (line 241)

**All other frontmatter keys are dropped on the floor** by `parseFrontmatter` (`frontmatter.js:17-24`) — no warning, no diagnostic. `allowed-tools`, `argument-hint`, `color`, etc. are purely cosmetic. **Decision: KEEP them as self-guidance for the running agent** (the LLM still sees them because the raw skill body is wrapped into `<skill location="...">`, so the LLM reads the frontmatter as text even though Pi's loader ignores it). The P3 tool-gating extension (optional) would make them enforceable but is out of scope for this migration.

### H. Two subagent implementations exist — only one is loaded

For the record, the bundled pi example at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/subagent/` has a DIFFERENT schema (tool name `subagent`, params `{agent, task, tasks?, chain?, agentScope?, ...}`) and spawns child `pi` processes via `spawn` at `index.ts:303-309` with args `["--mode", "json", "-p", "--no-session"]`. It walks `findNearestProjectAgentsDir` (`agents.ts:85-95`) to find `.pi/agents/` in any ancestor of cwd (not just cwd itself). It is NOT auto-loaded — the README says to symlink manually.

We are ignoring this implementation entirely; every reference below is to `@tintinweb/pi-subagents@0.5.2`.

### I. Existing scaffolding gaps

- `/Users/sguslystyi/rpiv-pi/thoughts/shared/research/` — **does not exist** (was created by this research document)
- `/Users/sguslystyi/rpiv-pi/thoughts/shared/designs/` — does not exist
- `/Users/sguslystyi/rpiv-pi/thoughts/shared/plans/` — does not exist
- `/Users/sguslystyi/rpiv-pi/thoughts/shared/questions/` — exists, contains only the research-question doc

MIGRATION.md §12 claims `extensions/rpiv-core/index.ts:83-92` creates all four directories at `session_start`. Either the extension has never been loaded in this workspace, or `session_start` runs only on explicit Pi session startup (not when extension code is inspected/tested). Either way: **running `pi install /Users/sguslystyi/rpiv-pi` and starting a session will populate the directories.** Not a bug, just an artifact of the migration not having been run end-to-end yet.

### J. Dead peerDependency

`/Users/sguslystyi/rpiv-pi/package.json:15` declares `"@mariozechner/pi-tui": "*"` as a peerDependency. A grep across the entire rpiv-pi project found ZERO imports of `@mariozechner/pi-tui`. The vendored `extensions/pi-subagents/` will import it (for `Text`, `Container`, etc.), so once vendoring happens this peerDep becomes live. Keep it.

### K. User environment state (critical for validation)

`/Users/sguslystyi/.pi/agent/settings.json`:
```json
{
  "lastChangelogVersion": "0.66.1",
  "defaultProvider": "zai",
  "defaultModel": "glm-5.1",
  "defaultThinkingLevel": "high",
  "packages": [
    "npm:@tintinweb/pi-subagents",
    "npm:pi-perplexity",
    "npm:pi-permission-system"
  ]
}
```

**Installed global packages**:
- `@tintinweb/pi-subagents@0.5.2` at `/usr/local/lib/node_modules/@tintinweb/pi-subagents/`
- `pi-perplexity@0.2.0` at `/usr/local/lib/node_modules/pi-perplexity/` — registers `perplexity_search` tool (not `web_search`)
- `pi-permission-system@0.4.1` at `/usr/local/lib/node_modules/pi-permission-system/` — registers 5 event hooks (session_start, session_switch [dead], session_shutdown, before_agent_start, input, tool_call) + `/permission-system` slash command. Registers ZERO LLM-callable tools; acts as a veto layer on `tool_call`.

**User-local auto-discovered extensions**:
- `~/.pi/agent/extensions/web-search/index.ts` — registers `web_search` (line 240) and `web_fetch` (line 380). Tavily/Serper/Brave backends, env-var configured.

**Tool availability matrix in the current environment** (what the LLM actually sees when rpiv-core is loaded):
| Tool | Source | File |
|---|---|---|
| `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` | Pi builtin | `agent-types.ts:23-34` |
| `Agent`, `get_subagent_result`, `steer_subagent` | @tintinweb/pi-subagents | `src/index.ts:553, 971, 1045` |
| `perplexity_search` | pi-perplexity | `src/index.ts:22` |
| `web_search`, `web_fetch` | user-local web-search ext | `~/.pi/agent/extensions/web-search/index.ts:240, 380` |
| `ask_user_question`, `todo` | rpiv-core (project) | `extensions/rpiv-core/index.ts:169, 263` |

Total **15 LLM-callable tools**. Note: `pi-permission-system` may veto any of these at `tool_call` time depending on its rule configuration — validation MUST confirm `ask_user_question`, `todo`, `web_search`, `web_fetch` are not blocked by existing permission rules.

## Code References

### rpiv-core extension (`extensions/rpiv-core/index.ts`, 366 lines)

- `extensions/rpiv-core/index.ts:16-18` — Pi API imports: `ExtensionAPI`, `StringEnum`, `Type`
- `extensions/rpiv-core/index.ts:30-59` — `resolveGuidance()` walks `.rpiv/guidance/` hierarchy
- `extensions/rpiv-core/index.ts:79-92` — `session_start` handler: scaffolds `thoughts/shared/{research,questions,designs,plans}/`
- `extensions/rpiv-core/index.ts:96-103` — `session_compact` + `session_shutdown` handlers (cleanup)
- `extensions/rpiv-core/index.ts:106-137` — `tool_call` handler: guidance injection on read/edit/write via `pi.sendMessage({customType:"rpiv-guidance", display:false})`
- `extensions/rpiv-core/index.ts:141-158` — `before_agent_start` handler: git branch/commit via `pi.exec`, returns `{message: {customType:"rpiv-git-context", display:false}}`
- `extensions/rpiv-core/index.ts:169-229` — `ask_user_question` tool registration (**missing `promptSnippet`/`promptGuidelines` — fix target**)
- `extensions/rpiv-core/index.ts:181-228` — `ask_user_question.execute`: wraps `ctx.ui.select()` + `ctx.ui.input()` with an "Other (type your own answer)" fallback
- `extensions/rpiv-core/index.ts:241-258` — `todos` state + `reconstructTodoState` from session entries
- `extensions/rpiv-core/index.ts:260-261` — second `session_start` + `session_tree` handlers (todo state reconstruction)
- `extensions/rpiv-core/index.ts:263-342` — `todo` tool registration (**pattern to mirror for `ask_user_question`**)
- `extensions/rpiv-core/index.ts:268-273` — **promptSnippet + promptGuidelines — the template to copy**
- `extensions/rpiv-core/index.ts:345-365` — `/todos` command registration

### package.json

- `/Users/sguslystyi/rpiv-pi/package.json:7-11` — `pi` manifest with dead `agents` field to delete
- `/Users/sguslystyi/rpiv-pi/package.json:12-17` — `peerDependencies` (currently unused `@mariozechner/pi-tui` — becomes live with vendoring)

### Skills — AskUserQuestion hotspots

- `skills/commit/SKILL.md:47-61` — YAML block (canary — migrate first)
- `skills/research-codebase/SKILL.md:100-115` — YAML block + prose teaching
- `skills/research-codebase/SKILL.md:116` — batching prose
- `skills/implement-plan/SKILL.md:49-63` — YAML block for mismatch resolution
- `skills/write-plan/SKILL.md:72` — prose reference
- `skills/create-plan/SKILL.md:153, 186` — two prose references
- `skills/annotate-inline/SKILL.md:72, 146, 148-162` — prose + YAML block
- `skills/annotate-guidance/SKILL.md:74, 148, 150-164` — prose + YAML block
- `skills/outline-test-cases/SKILL.md:144, 146-160, 205, 252, 272` — 5 prose + 1 YAML block
- `skills/design-feature/SKILL.md:128, 130-144, 173` — prose + YAML block + prose
- `skills/design-feature-iterative/SKILL.md:148, 150-164, 193, 237, 333, 381` — 7 references
- `skills/write-test-cases/SKILL.md:184, 186-200` — prose + YAML block
- `skills/iterate-plan/SKILL.md:113, 175` — 2 prose references
- `skills/research/SKILL.md:124, 127` — 2 prose references
- `skills/research-questions/SKILL.md:120` — prose
- `skills/resume-handoff/SKILL.md:104` — prose

Total: 42 hits × 15 files (exhaustive list in integration scanner report; see `create-plan/SKILL.md:458` for the highest-density line with 6 `rpiv-next:` tokens).

### Skills — TaskCreate/TaskUpdate hotspots (DELETE entirely)

- `skills/write-plan/SKILL.md:248` — "Use TaskCreate/TaskUpdate to track planning tasks"
- `skills/outline-test-cases/SKILL.md:61` — "Create a task list using TaskCreate"
- `skills/design-feature/SKILL.md:400` — "Use TaskCreate/TaskUpdate to track design tasks"
- `skills/research-questions/SKILL.md:42` — "Create a research plan using TaskCreate"
- `skills/iterate-plan/SKILL.md:72, 198` — two references
- `skills/research-codebase/SKILL.md:39` — "Create a research plan using TaskCreate to track all subtasks"
- `skills/research-solutions/SKILL.md:42`
- `skills/create-plan/SKILL.md:111, 377` — two references
- `skills/code-review/SKILL.md:51`
- `skills/resume-handoff/SKILL.md:122, 164` — two references

### Skills — `!`git`` hotspots (DELETE — all in `## Git Context` blocks at lines 8-13)

- `commit/SKILL.md:9-11` (under `## Current state`)
- `write-plan/SKILL.md:8-9`, `create-plan/SKILL.md:8-9`, `design-feature/SKILL.md:8-9`, `design-feature-iterative/SKILL.md:8-9`, `research-solutions/SKILL.md:8-9`, `research-codebase/SKILL.md:8-9`, `research/SKILL.md:8-9`, `research-questions/SKILL.md:8-9`, `write-test-cases/SKILL.md:8-9`, `evaluate-research/SKILL.md:9-10`, `iterate-plan/SKILL.md:9-10`, `code-review/SKILL.md:9-13`, `validate-plan/SKILL.md:9-11`, `create-handoff/SKILL.md:10-12`, `outline-test-cases/SKILL.md:9-10`
- 36 total lines across 16 files, always the same `!`git branch --show-current``/`!`git rev-parse``/optional `!`git log`` pattern

### Skills — `${CLAUDE_SKILL_DIR}` (4 files, 19 lines)

- `skills/write-test-cases/SKILL.md:220, 221, 223 (3 tokens), 232 (2 tokens), 277` — templates + examples
- `skills/annotate-inline/SKILL.md:250, 260 (2 tokens), 271, 282, 283, 284` — templates + examples
- `skills/annotate-guidance/SKILL.md:254, 264 (2 tokens), 275, 286, 287, 288` — templates + examples
- `skills/outline-test-cases/SKILL.md:299, 309` — templates

### Skills — `rpiv-next:` prefix (19 files, 128 line hits, ~135 tokens)

Top hotspots:
- `skills/create-plan/SKILL.md:458` — 6 tokens on one line (`rpiv-next:codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `thoughts-locator`, `thoughts-analyzer`, `web-search-researcher`)
- `skills/create-plan/SKILL.md:38-39, 60-64, 116-123, 470-474, 481` — 18 total lines (heaviest skill)
- `skills/write-test-cases/SKILL.md:52-55, 57, 83, 90, 100, 104, 208` — 10 lines
- `skills/code-review/SKILL.md:57-66, 181-186` — 12 lines
- `skills/design-feature/SKILL.md:42-43, 59-70, 152, 215, 378` — 12 lines
- `skills/design-feature-iterative/SKILL.md:50, 64-70, 172, 301, 430` — 9 lines
- Plus 14 other files with 2-8 hits each (full table in Pattern Density above)

Also: `skills/outline-test-cases/templates/outline-readme.md:25, 30` — 2 hits in a template file (not SKILL.md)

### Skills — Agent dependency matrix (14 skills × 9 agents — all silently broken today)

| Skill | Agents referenced (via `rpiv-next:` prefix) |
|---|---|
| research-codebase | codebase-locator, codebase-analyzer, codebase-pattern-finder, integration-scanner, thoughts-locator, thoughts-analyzer, precedent-locator, web-search-researcher |
| research-questions | codebase-locator, thoughts-locator, integration-scanner |
| research | codebase-analyzer, codebase-locator, precedent-locator, web-search-researcher |
| research-solutions | codebase-locator, codebase-analyzer, codebase-pattern-finder, thoughts-locator, web-search-researcher |
| create-plan | codebase-locator, codebase-analyzer, codebase-pattern-finder, integration-scanner, thoughts-locator, thoughts-analyzer, precedent-locator, web-search-researcher |
| iterate-plan | codebase-locator, codebase-analyzer, codebase-pattern-finder, thoughts-locator, thoughts-analyzer |
| design-feature | codebase-pattern-finder, codebase-analyzer, integration-scanner, precedent-locator, codebase-locator, thoughts-locator, web-search-researcher |
| design-feature-iterative | codebase-pattern-finder, codebase-analyzer, integration-scanner, precedent-locator, web-search-researcher |
| code-review | codebase-locator, codebase-analyzer, codebase-pattern-finder, thoughts-locator, thoughts-analyzer, web-search-researcher |
| evaluate-research | codebase-locator, codebase-analyzer, integration-scanner, thoughts-locator |
| outline-test-cases | codebase-locator, test-case-locator |
| write-test-cases | codebase-locator, test-case-locator, codebase-analyzer, integration-scanner |
| annotate-guidance | codebase-locator, codebase-analyzer, codebase-pattern-finder |
| annotate-inline | codebase-locator, codebase-analyzer, codebase-pattern-finder |

Skills NOT depending on custom agents (7 of 21): `commit`, `create-handoff`, `implement-plan`, `migrate-to-guidance`, `resume-handoff`, `validate-plan`, `write-plan` (write-plan has 4 `rpiv-next` hits but on non-dispatch lines).

### Pi runtime references (for the planner, not to modify)

- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/package-manager.js:38` — `RESOURCE_TYPES` constant (proves `agents` is not a resource)
- `package-manager.js:1514` — manifest iteration loop
- `package-manager.js:1587-1599` — `readPiManifest`
- `package-manager.js:339` — the ONLY `manifest.extensions` read in the file
- `loader.js:337` — the ONLY `manifest.extensions` read in loader.js
- `dist/core/extensions/types.d.ts:279-302` — `ToolDefinition` with `promptSnippet`/`promptGuidelines` fields
- `types.d.ts:702-728` — `pi.on` event union (no `session_switch`; correct name is `session_before_switch`)
- `types.d.ts:180-209` — `ExtensionContext` passed to `execute`
- `types.d.ts:55-164` — `ExtensionUIContext` — `select`, `confirm`, `input`, `custom`, `notify`, `editor` methods
- `types.d.ts:769` — `pi.exec(command, args, options?)` signature (used by rpiv-core git context hook)
- `types.d.ts:747` — `pi.registerMessageRenderer` for `customType` rendering
- `types.d.ts:749-752` — `pi.sendMessage` signature
- `types.d.ts:775` — `pi.setActiveTools` (for optional P3 gating)
- `dist/core/skills.js:211-251` — `loadSkillFromFile` — proves only `name`/`description`/`disable-model-invocation` are read
- `dist/core/skills.js:241` — where `disable-model-invocation: true` is honored
- `dist/core/agent-session.js:812-836` — `_expandSkillCommand` — proves `$ARGUMENTS` is NOT interpolated; user args append as trailing paragraph
- `dist/core/system-prompt.js:42-46` — `visibleTools = tools.filter(name => !!toolSnippets?.[name])` — proves tools without `promptSnippet` are hidden from the "Available tools:" section
- `dist/core/system-prompt.js:50-55, 69-78` — `promptGuidelines` deduplication and injection into "Guidelines:" section
- `dist/utils/frontmatter.js:17-24` — `parseFrontmatter` returns raw `Record<string, unknown>` — proves unknown fields are silently ignored

### @tintinweb/pi-subagents references

- `src/index.ts:197` — default export factory
- `src/index.ts:553-554` — `Agent` tool name + label
- `src/index.ts:556-576` — tool description (copied verbatim into the system prompt via `description`)
- `src/index.ts:577-628` — TypeBox parameter schema (`prompt`, `description`, `subagent_type`, `model?`, `thinking?`, `max_turns?`, `run_in_background?`, `resume?`, `isolated?`, `inherit_context?`, `isolation?`)
- `src/index.ts:723-799` — `execute` path for resume + reload agents
- `src/index.ts:728` — `reloadCustomAgents()` called BEFORE every invocation (live reload)
- `src/index.ts:730-732` — **the silent fallback to `general-purpose`** for unknown `subagent_type`
- `src/index.ts:971, 1045` — `get_subagent_result` and `steer_subagent` sibling tools
- `src/index.ts:443` — `pi.events.emit("subagents:ready", {})` on load
- `src/index.ts:1667-1670` — `/agents` slash command for interactive management
- `src/custom-agents.ts:21-28` — agent discovery paths (**the canonical reference**)
- `src/custom-agents.ts:52-75` — frontmatter field parsing
- `src/agent-types.ts:23-34` — `BUILTIN_TOOL_NAMES` and `TOOL_FACTORIES`
- `src/agent-types.ts:59-66` — `resolveType` (case-insensitive exact match)
- `src/agent-types.ts:139-145` — `getToolsForType` filter (silently drops unknown tool names)
- `src/agent-runner.ts:25` — `EXCLUDED_TOOL_NAMES = ["Agent","get_subagent_result","steer_subagent"]`
- `src/agent-runner.ts:154-368` — `runAgent` (in-process execution)
- `src/agent-runner.ts:236-244` — `createAgentSession` + `DefaultResourceLoader` (extensions re-loaded in child)
- `src/agent-runner.ts:277-288` — extension tool inheritance logic
- `src/default-agents.ts:12-28` — `general-purpose` default agent config
- `src/default-agents.ts:29-73` — `Explore` default (read-only, Haiku)
- `src/default-agents.ts:74-129` — `Plan` default (read-only, inherits model)

### User-local web-search extension (reference for the new vendored `extensions/web-tools/`)

- `~/.pi/agent/extensions/web-search/index.ts:1-20` — module header with backend selection docs
- `~/.pi/agent/extensions/web-search/index.ts:240` — `web_search` tool registration
- `~/.pi/agent/extensions/web-search/index.ts:380` — `web_fetch` tool registration
- Backend switch via `WEB_SEARCH_BACKEND` env var: `tavily`|`serper`|`brave` (strip first two during vendoring)

### pi-perplexity reference (for the `/web-search-config` command pattern)

- `/usr/local/lib/node_modules/pi-perplexity/src/index.ts:19` — `registerPerplexityCommands(pi)`
- `/usr/local/lib/node_modules/pi-perplexity/src/index.ts:20` — `registerPerplexityConfigCommand(pi)`
- `/usr/local/lib/node_modules/pi-perplexity/src/commands/config.ts` — the command handler template
- `/usr/local/lib/node_modules/pi-perplexity/src/auth/login.ts` — email+OTP auth via `ctx.ui.input`

## Integration Points

### Inbound References (what references rpiv-pi components)

- **14 skills → 9 custom agents** (see dependency matrix in Code References). All currently falling back to `general-purpose` due to the `rpiv-next:` prefix bug and the missing `.pi/agents/` directory. Fix requires BOTH: agent discovery wiring AND prefix stripping.
- **Pi skill loader → `skills/*/SKILL.md`** via the `pi.skills: ["./skills"]` manifest. Discovery works; all 21 skills become `/skill:<name>` commands at session load.
- **Pi extension loader → `extensions/rpiv-core/index.ts`** via `pi.extensions: ["./extensions"]`. Discovery works; the extension factory runs on session init.

### Outbound Dependencies (what rpiv-pi components call)

- **rpiv-core → `@mariozechner/pi-coding-agent`** (type-only import of `ExtensionAPI`) at `extensions/rpiv-core/index.ts:16`
- **rpiv-core → `@mariozechner/pi-ai`** (runtime import of `StringEnum`) at line 17
- **rpiv-core → `@sinclair/typebox`** (runtime import of `Type`) at line 18
- **rpiv-core → Node stdlib**: `node:fs`, `node:path`, `node:crypto` at lines 13-15
- **rpiv-core → Pi runtime API**: `pi.on` × 7 events, `pi.registerTool` × 2, `pi.registerCommand` × 1, `pi.sendMessage` × 1, `pi.exec` × 2 (git branch, git rev-parse)
- **rpiv-core → ctx methods**: `ctx.cwd`, `ctx.hasUI`, `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.notify`, `ctx.sessionManager.getBranch()`
- **NO cross-extension contract** — rpiv-core does not import, require, or assume `@tintinweb/pi-subagents`, `pi-permission-system`, or the web-search extension. Its only cross-extension surface is `pi.sendMessage({customType:"rpiv-guidance" | "rpiv-git-context", display:false})` which any `pi.registerMessageRenderer` could consume (none currently does).

### Infrastructure Wiring

- `/Users/sguslystyi/rpiv-pi/package.json:7-11` — `pi` manifest (extensions + skills only — `agents` field is dead)
- `/Users/sguslystyi/.pi/agent/settings.json:6-10` — user's global package list (includes `@tintinweb/pi-subagents`, `pi-perplexity`, `pi-permission-system`)
- `~/.pi/agent/extensions/web-search/` — user-local auto-discovered extension (source of our web-tools clone)
- `extensions/rpiv-core/index.ts:79-92` — `session_start` scaffolding (currently creates `thoughts/shared/{research,questions,designs,plans}/`; **will be extended** to also copy `<pkg>/agents/*.md` → `<cwd>/.pi/agents/*.md`)
- `extensions/rpiv-core/index.ts:141-158` — `before_agent_start` git context injection (replaces 36 `!`git`` shell evals in skills)
- `extensions/rpiv-core/index.ts:106-137` — `tool_call` guidance injection (walks `.rpiv/guidance/` hierarchy on read/edit/write)
- **No CI/deploy wiring** — rpiv-pi is a local dev package; no GitHub Actions, no publish script. Validation is manual via `pi install <path>` + `/skill:<name>`.

## Architecture Insights

1. **Pi's extension API favors registration over mutation.** Every capability is added via `pi.registerTool`, `pi.registerCommand`, `pi.on`, `pi.registerMessageRenderer`, `pi.registerFlag`, `pi.registerProvider`. There is no "decorate an existing tool" or "intercept a built-in" mechanism except at the `tool_call` event level (which is a veto/mutate hook per `types.d.ts:725, 544-550`). This strongly favors the "vendor a sibling extension" pattern over any kind of monkey-patching.

2. **`promptSnippet`/`promptGuidelines` is the canonical way to teach a custom tool to the LLM.** Without a snippet, the tool is invisible in the system prompt's "Available tools" section (though still callable structurally). With a snippet, it appears alongside builtins and the LLM gains narrative cues about when to use it. The `todo` tool at `rpiv-core/index.ts:268-273` demonstrates the pattern; `ask_user_question` at lines 169-229 does not and should.

3. **Subagent execution is in-process for tintinweb, subprocess for the bundled example.** This choice cascades: in-process means shared TUI, extension inheritance, live reload of agent files per invocation, and cheap spawn. Subprocess means isolation, stale extension state, and expensive spawn. The migration targets tintinweb explicitly.

4. **Case sensitivity matters for `subagent_type`.** `resolveType` at `agent-types.ts:59-66` is case-insensitive exact match. So `codebase-locator`, `Codebase-Locator`, and `CODEBASE-LOCATOR` all resolve, but `rpiv-next:codebase-locator` does not. There is no prefix stripping, no namespacing, no partial match. Stripping `rpiv-next:` is mandatory.

5. **Agent discovery is cwd-bound, not package-bound.** `custom-agents.ts:22-23` reads `<cwd>/.pi/agents` and `~/.pi/agent/agents`. There is NO path that reads agents from the installed-package directory. A `pi install <path>` does not wire agents — the package is free to ship `agents/*.md` files but must arrange for them to land in one of the two discoverable paths. The `session_start` auto-copy pattern is the only clean solution that makes the package portable.

6. **Pi's manifest is closed-schema.** Only `extensions`, `skills`, `prompts`, `themes` are read (`package-manager.js:38`). Pi does NOT support `pi.dependencies`, `pi.requires`, `pi.postInstall`, or any other plugin dependency mechanism. Out-of-the-box sibling packages require vendoring their source OR user-level package installation — there is no middle ground today.

7. **Pi silently ignores unknown frontmatter.** `frontmatter.js:17-24` returns `Record<string, unknown>` and the skill loader at `skills.js:211-251` only reads three keys. `allowed-tools`, `argument-hint`, `color`, etc. are kept in the raw body (so the LLM sees them as text) but have no runtime effect. This is the reason `allowed-tools` can stay as self-guidance without breaking anything.

8. **rpiv-core's guidance injection is elegant and load-bearing.** The `tool_call` handler at lines 106-137 walks `.rpiv/guidance/<dir>/architecture.md` files on read/edit/write, builds a Markdown context block, and injects it via `pi.sendMessage({customType:"rpiv-guidance", display:false})` — a HIDDEN message that appears in session history but is not rendered in the TUI. The `Set<string>` at line 66 tracks already-injected paths so the same guidance doesn't repeat within a session. This architecture is preserved as-is.

## Precedents & Lessons

**1 similar past change analyzed**: the gap-analysis-driven scaffolding of the migration itself (tracked in `thoughts/MIGRATION.md` at `/Users/sguslystyi/rpiv-pi/thoughts/MIGRATION.md`). All P0/P1 infrastructure items are DONE; the remaining work is P1 (web tools extension + subagent wiring) + P2 (~240 skill text edits) + P3 optional polish. The migration document is the closest precedent; there is no prior Claude Code → Pi migration in git history.

Composite lessons for the planner:

- **Verify `rpiv-next:` strip landed.** The silent fallback at tintinweb `src/index.ts:730-732` means you cannot tell from inside Pi whether the fix worked — a `/skill:research-codebase` call will run without errors regardless of whether its subagent dispatches are hitting `codebase-locator` or `general-purpose`. Validation must involve either (a) setting a breakpoint / log message in the vendored tintinweb code to report the resolved `subagentType`, or (b) running a subagent whose prompt explicitly asks it to state its own type and tool set.

- **Test web_search/web_fetch presence AFTER vendoring.** Today these work because of the user-local extension at `~/.pi/agent/extensions/web-search/`. After vendoring into `extensions/web-tools/`, it's possible to accidentally register duplicate names and have one silently shadow the other. Run `pi.getAllTools()` (via `/debug` or a quick custom command) to confirm exactly ONE registration path for each name.

- **Canary on `commit` first**, not `research-codebase`. `commit` has no agent dependencies (7 pattern hits — AskUserQuestion + `!`git`` + allowed-tools + $ARGUMENTS), so it exercises the extension + skill-text layer without compounding the agent discovery problem. If `commit` works end-to-end with the expected UX (user sees a structured question, chooses an option, commits happen), you've validated the full rewrite pattern before touching the 14 skills that depend on subagents.

- **Do NOT treat the gap-analysis doc's estimates as authoritative.** The gap analysis put web tools at ~80 lines; the reference implementation at `~/.pi/agent/extensions/web-search/index.ts` is ~500 lines due to backend abstraction. Brave-only will land closer to ~200 lines but still well above the estimate.

- **Watch for permission-system vetoes during validation.** `pi-permission-system` hooks `tool_call` at `src/index.ts:1255` and can deny any tool call based on user rules. If `ask_user_question`, `todo`, `web_search`, or `web_fetch` are silently denied, skills will appear to "hang" or "skip" user interaction with no obvious cause. Check the permission system's rule set BEFORE running the canary.

- **The scaffolding gap is a tell.** `thoughts/shared/{research,designs,plans}/` don't exist in rpiv-pi today, despite MIGRATION.md §12 claiming `session_start` creates them. This means the extension has never run end-to-end in this workspace. The canary test is also the first real integration test.

## Historical Context (from thoughts/)

- `/Users/sguslystyi/rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` — **THE FOUNDATIONAL DOCUMENT** (669 lines). Gap Analysis: Porting rpiv-skillbased to Pi. Covers every architectural decision point: subagent system (§2), skills (§3), hooks (§4), AskUserQuestion → custom tool (§5), artifact chain (§6), template loading (§7), web tools (§8), permission model (§9), `disable-model-invocation` (§10), roadmap (§11), estimates (§12), tool name mapping Appendix A, task management tools Appendix B. **Lives in the WRONG repo** (`rpiv-skillbased/`, not `rpiv-pi/`) — the MIGRATION.md reference at line 3 is a dangling path when resolved from rpiv-pi. Recommend: copy this file into `/Users/sguslystyi/rpiv-pi/thoughts/shared/research/` as `2026-04-10_gap-analysis-porting-to-pi.md` to preserve the link.

- `/Users/sguslystyi/rpiv-pi/thoughts/MIGRATION.md` — the living migration status tracker (not frontmatter-stamped). Documents what's done (P0/P1 infrastructure complete in `extensions/rpiv-core/index.ts`), architectural decisions made (guidance injection via `pi.sendMessage`, todo Option 1, monolithic extension), and a file-by-file migration checklist at lines 244-277 with all 21 skills grouped by required P2 items.

- `/Users/sguslystyi/rpiv-pi/thoughts/shared/questions/2026-04-10_08-45-32_complete-pi-migration.md` — the question document that drove this research (8 numbered questions with extensive context). Contained slightly stale pattern counts (40 AskUserQuestion / 17 files; actual is 42 / 15) but directionally correct scope.

- **7 unrelated question docs in `rpiv-skillbased/thoughts/shared/questions/`** — all about the PREVIOUS migration (rpiv → rpiv-skillbased, commands/agents → Claude Code skills), not relevant here.

- **17 design docs, 18 plan docs, 1 handoff doc in `rpiv-skillbased/thoughts/shared/`** — all about rpiv-skillbased skill quality improvements, not about the Pi migration.

- **No design, plan, or handoff documents exist for the Pi migration itself.** This research document is the first. The downstream artifact chain (design → plan → implementation → handoff) must be created from scratch.

## Developer Context

Q&A from the research checkpoint (all 6 decisions are load-bearing for the plan):

### Q1: Is rpiv-pi a personal package or distributable?

**Context**: The user's environment had `@tintinweb/pi-subagents`, `pi-perplexity`, `pi-permission-system` globally installed AND a private `~/.pi/agent/extensions/web-search/` extension. If personal, the "web-tools blocker" disappears (existing tools satisfy the need). If distributable, all four must be vendored or declared explicitly.

**Answer**: **Distributable.** `@tintinweb/pi-subagents` and `pi-permission-system` are explicit default dependencies. Web search/fetch must be implemented via Brave backend, default, API-key configurable. Either bundle the existing web-search extension or create a new one based on it.

### Q2: Web-tools packaging — merge into rpiv-core or new sibling extension?

**Context**: The reference implementation at `~/.pi/agent/extensions/web-search/index.ts` is ~500 lines supporting Tavily/Serper/Brave. We can either merge its two `pi.registerTool` calls into rpiv-core (keeping it monolithic per MIGRATION.md §15) or split into a new `extensions/web-tools/` sibling.

**Answer**: **Option A — new sibling `extensions/web-tools/index.ts`.** Clean up to Brave-only. Tavily/Serper backends dropped.

### Q3: `ask_user_question` teaching — add promptSnippet or rewrite 42 inline YAML blocks?

**Context**: `rpiv-core/index.ts:169-229` registers `ask_user_question` without `promptSnippet`/`promptGuidelines`, so the LLM doesn't see it in the "Available tools" section. The 42 inline `AskUserQuestion:` YAML blocks across 15 skills are currently the LLM's only narrative teaching.

**Answer**: **Use Pi's ability to create a custom tool that wraps its existing question-rendering mechanism.** Interpretation: add `promptSnippet` + `promptGuidelines` to the existing `ask_user_question` tool (mirror the `todo` pattern at `rpiv-core/index.ts:268-273`) so the LLM learns the tool once at the extension level. Then skills get one-line prose nudges ("Use the `ask_user_question` tool to confirm…") instead of inline YAML blocks. Eliminates 42 semantic rewrites.

### Q4: Agent discovery mechanism — move dir, symlink, or install script?

**Context**: `/Users/sguslystyi/rpiv-pi/agents/*.md` is dead because `pi.agents` is a silent no-op. tintinweb reads only `<cwd>/.pi/agents/` or `~/.pi/agent/agents/`. Three mitigation strategies proposed.

**Answer**: **Preliminary Option A (move to `.pi/agents/`).** BUT add an out-of-the-box install story: **bundle `@tintinweb/pi-subagents` AND `pi-permission-system` as vendored extensions AND auto-copy agents to the proper destination after install.**

### Q5: Out-of-the-box strategy — vendor, bootstrap, or setup command?

**Context**: Pi has NO package-dependency mechanism (`package-manager.js:38` RESOURCE_TYPES excludes any dependency field). Three options proposed: (A) vendor the source, (B) bootstrap via `pi.exec("pi", ["install", ...])` at `session_start`, (C) ship a `/rpiv-setup` command.

**Answer**: **Option A — vendor the source.** Copy `@tintinweb/pi-subagents@0.5.2/src/` into `extensions/pi-subagents/` and `pi-permission-system@0.4.1/src/` into `extensions/pi-permission-system/`. Register both via the `pi.extensions` manifest. Accept the upstream-tracking burden.

For 5b (agent files): the `session_start` auto-copy handler in rpiv-core will locate itself via `import.meta.url`, walk to the package root, and copy `<pkg>/agents/*.md` → `<cwd>/.pi/agents/*.md` if missing.

### Q6: Replacement mechanism — scripted or canary-first?

**Context**: The 367 pattern hits split into mechanical (scriptable) and semantic (per-file). Plan A = one script + targeted Edit calls. Plan B = canary file-by-file validation, slower but safer.

**Answer**: **Plan B — canary-first, file-by-file.** Start with `commit/SKILL.md` (83 lines, 7 pattern hits, no agent dispatches), validate end-to-end, then proceed up the pattern-density ladder.

Sub-decisions:
- **`allowed-tools:` KEPT** as self-guidance for the running agent. (Pi's skill loader silently ignores it; it's cosmetic documentation the LLM still sees because the skill body is wrapped into the prompt.)
- **`$ARGUMENTS` REWRITTEN as prose** ("If the user hasn't provided input, ask them for it") — NOT deleted. User's input arrives as a trailing paragraph after the skill body.

## Related Research

- **Gap analysis (foundational)**: `/Users/sguslystyi/rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` — 669 lines. Structure: §1 Exec summary, §2 Subagent system, §3 Skills, §4 Hooks, §5 AskUserQuestion, §6 Artifact chain, §7 Template loading, §8 Web tools, §9 Permission model, §10 disable-model-invocation, §11 Roadmap, §12 Estimates, §13 Conclusion, App A Tool name mapping, App B Task management gap. Recommend copying into rpiv-pi/thoughts/shared/research/ to preserve the MIGRATION.md reference.
- **Migration status tracker**: `/Users/sguslystyi/rpiv-pi/thoughts/MIGRATION.md` — file-by-file checklist at lines 244-277.
- **Question artifact**: `/Users/sguslystyi/rpiv-pi/thoughts/shared/questions/2026-04-10_08-45-32_complete-pi-migration.md` — the driving 8-question brief.

## Open Questions

(None resolved by the checkpoint — all questions were answered. The items below are second-order concerns the planner may want to address explicitly during design/plan phases.)

1. **Permission system rule set** — does `pi-permission-system` have default rules that would veto `ask_user_question`, `todo`, `web_search`, or `web_fetch`? Validation must verify this before the canary run. A blocked tool would produce a silent UX failure.

2. **License attribution** — `@tintinweb/pi-subagents@0.5.2` and `pi-permission-system@0.4.1` are both MIT. Vendoring their source into rpiv-pi requires preserving the LICENSE file and original copyright notices. Add `extensions/pi-subagents/LICENSE` and `extensions/pi-permission-system/LICENSE` to the copy operation.

3. **Upstream tracking** — once vendored, how do we track upstream updates to tintinweb and pi-permission-system? Options: periodic manual refresh, git subtree, or submodules. Not blocking the migration but needed for long-term maintenance.

4. **Duplicate `web_search` registration** — if a user already has `~/.pi/agent/extensions/web-search/` installed (as the developer does today), installing rpiv-pi with `extensions/web-tools/` will attempt to register `web_search` twice. What is Pi's behavior on duplicate tool names? Check `pi.registerTool` implementation for collision handling. If Pi errors on duplicate, the new extension must either check `pi.getAllTools()` first or use a different tool name (e.g., `rpiv_web_search`).

5. **Brave API key onboarding** — should `/web-search-config` prompt on first use OR on `/skill:research-codebase` attempting to use `web_search`? The pi-perplexity pattern is lazy (prompts on first tool call via `ctx.ui.input` in `execute`); mirror that rather than forcing upfront configuration.

6. **Scaffolding-check semantics** — should the `session_start` agent-copier SKIP if `<cwd>/.pi/agents/codebase-locator.md` already exists (safe default), or overwrite (ensures version parity)? Probably skip, with a `/rpiv-update-agents` command for explicit refresh. Nice to make this decision explicit in the design phase.

7. **`rpiv-skillbased` vs `rpiv-next` vs `rpiv-pi` naming** — `package.json:2` says `"name": "rpiv-skillbased"`. The skill text said `rpiv-next:<agent>`. The repo dir is `rpiv-pi/`. Which is the canonical name going forward? Suggest: rename `package.json` to `"name": "rpiv-pi"` during the migration (or `"rpiv-pi-skillbased"`) and update MIGRATION.md references.

8. **rpiv-core dead imports** — `extensions/rpiv-core/index.ts:13-15` imports `rmSync`, `statSync`, `readdirSync`, `createHash` which are never used in the 366 lines of the file. Cleanup candidates but low priority.

9. **Two `session_start` handlers in rpiv-core** — lines 79 and 260 both subscribe to `session_start`. Not a bug but worth knowing: the agent-copier should be added to one of them (likely the first, which already handles scaffolding) rather than introducing a third.

10. **Does Pi's `pi.registerTool` parameter schema accept raw JSON Schema, or must it be TypeBox?** All three reference implementations (rpiv-core, tintinweb, pi-perplexity) use TypeBox via `@sinclair/typebox`. The type signature at `types.d.ts:281, 292-293, 730` is `TSchema`, which is a TypeBox type. In practice JSON Schema objects flow through because TypeBox produces JSON-Schema-shaped output, but the compiler enforces `Type.Object(...)` usage. The vendored `extensions/web-tools/` will need to continue using TypeBox.
