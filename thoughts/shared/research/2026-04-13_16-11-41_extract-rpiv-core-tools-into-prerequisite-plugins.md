---
date: 2026-04-13T16:11:41-04:00
researcher: Claude Code
git_commit: 7525a5d
branch: master
repository: rpiv-pi
topic: "Assess extracting AskUserQuestion, Todos, and Advisor into separate prerequisite plugins"
tags: [research, codebase, rpiv-core, ask-user-question, todo, advisor, plugin-extraction, permissions, lifecycle]
status: complete
questions_source: "thoughts/shared/questions/2026-04-13_15-33-01_extract-rpiv-core-tools-into-prerequisite-plugins.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
last_updated_note: "Added follow-up research for extracting Brave web-tools and removing pi-permission-system as a prerequisite"
---

# Research: Assess extracting AskUserQuestion, Todos, and Advisor into separate prerequisite plugins

## Research Question
Can `ask_user_question`, `todo`, and `advisor` be extracted from `extensions/rpiv-core/` into three separately-released Pi plugins that `rpiv-pi` treats as prerequisites, and what contractual / lifecycle / install-path coupling must be re-architected for that to work?

## Summary
Extraction is feasible under **full decomposition** (developer decision): each capability ships as its own Pi plugin, and `rpiv-pi` becomes a skills-and-orchestration package that hard-requires the three siblings. Three structural blockers exist today and all must be re-architected:

1. **Permissions seeding is monolithic and write-once.** `extensions/rpiv-core/permissions.ts:40-42` returns early if `~/.pi/agent/pi-permissions.jsonc` exists, and the bundled template is copied verbatim. Multiple plugins cannot coseed — the first plugin that runs wins. A fragment-merge seeder is required.
2. **Todo's module-level state + overlay + replay hooks + `/todos` + `tool_execution_end` filter all couple on the literal `"todo"` tool name.** Todo must move as a 4-file unit: `todo.ts`, `todo-overlay.ts`, a new plugin `index.ts` lifting five hook call sites, and a permission fragment. Extraction is self-consistent but not trivially splittable.
3. **Cross-plugin hook ordering is not under plugin-author control.** `@mariozechner/pi-coding-agent` loader orders extensions by filesystem discovery; there is no `pi.dependencies` / priority field. Precedent commit `be0a014` shows `rpiv-core` already required a `before_agent_start` re-assertion because `pi-permission-system` rebuilds active tools; extracting advisor preserves but does not widen this risk because no extracted plugin introduces new `before_agent_start` mutations beyond advisor's existing strip.

`ask_user_question` (117L, stateless) is the clean baseline — extraction requires only removing two lines from `index.ts` and contributing a permission fragment. `advisor` (617L, self-contained file, persists `~/.config/rpiv-pi/advisor.json`) is extractable but requires a config-path cutover (developer chose hard cutover — users lose saved model on upgrade). `todo` (769L + 244L overlay) is the hardest and argues for moving as a single atomic unit including its overlay widget.

No native Pi mechanism exists for expressing plugin-to-plugin dependencies (verified via `badlogic/pi-mono` docs and issues #326, #645, #1831). Recommended pattern is runtime check at `session_start` + `/rpiv-setup` hard-fail with actionable error, mirroring VS Code's `extensionDependencies` semantics via Obsidian-style runtime enforcement.

## Detailed Findings

### ask_user_question — Cleanest Extraction Candidate

**Registration chain.** `package.json:7-10` declares `pi.extensions: ["./extensions"]`. Loader discovers `rpiv-core/`; composition root `extensions/rpiv-core/index.ts:29` calls `registerAskUserQuestionTool(pi)` at line 34. The registration module at `extensions/rpiv-core/ask-user-question.ts:17-35` is self-contained: zero imports from sibling rpiv-core modules.

**Contract surface.** `OptionSchema = Type.Object({ label, description? })` at `ask-user-question.ts:12-15`; outer `parameters` at lines 28-35 has `{ question, header?, options: OptionSchema[], multiSelect? }`. `multiSelect` is declared but currently dead — execute path at line 60 always uses single-select `SelectList` — future multi-question-batch parity work lands here.

**Teaching surface.** `promptSnippet` at `ask-user-question.ts:22` and `promptGuidelines` at lines 23-27 (three bullets). Advisor research (`thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md`) explicitly cites a past "ask_user_question mistake" where missing `promptSnippet` made the tool invisible to the LLM — these fields must be preserved verbatim on extraction.

**Permission path.** `templates/pi-permissions.jsonc:25` has `"ask_user_question": "allow"`. Seeder at `permissions.ts:39-55` copies the entire template verbatim once.

**Extraction blast radius.** Two line deletions in `index.ts` (import at 23, call at 34); move `ask-user-question.ts` verbatim; ship a permission fragment. No state, no lifecycle hook, no cross-session persistence.

### advisor — Self-Contained but Persistence-Coupled

**Registration chain.** Three registrations at `index.ts:37-39` (`registerAdvisorTool`, `registerAdvisorCommand`, `registerAdvisorBeforeAgentStart`) plus `restoreAdvisorState(ctx, pi)` call at `index.ts:48` inside the `session_start` handler.

**Config persistence.** `ADVISOR_CONFIG_PATH` at `advisor.ts:55` = `join(homedir(), ".config", "rpiv-pi", "advisor.json")` — the `rpiv-pi` dirname is baked in. `loadAdvisorConfig()` at `advisor.ts:57-64` silently returns `{}` on parse failure (line 60-63 catch), meaning a reshape of the config field silently resets advisor to OFF on next session (line 139 early returns when `modelKey` is falsy). `saveAdvisorConfig()` at lines 66-81 writes JSON and chmods `0o600` at line 77.

**In-memory state.** `advisor.ts:114-115` — `let selectedAdvisor` / `let selectedAdvisorEffort`; accessors at lines 117-131.

**Session-lifecycle dependencies.** `restoreAdvisorState` at `advisor.ts:137-171` calls `ctx.modelRegistry.find(...)` at line 144 (returns `undefined` → `notify warning` at 147-150; the only user-visible drift signal), sets in-memory state, then *adds* `"advisor"` to active tools (`advisor.ts:160-163`) via `pi.getActiveTools()` read + `pi.setActiveTools()` write. Must run during `session_start` before the first `before_agent_start` so the strip hook does not filter legitimately-restored advisor.

**Active-tools strip.** `registerAdvisorBeforeAgentStart` at `advisor.ts:369-378` registers a `before_agent_start` handler that reads `pi.getActiveTools()`, filters out `"advisor"` when `getAdvisorModel()` is undefined, writes back. Default-OFF enforcement. Precedent commit `be0a014` added this specifically because `pi-permission-system` rebuilds active tools each `before_agent_start` — extracted advisor plugin must register this hook on its own `pi` instance; Pi guarantees `session_start` for all extensions completes before any `before_agent_start` fires, so the restore-then-strip ordering survives.

**Permissions gap.** `templates/pi-permissions.jsonc` has NO `"advisor": "allow"` entry. Tool inherits `defaultPolicy.tools: "ask"` at line 13, producing an interactive prompt on every advisor call when pi-permission-system is installed. This is a latent bug today; extraction is the natural moment to address it.

**Model registry coupling.** `executeAdvisor` at `advisor.ts:191-322` uses `ctx.modelRegistry.find(provider, modelId)` (line 144, for restore) and `ctx.modelRegistry.getApiKeyAndHeaders(advisor)` (line 207, for completion). Branch serialization via `convertToLlm()` + `serializeConversation()` from `@mariozechner/pi-coding-agent` (lines 23-24, 224-228); in-process `completeSimple` from `@mariozechner/pi-ai` at line 247.

**Extraction blast radius.** Four deletions in `index.ts` (imports at 26, register calls 37-39, restore call at 48). Move `advisor.ts` verbatim. **Developer decision: hard config-path cutover** to `~/.config/rpiv-advisor/advisor.json` — users lose saved model on upgrade (silent because `advisor.ts:139` early-returns when `modelKey` falsy; no warning surfaces).

### todo — Structurally Hardest, Moves as 4-File Unit

**Registration + lifecycle.** `index.ts:24-25` imports; `index.ts:35-36` registrations; `let todoOverlay: TodoOverlay | undefined` at line 31; five lifecycle hooks call into todo state/overlay — `session_start:45,56-60`, `session_compact:116-117`, `session_tree:129-130`, `session_shutdown:123`, `tool_execution_end:134-139`. The `tool_execution_end` filter at line 135 (`event.toolName !== "todo" || event.isError`) pins the tool name.

**Authoritative state machine.** `todo.ts` types at lines 22-43 (`TaskStatus`, `TaskAction`, `Task`, `TaskDetails`); `VALID_TRANSITIONS` DAG at lines 49-54; module state `let tasks / let nextId` at 60-65; pure reducer `applyTaskMutation(state, action, params)` at 172-484 with branches for create/update/list/get/delete/clear. Exported `getTodos()` at line 63 is the single in-memory authority consumed by the tool executor, `renderCall`, `/todos` handler, and `TodoOverlay`.

**Replay.** `reconstructTodoState(ctx)` at `todo.ts:496-508` walks `ctx.sessionManager.getBranch()`, filters `msg.toolName === "todo"` (line 502), type-guards via `isTaskDetails()` at lines 490-494 (duck-types `Array.isArray(v.tasks) && typeof v.nextId === "number"`), overwrites module state with the final snapshot. Called from three hooks (session_start/session_compact/session_tree) but **deliberately not from `tool_execution_end`** because the branch is stale at that point — `message_end` runs after `tool_execution_end`. The `index.ts:136-137` and `todo-overlay.ts:9-12` comments are the specification of this invariant.

**Tool registration.** `registerTodoTool(pi)` at `todo.ts:612-704` with `TodoParams` schema at 556-610 (`action: StringEnum([create/update/list/get/delete/clear])`, `subject?`, `description?`, `activeForm?`, `status?: StringEnum([pending/in_progress/completed/deleted])`, `blockedBy?`, `addBlockedBy?`, `removeBlockedBy?`, `owner?`, `metadata?`, `id?`, `includeDeleted?`). `renderCall` at 644-662, `renderResult` at 664-702. Tool-name literal `"todo"` at line 614; comment at `todo.ts:8-10` explicitly pins it to the permission entry.

**/todos command.** `registerTodosCommand(pi)` at `todo.ts:710-768` reads module-level `tasks` directly at line 718; grouped output via `ctx.ui.notify` at line 765. No state writes.

**Overlay widget.** `extensions/rpiv-core/todo-overlay.ts` imports only `getTodos`, `Task`, `TaskStatus` from `./todo.js` (line 19) plus pi libs. `WIDGET_KEY = "rpiv-todos"` at 23. `TodoOverlay.setUICtx(ctx)` at 55-61 identity-compares; `update()` at 68-104 reads `getTodos()` live, unregisters widget when empty, otherwise `setWidget(WIDGET_KEY, factory, { placement: "aboveEditor" })` at 85-99. `renderWidget` at 113-208 — overflow path drops completed tasks before truncating. `dispose()` at 237-244.

**Files that must move as a unit.**
1. `extensions/rpiv-core/todo.ts` (769L)
2. `extensions/rpiv-core/todo-overlay.ts` (244L)
3. New plugin `index.ts` lifting five hook call sites from `rpiv-core/index.ts`
4. Permission fragment (`todo: "allow"`)

**Tool-name replay contract.** Renaming `"todo"` would (a) break replay filter at `todo.ts:502` for existing sessions, (b) break overlay refresh at `index.ts:135`, (c) leave permission entry at `templates/pi-permissions.jsonc:26` stale (already-seeded user files still read old name), (d) fall through to `defaultPolicy.tools: "ask"` (line 12) producing permission prompts. Preserving the name is the only safe extraction.

### Lifecycle Seams Across Multiple Plugins

**All hook registrations in rpiv-core/** (from `extensions/rpiv-core/index.ts`): `session_start:42-110`, `session_compact:113-118`, `session_shutdown:121-125`, `session_tree:128-131`, `tool_execution_end:134-139`, `tool_call:142-144`, `before_agent_start` (git-context):147-164. Plus advisor's `before_agent_start` at `advisor.ts:369-378` registered via `registerAdvisorBeforeAgentStart(pi)` at `index.ts:39`.

**Pi's hook dispatcher guarantees** (verified via `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/runner.js`):
- Generic emit (`runner.js:396-426`): `for (const ext of this.extensions) for (const handler of handlers)` — sequential, awaited, no reorder. Used for session_start/compact/tree/shutdown/tool_execution_end.
- `emitBeforeAgentStart` (`runner.js:581-629`): accumulates `result.message` into `messages: []` at 602; chains `result.systemPrompt` through `currentSystemPrompt` at 584, 604-607. Later plugins see earlier plugins' modified prompt.
- `emitToolCall` (`runner.js:474-492`): `result.block` short-circuits; otherwise overwrites.

**Extension order** is set by `loader.js:400-434` discovery: (1) project `.pi/extensions/`, (2) global `agentDir/extensions/`, (3) `pi.extensions` from package.json. Within each category, `fs.readdirSync` has no sort; `addPaths` dedups via Set preserving first-seen order. **No priority/depends/after/before field exists** in Pi's extension manifest.

**Ordering constraints that must be preserved**:
1. `reconstructTodoState` → `TodoOverlay.update()` — both read/write `tasks/nextId` in `todo.ts`. **Same plugin** in full-decomposition; no cross-plugin issue.
2. `restoreAdvisorState` → advisor's `before_agent_start` strip — both read/mutate `selectedAdvisor` in `advisor.ts:114`. **Same plugin**. Pi's global event serialization guarantees `session_start` completes before any `before_agent_start` fires, so timing survives extraction.
3. Advisor strip + git-context `before_agent_start` — both in `rpiv-core/index.ts` today, safely compose via `messages[]` accumulation. After split, the two handlers live in different plugins but both append to `messages[]`; no conflict.
4. `seedPermissionsFile` + package warnings — piggyback on `session_start` at `index.ts:95, 104-109`. Independent of todo/advisor state; can stay with `rpiv-pi` orchestrator.

**The one real cross-plugin hazard**: if a future plugin reads `pi.getActiveTools()` inside its own `before_agent_start` to make a decision (e.g., "is advisor enabled?"), its observation depends on whether it runs before or after the advisor strip — and that order is determined by filesystem discovery, not by plugin-author intent. Precedent commit `be0a014` already had to fight this with `pi-permission-system`. Today only advisor mutates active tools from inside `before_agent_start`; no new mutations are introduced by extraction.

### Installation Paths Under Extraction

**Current `/rpiv-setup`** at `index.ts:184-267`: builds a `missing[]` array at 192-204 (two hardcoded entries: `@tintinweb/pi-subagents`, `pi-permission-system`), confirms at 214-227, sequentially installs via `pi.exec("pi", ["install", pkg])` at 231-249, reports at 251-266. Scales N-way — three push-blocks added for each extracted plugin, no loop changes needed.

**Current `session_start` warning** at `index.ts:104-109`: single hardcoded block, `ctx.ui.notify(..., "warning")`. To scale, build a `missing: string[]` array mirroring `/rpiv-setup`'s pattern and emit one aggregated notification. Severity `"warning"` is non-blocking today — Pi has no hook that intercepts `/skill:<name>` to pre-check tool availability.

**Current manual path** `README.md:24-32`: only two `pi install` commands listed (`rpiv-pi` local path, `npm:pi-permission-system`). `@tintinweb/pi-subagents` is documented as transitive via npm `dependencies` at `package.json:18` — this transitive mechanism **does not generalize** to Pi-package siblings. Extraction forces README to grow to list all three extracted plugins explicitly, and install order matters because `hasRpivXxxInstalled()` checks at `session_start` would emit false warnings if rpiv-pi were installed before siblings.

**Permissions under multi-plugin install**: `permissions.ts:39-55` is fire-once / copy-verbatim. If each sibling plugin ships its own seeder, only the first to run wins — subsequent plugins silently skip at lines 40-42. Full decomposition forces a fragment-merge seeder: read existing file, parse JSONC, add missing `tools.<name>` keys, preserve user edits.

**No plugin-dependency field in Pi manifest** (confirmed via docs at https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md): only `extensions`, `skills`, `prompts`, `themes`, plus gallery metadata. Third-party runtime deps go in `dependencies`. Pi-mono issues #326 (unified extension loading), #645 (extension package management), #1831 (global install module resolution) are related but no `pi.dependencies` analog has landed.

### Compatibility Surface — Where Tool Names Appear

**Skill prose references to `ask_user_question`** (30 sites across 12 skills): `skills/write-plan/SKILL.md:68`, `skills/write-test-cases/SKILL.md:181,186`, `skills/implement-plan/SKILL.md:50`, `skills/research-questions/SKILL.md:116`, `skills/iterate-plan/SKILL.md:107`, `skills/annotate-guidance/SKILL.md:74,135,140`, `skills/commit/SKILL.md:43`, `skills/research/SKILL.md:128,130,139,141`, `skills/resume-handoff/SKILL.md:104`, `skills/outline-test-cases/SKILL.md:139,144,189,222,228`, `skills/design/SKILL.md:145,147,152,181,211,293,327`, `skills/annotate-inline/SKILL.md:72,133,138`. All are prose instructions to the LLM — Markdown, no guards.

**Skill tool-name references to `todo`**: `skills/code-review/SKILL.md:44` (only explicit backticked `todo` reference). Prose-only "todo list" wording that the LLM resolves to the `todo` tool: `skills/write-plan/SKILL.md:230`, `skills/implement-plan/SKILL.md:24,57`, `skills/validate-plan/SKILL.md:143`, `skills/iterate-plan/SKILL.md:178`, `skills/resume-handoff/SKILL.md:109,117,206`.

**Skill references to `advisor`**: **zero**. Advisor is entirely user-facing (invoked via `/advisor` command and `before_agent_start` activation); no skill invokes it. Safest tool to extract from a skill-coupling standpoint.

**Agent references**: `/Users/sguslystyi/rpiv-pi/agents/*.md` have **zero** references to any of the three tool names. Developer clarified during checkpoint: agents use skills, not tools directly — so subagent inheritance of extracted plugins is not a problem for current agent definitions.

**Documentation drift already present**:
- `README.md:44-49` extension table lists `rpiv-core` tools as `ask_user_question, todo` (missing advisor) and commands as `/todos, /rpiv-update-agents, /rpiv-setup` (missing `/advisor`).
- `extensions/rpiv-core/index.ts:11-12` docblock lists `/todos, /rpiv-update-agents, /rpiv-setup` but omits `/advisor` — drift inside the file that registers `/advisor` at line 38.
- `.rpiv/guidance/architecture.md:27-28` does list `/advisor` — guidance is ahead of README.
- `.rpiv/guidance/skills/architecture.md:8` declares `extensions/rpiv-core/` provides the three tools; the strongest single-line contract statement.

### Breaking-Change Detection Matrix

| Break | Install time | session_start | tool-call time | Silent drift |
|---|---|---|---|---|
| `todo` → `todos` rename | None | None | Unknown tool error | Permissions fall-through to `ask`, overlay stops, replay drops history |
| Remove `TaskAction` value | None | None | Partial (validator rejects new, old branch replays) | Renderer shows raw action string |
| `ask_user_question` `Option.label` → `title` | None | None | Parameter validation error | Model may compensate via injected schema |
| advisor.json field reshape | None | Silent reset to OFF (`advisor.ts:139`) | Not applicable | Yes — user never told config was discarded |
| Missing extracted plugin package | None (no probe exists for siblings today) | None (until `hasRpivXxxInstalled` added) | Unknown tool — skill stalls | None — loud failure per call |

## Code References

### Tool Registrations
- `extensions/rpiv-core/ask-user-question.ts:17-35` — `registerAskUserQuestionTool(pi)` single entry point
- `extensions/rpiv-core/ask-user-question.ts:12-15` — `OptionSchema`
- `extensions/rpiv-core/ask-user-question.ts:28-35` — outer `parameters`
- `extensions/rpiv-core/ask-user-question.ts:60-90` — `ctx.ui.custom` happy path
- `extensions/rpiv-core/ask-user-question.ts:100-106` — `ctx.ui.input` Other fallback
- `extensions/rpiv-core/todo.ts:556-610` — `TodoParams` schema
- `extensions/rpiv-core/todo.ts:612-704` — `registerTodoTool(pi)` with execute + renderers
- `extensions/rpiv-core/todo.ts:710-768` — `registerTodosCommand(pi)`
- `extensions/rpiv-core/todo.ts:172-484` — `applyTaskMutation` reducer
- `extensions/rpiv-core/todo.ts:496-508` — `reconstructTodoState` replay
- `extensions/rpiv-core/advisor.ts:350-363` — `registerAdvisorTool(pi)`
- `extensions/rpiv-core/advisor.ts:409-616` — `registerAdvisorCommand(pi)` + effort picker
- `extensions/rpiv-core/advisor.ts:369-378` — `registerAdvisorBeforeAgentStart(pi)` strip
- `extensions/rpiv-core/advisor.ts:137-171` — `restoreAdvisorState`
- `extensions/rpiv-core/advisor.ts:191-322` — `executeAdvisor` (auth, serialize, completeSimple)

### Overlay
- `extensions/rpiv-core/todo-overlay.ts:55-61` — `setUICtx(ctx)` identity check
- `extensions/rpiv-core/todo-overlay.ts:68-104` — `update()` lifecycle
- `extensions/rpiv-core/todo-overlay.ts:113-208` — `renderWidget(theme, width)` overflow logic
- `extensions/rpiv-core/todo-overlay.ts:237-244` — `dispose()`

### Composition Root + Lifecycle
- `extensions/rpiv-core/index.ts:29-268` — `default export(pi: ExtensionAPI)`
- `extensions/rpiv-core/index.ts:34-39` — tool/command registrations
- `extensions/rpiv-core/index.ts:42-110` — `session_start` handler
- `extensions/rpiv-core/index.ts:113-118` — `session_compact`
- `extensions/rpiv-core/index.ts:121-125` — `session_shutdown`
- `extensions/rpiv-core/index.ts:128-131` — `session_tree`
- `extensions/rpiv-core/index.ts:134-139` — `tool_execution_end` todo-overlay refresh
- `extensions/rpiv-core/index.ts:142-144` — `tool_call` guidance
- `extensions/rpiv-core/index.ts:147-164` — `before_agent_start` git-context
- `extensions/rpiv-core/index.ts:184-267` — `/rpiv-setup` command

### Permissions + Package Probes
- `extensions/rpiv-core/permissions.ts:39-55` — write-once seeder (the blocker for multi-plugin coseed)
- `extensions/rpiv-core/templates/pi-permissions.jsonc:20-34` — monolithic allow-list
- `extensions/rpiv-core/package-checks.ts:15` — `PI_AGENT_SETTINGS` path
- `extensions/rpiv-core/package-checks.ts:21-31` — `readInstalledPackages()`
- `extensions/rpiv-core/package-checks.ts:33-39` — `hasPiSubagentsInstalled` / `hasPiPermissionSystemInstalled` substring probes
- `extensions/rpiv-core/index.ts:104-109` — session_start warning pattern for missing siblings

## Integration Points

### Inbound References (consumers of extracted capabilities)
- `extensions/rpiv-core/index.ts:23-26,34-39,45,48,56-60,117,123,129-130,135-138` — every current caller/hook-site for extracted tools
- `extensions/rpiv-core/todo-overlay.ts:19` — imports `getTodos, Task, TaskStatus` from `./todo.js`
- `templates/pi-permissions.jsonc:25-26` — permission entries (advisor intentionally absent)
- Skills (`skills/**/SKILL.md`) — 30 `ask_user_question` sites + 1 explicit `todo` site + ~7 prose "todo list" sites (enumerated in Compatibility Surface section above)
- `.rpiv/guidance/skills/architecture.md:8,49,78` — strongest contractual statement that `rpiv-core` provides these tools

### Outbound Dependencies (what extracted plugins need)
- `@mariozechner/pi-coding-agent` — `ExtensionAPI`, `DynamicBorder`, `convertToLlm`, `serializeConversation`
- `@mariozechner/pi-ai` — `completeSimple`, `StringEnum`, `ThinkingLevel`, `Model`, `supportsXhigh`
- `@mariozechner/pi-tui` — `Container`, `SelectList`, `Text`, `Spacer`, `truncateToWidth`, `TUI`, `Theme`
- `@sinclair/typebox` — `Type`
- Node stdlib — `fs`, `path`, `os`
- `ctx.sessionManager.getBranch()` (todo replay), `ctx.modelRegistry.find()` / `getApiKeyAndHeaders()` (advisor)
- `pi.getActiveTools()` / `pi.setActiveTools()` (advisor restore + strip)
- `pi.appendEntry()` (active_agent seed, currently in rpiv-core; stays with orchestrator)

### Infrastructure Wiring
- `package.json:7-10` — `pi.extensions: ["./extensions"]` (loader discovery; no `pi.dependencies` field exists)
- `~/.pi/agent/settings.json:packages[]` — where `readInstalledPackages()` looks (substring match, no semver parsing)
- `~/.pi/agent/pi-permissions.jsonc` — seeded once from `templates/pi-permissions.jsonc`
- `~/.config/rpiv-pi/advisor.json` — advisor config (developer chose hard cutover to `~/.config/rpiv-advisor/`)

## Architecture Insights

1. **Full decomposition is viable but requires a fragment-merge permissions seeder.** The current `seedPermissionsFile()` is fire-once copy-verbatim; multi-plugin coseed fails silently. Either (a) introduce a merge-on-seed helper that reads existing JSONC, adds missing allow entries, preserves user edits — each plugin ships its own fragment; or (b) keep the canonical template in `rpiv-pi` that lists all siblings' tools, and siblings ship no permission fragment. Option (a) matches full-decomposition cleanly; option (b) re-couples rpiv-pi to sibling tool names.

2. **Todo extraction requires atomic 4-file move.** `todo.ts` + `todo-overlay.ts` + new plugin `index.ts` (lifting five hook call sites) + permission fragment. The module-level `let tasks / let nextId` ESM singleton is an implicit coupling between the tool executor, `/todos` command, `renderCall`, `getTodos()`, and `TodoOverlay` — turning this into a pi-provided session store is a larger refactor than extraction itself. Keep the ESM singleton inside the extracted plugin.

3. **Tool names are load-bearing contracts.** Preserving `"ask_user_question"`, `"todo"`, `"advisor"` verbatim means skills prose, permission entries, replay filters, and overlay refresh all continue working. Any rename requires coordinated migration across 30+ skill sites, permission file re-seed, and branch-replay compatibility shim. Don't rename during extraction.

4. **Hook ordering between independently-installed plugins is not under plugin-author control.** Pi loads extensions in filesystem discovery order. The one real hazard is active-tool mutation inside `before_agent_start` — today only advisor does this, and the precedent at `be0a014` is the template. Don't add new `before_agent_start` active-tool mutations in extracted plugins without a re-assertion pattern.

5. **There is no native Pi plugin-dependency manifest.** Web search confirms `@mariozechner/pi-coding-agent` exposes only `extensions`, `skills`, `prompts`, `themes` in the `pi` manifest field (pi-mono issues #326, #645, #1831 track related infra but no `pi.dependencies` has landed). Recommended pattern: runtime check at `session_start` + `/rpiv-setup` hard-fail with actionable install commands. This mirrors VS Code's `extensionDependencies` semantics via Obsidian-style runtime enforcement.

6. **Breaking-change detection is weak by default.** Tool-name rename, schema reshape, config-file field rename all fail at tool-call time or silently drift — there is no install-time or session_start validation of schemas. Hard cutover on `~/.config/rpiv-pi/advisor.json` (developer decision) will silently reset users' advisor-model configuration on upgrade; the `session_start` warning path at `index.ts:104-109` is the only place to add migration messaging.

7. **Advisor is the natural moment to fix the missing permission entry.** `templates/pi-permissions.jsonc` omits `"advisor"` today, inheriting `defaultPolicy.tools: "ask"` — every advisor call prompts the user when `pi-permission-system` is installed. Extraction is the moment to fix this in a fragment owned by the extracted plugin.

## Precedents & Lessons

6 similar past changes analyzed. Key commits:
- `a01a4a3` — "Initial rpiv-pi package" (2026-04-10): shipped with `web-tools` as sibling extension + `/rpiv-setup` + `readInstalledPackages` probe from day 1. The sibling pattern is battle-tested as an installer flow — but no module has ever migrated outward from `rpiv-core`.
- `8610ae5` — "Refactor rpiv-core extension into focused modules" (2026-04-10): carved the module boundaries required for extraction; `registerXxxTool` functions are the exact API surface a prerequisite plugin would export.
- `e4e03ab` — "Add advisor tool and /advisor command to rpiv-core" (2026-04-11): 400-line addition, 3 lines in `index.ts` — closest precedent for adding a self-contained tool plugin.
- `be0a014` — "Strip advisor tool from active tools when disabled": cross-plugin ordering fix that relied on `rpiv-core` loading after `pi-permission-system`. Required adding a `before_agent_start` handler to re-assert the exclusion on every turn.
- `bb7e30f` — "Persist advisor model + effort across sessions via ~/.config/rpiv-pi/advisor.json": sets the precedent for config-file ownership; extraction forces the path cutover decision.
- `33550c5` — "Add CC-parity todo tool and persistent overlay widget" (5520 lines): the precedent for moving todo + overlay + `/todos` + replay hooks as one atomic unit.

Composite lessons:
- **Follow-up cadence after tool additions is high.** Advisor (`e4e03ab`) took 6 follow-ups over 2 days (`b50fd50`, `b7651a9`, `26f9c58`, `be0a014`, `bb7e30f`, `33825e2`). Budget for post-split bugfix passes; extraction is not a one-shot move.
- **Load order between plugins silently corrupts active-tool sets.** `pi-permission-system` rebuilds active tools every `before_agent_start`; `rpiv-core` survives only because it loads after. Extracted plugins multiply this surface — document load-order contract or use `before_agent_start` re-assertion modeled on `be0a014`.
- **`promptSnippet` / `promptGuidelines` are load-bearing.** Prior advisor research cites a past "ask_user_question mistake" where missing `promptSnippet` made the tool invisible to the LLM. Extraction must preserve these verbatim.
- **No precedent exists for outward extraction yet.** `web-tools` was a sibling from day 1; nothing has migrated from `rpiv-core` into a separately-released plugin. Treat this as greenfield; mine `e4e03ab` + `8610ae5` as the closest templates.

## Historical Context (from thoughts/)
- `thoughts/shared/questions/2026-04-13_15-33-01_extract-rpiv-core-tools-into-prerequisite-plugins.md` — questions artifact that seeded this research
- `thoughts/shared/questions/2026-04-13_15-53-01_agent-resolution-in-plugin.md` — agent-resolution concerns under plugin boundaries
- `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md` — subprocess-vs-in-process extension inheritance; extensions inherited by children only if globally installed or declared in agent `extensions:` frontmatter
- `thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md` — notes missing `promptSnippet` caused "ask_user_question mistake" invisibility bug
- `thoughts/shared/plans/2026-04-11_14-43-28_advisor-strategy-pattern.md` — blueprint for self-contained tool plugin
- `thoughts/shared/designs/2026-04-12_12-21-43_advisor-settings-persistence.md` — config-file ownership pattern
- `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md` — state-replay discipline across subagent spawn boundaries
- `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md` — rollback note on tool-name double-registration between subagent libraries
- `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md` — original todo design
- `thoughts/shared/plans/2026-04-11_07-38-04_todo-list-overlay-above-input.md` — overlay widget plan

## Developer Context

**Q (`extensions/rpiv-core/permissions.ts:40-42`, `templates/pi-permissions.jsonc:25-26`, `index.ts:42-110`): Which of three architecture shapes — full decomposition (3 independent plugins) / thin orchestrator (rpiv-pi imports register fns) / core-runtime + leaf plugins — should the research doc recommend?**
A: Full decomposition (3 independent plugins). Each plugin owns its own session_start/hook set; research doc must describe the fragment-merge seeder that replaces `permissions.ts:39-55` and accept the cross-plugin load-order surface that multiplies advisor's `be0a014` pattern.

**Q (`extensions/rpiv-core/advisor.ts:55`, `advisor.ts:57-64`, `advisor.ts:139`): What should rpiv-advisor do with `~/.config/rpiv-pi/advisor.json`?**
A: Hard cutover to `~/.config/rpiv-advisor/`. Users lose saved advisor-model config on upgrade — silent because `advisor.ts:139` early-returns when `modelKey` is falsy. Add migration messaging via the `session_start` warning path at `index.ts:104-109` or accept the silent reset.

**Q (`thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md:35-48`, `agents/*.md`): How should the research doc handle subagent inheritance of extracted plugins?**
A: Non-issue for current agent definitions — grepping `agents/*.md` confirms zero references to `ask_user_question` / `todo` / `advisor`. Agents delegate via skills. rpiv-pi is hard-dependent on the three extracted plugins (can't run without them). Express the dependency via best-practice patterns surfaced by web research: `peerDependencies` in `package.json` + runtime check at `session_start` + `/rpiv-setup` hard-fail with actionable install commands (VS Code `extensionDependencies` semantics via Obsidian-style runtime enforcement, since no native Pi mechanism exists per pi-mono docs + issues #326/#645/#1831). Consider filing a FR against `badlogic/pi-mono` for a `pi.dependencies` manifest field.

**Q (`extensions/web-tools/index.ts:39`, `extensions/rpiv-core/templates/pi-permissions.jsonc:30-31`, `agents/web-search-researcher.md:1-4`): For extracted Brave web-tools, should config stay at `~/.config/rpiv-pi/web-tools.json` and should `pi-permission-system` remain a prerequisite?**
A: No — plan to remove the `pi-permission-system` dependency entirely. Treat the extracted Brave plugin as owning its own config namespace (not `~/.config/rpiv-pi/web-tools.json`). That removes the need for permission-fragment design work for `web_search` / `web_fetch`; research should frame extraction around package install/runtime checks, agent ownership, and config migration only.

## Follow-up Research 2026-04-13T17:00:00-04:00

### Extracting Brave web-tools into an independent prerequisite plugin
- `extensions/web-tools/index.ts:165-495` is already a self-contained extension boundary: it registers `web_search`, `web_fetch`, and `/web-search-config` without importing anything from `extensions/rpiv-core/`. Code extraction is therefore straightforward compared with `todo` or `advisor`.
- The current coupling is package-level, not code-level. `package.json:7-10` exposes both `extensions/rpiv-core/` and `extensions/web-tools/` through one `
- Questions source: `thoughts/shared/questions/2026-04-13_15-33-01_extract-rpiv-core-tools-into-prerequisite-plugins.md`
- `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md`
- `thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md`
- `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md`

## Open Questions
1. **Fragment-merge seeder algorithm.** Should each extracted plugin write its fragment to a per-plugin file (`~/.pi/agent/pi-permissions.<plugin>.jsonc`) that Pi merges at read-time, or should all plugins write to the single canonical `~/.pi/agent/pi-permissions.jsonc` via a shared merge helper? The former requires Pi loader changes; the latter requires the helper to be owned by *some* package (orchestrator or shared runtime) — resolve during design.
2. **Advisor config-path migration messaging.** The chosen hard cutover is silent today; should `rpiv-advisor`'s first-run code read the old path once and emit a one-time notification telling the user their advisor model was not preserved? Cheapest UX patch; decide during design.
3. **Package-name convention.** The research assumes `rpiv-ask-user-question`, `rpiv-todo`, `rpiv-advisor` names. Namespace under `@mariozechner/`, `@rpiv/`, or a new scope? Affects the install URLs in `/rpiv-setup` and README.
4. **pi-mono feature request.** File an issue on `badlogic/pi-mono` proposing `pi.dependencies` / `pi.requires` analogous to VS Code's `extensionDependencies`, citing issues #326 and #645. Defer or do in parallel with extraction?
