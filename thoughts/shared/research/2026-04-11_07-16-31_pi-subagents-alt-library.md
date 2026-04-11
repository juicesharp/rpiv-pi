---
date: 2026-04-11T07:16:31-0400
researcher: Claude Code
git_commit: d484cb3
branch: master
repository: rpiv-pi
topic: "Evaluate nicobailon/pi-subagents as an alternative to @tintinweb/pi-subagents — compatibility, rewrite cost, and capability trade-offs"
tags: [research, codebase, subagents, pi-subagents, library-evaluation, compatibility, rpiv-core, migration]
status: complete
questions_source: "thoughts/shared/questions/2026-04-11_06-36-22_pi-subagents-alt-library.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Research: nicobailon/pi-subagents vs @tintinweb/pi-subagents

## Research Question

Can rpiv-pi swap its subagent runtime from `@tintinweb/pi-subagents@^0.5.2` to `nicobailon/pi-subagents` (npm: `pi-subagents`)? What is the rewrite cost, what breaks, and what net capability does each library's unique features deliver against rpiv-pi's existing skills?

## Summary

**A swap is feasible but constrained.** The load-bearing code surface is narrow — only 5 TypeScript/JSON files hard-code the current library (package.json, package-checks.ts, index.ts, pi-permissions.jsonc, README.md). The skill surface is wide but mechanical — 16 SKILL.md files with ~77 `Agent`-tool references and 12 `subagent_type:` YAML lines. None of the 16 skill fan-outs require structural rewriting; every parallel dispatch already maps 1-to-1 to nicobailon's `{tasks: [...]}` schema.

**Three gates must be cleared before a swap can land.** (1) The subprocess execution model breaks rpiv-core's in-process extension inheritance — rpiv-core must be reachable by every spawned child, or the `before_agent_start` git-context hook, `ask_user_question`/`todo` tools, and the `active_agent` permission-system shim all break silently. (2) Both `skills/validate-plan/SKILL.md:52` and `skills/resume-handoff/SKILL.md:48` literally dispatch `general-purpose`, which nicobailon rejects with `Unknown agent: general-purpose` (no fallback). (3) The prior vendor-then-rollback in Phase 2 of the migration plan (2026-04-10) proved that two subagent libraries cannot run side-by-side due to tool-name double-registration — a swap must be cold, not incremental.

**The strongest net-gain argument is `.chain.md` for `skills/write-test-cases/SKILL.md:75-104`.** That skill's Step 2→Step 3 pipeline already declares a data dependency at line 94 ("Using the entry points discovered in Step 2") with prose join barriers at lines 90 and 104. A `.chain.md` file would replace prose-enforced ordering with machine-enforced sequencing — the cleanest chain fit in the codebase. Every other candidate feature (`worktree: true`, `async: true`, SKILL.md XML injection) is a weaker or impossible fit: `create-plan`'s fan-outs are gated by developer checkpoints, `design-feature-iterative/SKILL.md:209` explicitly requires sequential slice generation, `async: true` is blocked for `{tasks: [...]}` parallel mode per `subagent-executor.ts`.

**Developer direction**: prioritize net-gain analysis, commit to `.chain.md` as the strongest leverage, and bundle `agents/general-purpose.md` as the day-1 break fix (see Developer Context).

## Detailed Findings

### Runtime execution model — the biggest delta

`@tintinweb/pi-subagents` runs subagents **in-process** via `createAgentSession` (referenced in `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md:416-426`): `agent-runner.ts:236-306` creates a fresh `SessionManager.inMemory(effectiveCwd)` for the child, then calls `session.bindExtensions(...)` which re-runs every loaded extension's module inside the same Node process. rpiv-core's `pi.registerTool(...)` calls, `pi.on(...)` handlers, and module-level state (`let tasks` in `extensions/rpiv-core/todo.ts:60-61`) all re-bind into the child's session automatically because they share the Node module system.

`nicobailon/pi-subagents` runs subagents as **separate OS processes** via `child_process.spawn` invoking the `pi` CLI (`execution.ts` — `spawn(spawnSpec.command, spawnSpec.args, { cwd, stdio: ["ignore","pipe","pipe"], env: spawnEnv })`). The child is a fresh Pi invocation; its extension set is determined by its own config discovery, not the parent's in-memory registry. The `extensions:` frontmatter field on the agent .md file controls what extensions the child loads:
- Absent → child loads whatever Pi's global config says (permissive default).
- Empty string → `--no-extensions` → child loads nothing.
- CSV `a,b,c` → `--no-extensions --extension a --extension b ...` → explicit allowlist.

**Implication for rpiv-core**: for a child spawn to inherit rpiv-core's behaviors, rpiv-core must either be globally installed (so fresh `pi` CLI invocations load it by default) OR every agent .md must list rpiv-core's path in `extensions:` frontmatter. Today's 9 bundled agents declare exactly three keys (`name`, `description`, `tools`) and omit `extensions:` — so they would inherit the child's default config. This is workable but requires explicit documentation and validation at install time.

**Two subtler consequences**:

1. **`before_agent_start` git-context hook** (`extensions/rpiv-core/index.ts:108-125`) returns `{message: {customType: "rpiv-git-context", content, display: false}}`. Per `pi-coding-agent/dist/core/messages.js:89-96`, the `role: "custom"` entry is rewritten to a synthetic `role: "user"` text block by `convertToLlm` — the `display: false` flag only controls UI rendering, the content always reaches the LLM. Under nicobailon, this hook only fires in a spawned child if rpiv-core loads in the child, AND if nicobailon's runtime emits the `before_agent_start` event at all (the library's documentation does not guarantee this lifecycle event propagates to spawned children).

2. **`active_agent` permission-system shim** at `extensions/rpiv-core/index.ts:44-46` — `pi.appendEntry("active_agent", { name: "general-purpose" })` — is a session-scoped custom entry that unblocks `pi-permission-system@0.4.1`'s input handler (see `pi-permission-system/src/index.ts:1188-1209` and `resolveAgentName` at `1109-1123`). Under @tintinweb's in-process model, this shim re-fires in each child because `session.bindExtensions` replays `session_start`. Under nicobailon's subprocess model, the child's fresh Pi process fires `session_start` independently — so the shim self-heals provided the child loads rpiv-core.

### Agent files — library-agnostic

`extensions/rpiv-core/agents.ts:36-62` writes `<PACKAGE_ROOT>/agents/*.md` into `<cwd>/.pi/agents/` on session_start. The target path `join(cwd, ".pi", "agents")` at line 46 matches both libraries' project-scope agent discovery paths:

- `@tintinweb/pi-subagents` scans `<cwd>/.pi/agents/*.md` (per `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md`).
- `nicobailon/pi-subagents` (per `agents.ts` on GitHub): walks upward from `cwd` looking for `<dir>/.agents/` (preferred) OR `<dir>/.pi/agents/` (fallback). The fallback path matches. No change to `copyBundledAgents` is required.

**The 9 bundled agents** under `/Users/sguslystyi/rpiv-pi/agents/` with `name` frontmatter keys:

| File | `name:` | `tools:` CSV |
|---|---|---|
| `codebase-analyzer.md:2,4` | `codebase-analyzer` | `read, grep, find, ls` |
| `codebase-locator.md:2,4` | `codebase-locator` | `grep, find, ls` |
| `codebase-pattern-finder.md:2,4` | `codebase-pattern-finder` | `grep, find, read, ls` |
| `integration-scanner.md:2,4` | `integration-scanner` | `grep, find, ls` |
| `precedent-locator.md:2,4` | `precedent-locator` | `bash, grep, find, read, ls` |
| `test-case-locator.md:2,4` | `test-case-locator` | `grep, find, ls` |
| `thoughts-analyzer.md:2,4` | `thoughts-analyzer` | `read, grep, find, ls` |
| `thoughts-locator.md:2,4` | `thoughts-locator` | `grep, find, ls` |
| `web-search-researcher.md:2,4` | `web-search-researcher` | `web_search, web_fetch, read, grep, find, ls` |

**Zero name collisions with nicobailon's 7 builtins** (`scout`, `planner`, `worker`, `reviewer`, `context-builder`, `researcher`, `delegate`). Open issue #55 on nicobailon warns that project-scope agents do NOT reliably shadow builtins despite README claims — irrelevant here since no names overlap.

**Frontmatter compatibility**: nicobailon's `frontmatter.ts` parser is a hand-rolled YAML subset that reads any `key: value` line and returns `Record<string, string>`. The 3 keys rpiv-pi uses (`name`, `description`, `tools`) are all recognized. Critically:
- **`extensions:` absent → permissive** (child loads all Pi extensions per system config).
- **`tools:` present with CSV** → strict allowlist, child only gets listed tools plus extension-registered tools (extension pass-through is identical to @tintinweb).
- `name` and `description` are required — absent either causes silent file skip.

`precedent-locator.md:4` is the only agent declaring `bash`. `web-search-researcher.md:4` is the only one declaring `web_search, web_fetch`. Both privileges carry over unchanged to nicobailon.

### Skill fan-out patterns — all 1-to-1 translatable

All 16 agent-dispatching skills use one of two prose patterns:

**Pattern A — inline YAML `subagent_type:`** (3 skills: `annotate-guidance`, `annotate-inline`, `write-test-cases`). Example: `skills/write-test-cases/SKILL.md:79-82`:
```
**Agent A — Web Layer Discovery:**
- subagent_type: `codebase-locator`
- Prompt: "..."
```
Rewrite target: `- agent: "codebase-locator"` + `- task: "..."`. Field names only; no structural change.

**Pattern B — free-prose "Use the Agent tool with ..."** (13 skills). Example: `skills/research/SKILL.md:50`: "Spawn analysis agents using the Agent tool. All agents run in parallel." Rewrite target: "Spawn analysis agents using the subagent tool. All agents run in parallel." The LLM reads these as guidance and constructs the tool call at inference time.

**Fan-out translation audit**:

| Skill | Structure | nicobailon fit |
|---|---|---|
| `research-codebase/SKILL.md:38-55,69` | 7-way parallel, single join at line 69 | Direct `{tasks: [...]}` replacement |
| `evaluate-research/SKILL.md:145-202` | 5 or 7 agents (A/B vs single mode), explicit prompt templates | Direct `{tasks: [...]}`, task count varies at runtime |
| `research/SKILL.md:48-90` | 3-6 question agents + always-on precedent sidecar | Direct `{tasks: [...]}` with sidecar as extra entry |
| `annotate-guidance/SKILL.md:24-92` + `annotate-inline/SKILL.md:24-90` | 2-pass: Pass 1 (2 agents) → Pass 2 (2×N agents) with join between | Two sequential `{tasks: [...]}` calls |
| `write-test-cases/SKILL.md:75-104` | Step 2 (2 agents) → Step 3 (2 agents) with data dependency at line 94 | **Clean `.chain.md` fit** OR two sequential `{tasks: [...]}` |
| `code-review/SKILL.md:47-68` | 5-7 agents, single join at line 68 | Direct `{tasks: [...]}` |
| `create-plan/SKILL.md:55-69,111-130` | Two fan-out waves gated by developer checkpoint between | Two separate `{tasks: [...]}` calls (NOT a chain) |
| `design-feature/SKILL.md:54-80` | 4-5 agents, parallel | Direct `{tasks: [...]}` |
| `design-feature-iterative/SKILL.md:60-86` (research) and `:206-253` (slices) | Parallel research + **strictly sequential slice generation** per line 209 | Research uses `{tasks: [...]}`; slices must NOT parallelize |
| `iterate-plan/SKILL.md:66-85` | Conditional 3-5 agents | Direct `{tasks: [...]}` |
| `outline-test-cases/SKILL.md:58-73` | 4 agents | Direct `{tasks: [...]}` |
| `research-questions/SKILL.md:40-53` | Variable 3-N agents | Direct `{tasks: [...]}` |
| `research-solutions/SKILL.md:39-47` | 4-5 agents | Direct `{tasks: [...]}` |
| `resume-handoff/SKILL.md:47-61` | `general-purpose` agents — **day-1 break** | Requires bundled stub (see Developer Context) |
| `validate-plan/SKILL.md:50-59` | 2 `general-purpose` agents — **day-1 break** | Requires bundled stub |

**No step-structure rewrites are required.** The two skills that look superficially complex (`research-codebase` conditional fan-out, `write-test-cases` 2-phase) translate cleanly because (a) conditional spawns resolve at LLM inference time, and (b) sequential phases are already enforced by prose join barriers with explicit "Wait for ALL agents to complete".

### Tool schema differences

| Aspect | @tintinweb | nicobailon |
|---|---|---|
| Primary tool name | `Agent` | `subagent` |
| Parameters | `{subagent_type, prompt, description}` | `{agent, task}` (single), `{tasks: [...]}` (parallel), `{chain: [...]}` (sequential), `{action: "list"\|"get"\|"create"\|"update"\|"delete", ...}` (management) |
| Parallel concurrency | Implicit (multiple tool calls in one message) | Explicit `concurrency: N`, `failFast: bool` |
| Sidecar tools | `get_subagent_result`, `steer_subagent` | `subagent_status` (for `async: true` runs) |
| Slash commands | `/agents` | `/agents`, `/run`, `/chain`, `/parallel`, `/subagents-status` |
| Unknown-agent fallback | Silent → `general-purpose` (per `src/index.ts:730-732`) | **Error** → `{isError: true, content: [{text: "Unknown agent: ..."}]}` |
| Async background execution | No | `async: true` + `subagent_status` polling (single/chain only, NOT `tasks: [...]`) |
| Git worktree isolation | No | `worktree: true` on parallel tasks or parallel-step-in-chain |
| SKILL.md injection | No | `<skill name="...">...</skill>` XML wrap via `skill:` frontmatter or per-call override |
| `.chain.md` files | No | Yes, alongside `.md` in same discovery scopes |
| Execution model | In-process (`createAgentSession`) | OS subprocess (`child_process.spawn` of `pi` CLI) |

### Package metadata

| Aspect | @tintinweb | nicobailon |
|---|---|---|
| npm name | `@tintinweb/pi-subagents` | `pi-subagents` |
| Current version | `^0.5.2` (declared at `package.json:18`) | `0.12.5` (released 2026-04-09 per CHANGELOG) |
| License | MIT (per `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md:45-50`) | MIT (per `package.json`) |
| Activity | — | 702 stars, 91 forks, 116 commits, 16 open issues (confirmed) |
| Peer deps | — | `@mariozechner/pi-agent-core: "*"`, `@mariozechner/pi-ai: "*"`, `@mariozechner/pi-coding-agent: "*"`, `@mariozechner/pi-tui: "*"`, `@sinclair/typebox: "*"` |

**Peer dep delta**: rpiv-pi's `package.json:11-16` declares 4 peer deps (pi-ai, pi-coding-agent, pi-tui, typebox). nicobailon adds a 5th — `@mariozechner/pi-agent-core` — which rpiv-pi's peer list does not currently declare. Maximally-permissive `*` ranges are compatible on both sides.

**Notable open issues**:
- **#55** (OPEN): Project-scope agents do NOT reliably shadow builtins despite README claim. Irrelevant to rpiv-pi (no name overlap).
- **#48**: Skill resolution misses `settings.packages` and task cwd. Could affect skills with non-standard paths.
- **#51**: Async subagent fails silently with relative cwd. Workaround: always pass absolute cwd.
- **#35**: Lock file contention during parallel subagent spawning. Affects large fan-outs.
- **#34**: No way to suppress builtin agents via config. Workaround unavailable.
- **No confirmed MCP first-run caching caveat** in primary sources — remove from original Discovery Summary assumptions.

## Code References

### Load-bearing hard-codings (5 files)

- `package.json:18` — `"@tintinweb/pi-subagents": "^0.5.2"` in `dependencies`
- `extensions/rpiv-core/package-checks.ts:33-34` — `hasPiSubagentsInstalled()` regex `/@tintinweb\/pi-subagents/i`
- `extensions/rpiv-core/index.ts:78-84` — session_start warning notify
- `extensions/rpiv-core/index.ts:144-228` — `/rpiv-setup` command handler (lines 154-158 reason string, line 156 pkg literal)
- `extensions/rpiv-core/templates/pi-permissions.jsonc:27-29` — allow-list entries `Agent`, `get_subagent_result`, `steer_subagent`

### Lifecycle and custom-tool registration

- `extensions/rpiv-core/index.ts:27-30` — `registerAskUserQuestionTool(pi)`, `registerTodoTool(pi)`, `registerTodosCommand(pi)` all called before any `pi.on(...)` handler
- `extensions/rpiv-core/index.ts:33-35` — `session_start` handler calls `clearInjectionState()` + `reconstructTodoState(ctx)`
- `extensions/rpiv-core/index.ts:44-46` — `pi.appendEntry("active_agent", { name: "general-purpose" })` permission-system shim, gated on `hasPiPermissionSystemInstalled()`
- `extensions/rpiv-core/index.ts:98-100` — `session_tree` handler re-runs `reconstructTodoState(ctx)`
- `extensions/rpiv-core/index.ts:108-125` — `before_agent_start` git-context injection; returns `{message: {customType: "rpiv-git-context", content, display: false}}`
- `extensions/rpiv-core/todo.ts:60-61` — `let tasks: Task[] = []; let nextId = 1;` (module-level authoritative state)
- `extensions/rpiv-core/todo.ts:496-508` — `reconstructTodoState` walks `ctx.sessionManager.getBranch()` for `toolName === "todo"` toolResult messages
- `extensions/rpiv-core/todo.ts:591-619` — `registerTodoTool(pi)` — tool name `"todo"`, schema at `:535-589`, execute at `:607-618`
- `extensions/rpiv-core/ask-user-question.ts:17-114` — `registerAskUserQuestionTool` — tool name `"ask_user_question"`, stateless, UI-bound via `ctx.ui.custom(...)`, `!ctx.hasUI` short-circuits at `:37-43`
- `extensions/rpiv-core/guidance.ts:58` — module-level `injectedGuidance: Set<string>` (process-local)

### Agent auto-copy

- `extensions/rpiv-core/agents.ts:19-25` — `PACKAGE_ROOT` / `BUNDLED_AGENTS_DIR`
- `extensions/rpiv-core/agents.ts:36-62` — `copyBundledAgents(cwd, overwrite)`; target `join(cwd, ".pi", "agents")` at `:46`, filter `.md` at `:49`

### Skill dispatch sites (16 files)

- `skills/annotate-guidance/SKILL.md:5,25,28,32,83,87,289` — Pattern A + prose
- `skills/annotate-inline/SKILL.md:5,25,28,32,81,85,285` — Pattern A + prose
- `skills/write-test-cases/SKILL.md:5,77,80,87,94,97,101,104` — Pattern A + 2-phase data dependency at `:94`
- `skills/code-review/SKILL.md:5,47-68,160` — Pattern B 5-7 agent fan-out
- `skills/create-plan/SKILL.md:55-69,111-130,419,440-446` — Two fan-out waves gated by developer checkpoint
- `skills/design-feature/SKILL.md:5,54-80` — Pattern B
- `skills/design-feature-iterative/SKILL.md:60-86,206-253` — Research parallel, slices strictly sequential (`:209` "never parallel")
- `skills/evaluate-research/SKILL.md:5,145-202` — Explicit prompt templates, A/B vs single mode
- `skills/implement-plan/SKILL.md:5` — `allowed-tools` frontmatter only
- `skills/iterate-plan/SKILL.md:5,66-85,207` — Conditional fan-out
- `skills/outline-test-cases/SKILL.md:5,58-73` — Pattern B
- `skills/research/SKILL.md:48-90` — Question agents + always-on precedent sidecar at `:84`
- `skills/research-codebase/SKILL.md:38-55,69` — 7-way fan-out
- `skills/research-questions/SKILL.md:40-53` — Variable N
- `skills/research-solutions/SKILL.md:39-47,243` — Pattern B
- `skills/resume-handoff/SKILL.md:47-61` — **literal `general-purpose` at `:48`**
- `skills/validate-plan/SKILL.md:5,50-59` — **literal `general-purpose` at `:52`**

### Permissions template

- `extensions/rpiv-core/templates/pi-permissions.jsonc:25-26` — `ask_user_question`, `todo` allow (keep unchanged)
- `extensions/rpiv-core/templates/pi-permissions.jsonc:27-29` — `Agent`, `get_subagent_result`, `steer_subagent` (delete or replace with `subagent`)
- `extensions/rpiv-core/permissions.ts:39-55` — `seedPermissionsFile()` writes once, only when file absent (line 40: `if (existsSync(PERMISSIONS_FILE)) return false`)

## Integration Points

### Inbound References (what consumes the subagent runtime)

- `extensions/rpiv-core/index.ts:79` — session_start check via `hasPiSubagentsInstalled()` guarding the missing-package notify
- `extensions/rpiv-core/index.ts:154` — `/rpiv-setup` install-confirmation flow
- All 16 skills listed above read the library's registered tool name implicitly via prose dispatch
- `README.md:18,79-81,107-109` — 4 documentation mentions

### Outbound Dependencies (what the subagent runtime depends on)

- `extensions/rpiv-core/agents.ts` is the ONLY rpiv-pi file that writes into `.pi/agents/` — no imports from `@tintinweb/pi-subagents`, purely filesystem-based
- Zero TypeScript imports from either library in rpiv-pi source — the coupling is entirely via (a) the `Agent`/`subagent` tool name, (b) the three frontmatter keys in agents/*.md, (c) the permissions allow-list entries, and (d) skill prose

### Infrastructure Wiring

- `package.json:18` — dependency declaration (forward-compat; Pi does not resolve `dependencies` today per `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md:499`)
- `~/.pi/agent/settings.json` → `packages[]` — runtime install marker, matched by `package-checks.ts:34`
- `~/.pi/agent/pi-permissions.jsonc` — seeded from `extensions/rpiv-core/templates/pi-permissions.jsonc` by `permissions.ts:seedPermissionsFile()`; existing installs retain stale entries across library swaps

## Architecture Insights

1. **rpiv-pi's coupling to its subagent library is intentionally shallow.** Zero TS imports, zero runtime dispatcher code. The entire integration is: (a) a filesystem copy into `.pi/agents/`, (b) a permissions allow-list, (c) prose in 16 SKILL.md files. This shallow coupling is what makes a library swap feasible — the planner only needs to rewrite text and config, not runtime behavior.

2. **Custom tools depend on in-process extension sharing under @tintinweb.** `ask_user_question` and `todo` are never listed in the 9 agent frontmatters' `tools:` CSV, but they work in subagent context because @tintinweb re-runs `session.bindExtensions` inside the child, which re-invokes `registerAskUserQuestionTool(pi)` and `registerTodoTool(pi)` from `extensions/rpiv-core/index.ts:29-30`. Under nicobailon's subprocess model, this inheritance chain requires rpiv-core to be discoverable by the child's fresh `pi` CLI invocation.

3. **The `active_agent` shim is a defensive workaround, not an architectural choice.** `extensions/rpiv-core/index.ts:44-46` exists solely to unblock `pi-permission-system@0.4.1`'s `resolveAgentName` fallback chain when `/skill:<name>` fires as the first user input. The string `"general-purpose"` is significant: it must match an agent name that Pi's subagent library will accept. Under @tintinweb, any string works because unknown names silently fall back. Under nicobailon, unknown names error — so a bundled `agents/general-purpose.md` becomes load-bearing.

4. **Skill prose is the LLM's instruction surface, not a data format.** When `skills/research/SKILL.md:50` says "Spawn analysis agents using the Agent tool", the LLM reads this at inference time and emits a tool call matching whatever tool the library has registered. This means the tool-name rewrite is not a runtime breaking change — it's a "LLM reads outdated instructions and calls a tool that doesn't exist" failure mode. Skills must be updated in lockstep with the library swap.

5. **Fan-out semantics already match nicobailon's `{tasks: [...]}` model.** Every parallel fan-out in the 16 skills is already expressed as "spawn multiple agents in parallel, wait for all to complete before proceeding". The difference between "multiple `Agent` tool calls in one message" (today) and "one `subagent({tasks: [...]})` call" (nicobailon) is shape, not semantics. No skill anywhere in rpiv-pi depends on streaming individual agent results mid-batch.

## Precedents & Lessons

3 similar past changes analyzed. All within the last 30 days; this repo has only 4 commits total (first commit 2026-04-10).

- **Commit `a01a4a3`** — "Initial rpiv-pi package" (2026-04-10). Introduced every piece of subagent wiring in a single atomic commit. The vendor-then-rollback episode for `@tintinweb/pi-subagents` is documented inside `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md:456-551`, not in git history. **Key lesson**: running two subagent libraries side-by-side is blocked by tool-name double-registration at session load — "On the first `pi -p 'exit'` smoke test after vendoring, the loader emitted three 'Tool X conflicts with ...' errors at session startup because the developer's global settings.json already loaded `npm:@tintinweb/pi-subagents`" (plans:470-480). Any swap to nicobailon must be a cold cutover, not an incremental adoption.

- **Commit `66eaea3`** — "Migrate all skills to Pi-native patterns" (2026-04-10, 21 files, -601/+242 lines). Bulk text-replacement across all skills was done in one commit with zero automated verification. The only smoke test is "subagent self-identifies its type in response" — a manual check documented at `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md:550`. **Key lesson**: plan a library swap the same way — canary ONE skill first (probably `commit` or `validate-plan`), then expand.

- **Commit `8610ae5`** — "Refactor rpiv-core extension into focused modules" (2026-04-10). Moved the `active_agent` shim from a monolithic `index.ts` into the current modular layout at `:44-46`. No logic change. **Key lesson**: the shim's coupling to `@tintinweb/pi-subagents` (via the silent `general-purpose` fallback) survived the refactor unchanged, which means removing `@tintinweb` requires a coordinated change to the shim's constant OR a bundled agent that satisfies the literal name.

**Composite lesson**: The precedent for a library swap already exists — Decision 1 in `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md:90-102` rejected vendoring `pi-permission-system@0.4.1` in favor of "auto-seed + documented sibling install via `/rpiv-setup`". This identical pattern was later applied (after Phase 2 rollback) to `@tintinweb/pi-subagents`. A nicobailon swap should copy this pattern a third time: no vendoring, new `hasNicobailonInstalled()` predicate (or renamed `hasPiSubagentsInstalled()`), new install command in `/rpiv-setup`, new allow-list entries in `pi-permissions.jsonc`, AND REMOVE the 3 stale `Agent`/`get_subagent_result`/`steer_subagent` entries.

## Historical Context (from thoughts/)

- `thoughts/shared/questions/2026-04-11_06-36-22_pi-subagents-alt-library.md` — the 10-question discovery doc this research consumes (dated 2026-04-11, git_commit d484cb3)
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — prior research that evaluated `@tintinweb/pi-subagents` vs the bundled pi-coding-agent example; nicobailon was not considered
- `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md` — the migration design document whose Decision 1 (permission-system auto-seed pattern) and Decisions 7-8 (vendor pi-subagents, later reversed) are directly relevant to swap planning
- `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md` — contains the Phase 2 DEVIATION section (lines 456-551) documenting the vendor-then-rollback episode in full

## Developer Context

**Q (`extensions/rpiv-core/index.ts:29-30, 108-125, 44-46`): nicobailon spawns each subagent as a fresh `pi` CLI subprocess. rpiv-core's custom tools (`ask_user_question`, `todo`), `before_agent_start` git hook, and `active_agent` shim all rely on in-process inheritance under @tintinweb. Under nicobailon, the child only sees rpiv-core if Pi loads it from the child's own config OR the agent .md lists rpiv-core's path in `extensions:`. How should the evaluation treat this gap?**
A: Net-gain analysis first (chains/worktree/async). Postpone the rewrite verdict and focus the research on whether new capabilities deliver enough value to pay the subprocess tax.

**Q (`skills/write-test-cases/SKILL.md:75-104`, `skills/evaluate-research/SKILL.md:145-198`, `skills/research/SKILL.md:84-90`): Which new nicobailon capability is the strongest leverage point that would actually justify a swap?**
A: `.chain.md` for `write-test-cases`. The Step 2→Step 3 data-dependent handoff at `:94` is the cleanest chain fit in the codebase — a `.chain.md` file hard-codes the pipeline and stops relying on prose barriers. Concrete, testable, touches one skill.

**Q (`skills/validate-plan/SKILL.md:52`, `skills/resume-handoff/SKILL.md:48`, `extensions/rpiv-core/index.ts:45`): Both skills literally dispatch `general-purpose`. @tintinweb silently falls back at `src/index.ts:730-732`. nicobailon rejects with `Unknown agent: general-purpose`. How should a migration resolve this day-1 break?**
A: Bundle `agents/general-purpose.md` stub — frontmatter `name: general-purpose`, `tools: read, grep, find, ls, bash, edit, write`, brief description. `copyBundledAgents` will ship it on session_start. Zero churn for validate-plan, resume-handoff, and the permission-system shim.

## Related Research

- Questions source: `thoughts/shared/questions/2026-04-11_06-36-22_pi-subagents-alt-library.md`
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md`
- `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md`
- `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md`

## Open Questions

1. **Does nicobailon's `before_agent_start` lifecycle event propagate to spawned child processes?** The library's documentation is silent on whether Pi lifecycle events registered in a local extension fire inside a `child_process.spawn`-ed child. Empirical verification required before committing to the git-context hook continuing to work post-swap.

2. **Does `createBranchedSession(leafId)` in nicobailon's `fork` mode preserve custom session entries like `pi.appendEntry("active_agent", ...)`?** The README/source are silent on custom `appendEntry` keys — only conversation message branching is explicitly documented. Relevant because the permission-system shim at `index.ts:45` writes a session entry that must survive into child sessions (or be re-seeded by the child's own `session_start`).

3. **Do existing user installs with a seeded `~/.pi/agent/pi-permissions.jsonc` containing the `Agent`, `get_subagent_result`, `steer_subagent` entries need migration?** `seedPermissionsFile()` at `extensions/rpiv-core/permissions.ts:40` only writes when the file is absent, so existing installs keep stale entries. Not a security risk (the tool names don't exist in nicobailon anyway), but the migration plan should address the cleanup.

4. **What is rpiv-pi's install posture with respect to `@mariozechner/pi-agent-core`?** nicobailon lists it as a fifth peer dep at `*`, but rpiv-pi's `package.json:11-16` declares only 4 peer deps. Not a blocker (both sides are `*`), but a migration plan should decide whether to add the fifth peer to rpiv-pi's own `package.json`.
