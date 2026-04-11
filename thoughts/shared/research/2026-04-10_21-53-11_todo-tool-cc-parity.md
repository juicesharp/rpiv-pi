---
date: 2026-04-10T21:53:11-0400
researcher: Claude Code
git_commit: a01a4a3
branch: master
repository: rpiv-pi
topic: "Upgrade rpiv-pi `todo` tool to match Claude Code's TaskCreate/TaskUpdate/TaskList/TaskGet family as closely as possible"
tags: [research, codebase, todo-tool, task-tool, rpiv-core, pi-extensions, claude-code-parity, session-state, permissions]
status: complete
questions_source: "thoughts/shared/questions/2026-04-10_20-59-46_todo-tool-cc-parity.md"
last_updated: 2026-04-10
last_updated_by: Claude Code
---

# Research: Upgrade rpiv-pi `todo` tool to Claude-Code TaskCreate/Update/List/Get parity

## Research Question
Upgrade rpiv-pi's `todo` tool to match Claude Code's `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` family as closely as possible, while surviving Pi's session/compaction model and rpiv-pi's existing user base.

## Summary

The current `todo` implementation lives in `extensions/rpiv-core/todo.ts` (split out of the monolithic `index.ts` in the uncommitted working tree) and is a 3-field record (`{id, text, done}`) with a 4-action switch (`list`/`add`/`toggle`/`clear`). Matching Claude Code's richer Task family touches six independent dimensions — schema, API shape, status state machine, persistence, rendering, and permissions — each of which was investigated by a dedicated agent. Five of the six have clean, low-risk answers; the sixth (permissions) is a **hard blocker** disguised as a naming decision.

Developer checkpoint locked the following decisions:

1. **Keep the tool name `todo`** (don't rename to `TaskCreate`/etc.). `pi-permission-system@0.4.1` does exact-name lookup with NO wildcards (`permission-manager.ts:724`), and `templates/pi-permissions.jsonc:26` already seeds `"todo": "allow"` in every existing user's file. Any rename would silently push every LLM call to `defaultPolicy.tools: "ask"` (template line 12), hanging interactive sessions and hard-blocking non-interactive runs. Keeping the name means **zero permissions migration surface** and zero skill-prose edits to the already-deleted 13 `TaskCreate`/`TaskUpdate` mentions across rpiv-pi and rpiv-skillbased.

2. **Expand the schema to a full CC-parity Task record**: `Task { id, subject, description?, activeForm?, status, blockedBy?, owner?, metadata? }`. The Option 2 sketch at `rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md:642-658` is the reference shape.

3. **Rename the `action` enum to CC verbs**: `["create", "update", "list", "get", "delete", "clear"]`. `toggle` is removed — `update` carries the full 4-state transition (`pending → in_progress → completed → deleted`). `delete` is a per-id tombstone (sets `status: "deleted"`); `clear` remains as the bulk-reset for convenience.

4. **No legacy-session shim**. rpiv-pi is pre-production; any pre-upgrade session entries shaped as `{id, text, done}` simply won't replay. The reconstruction loop at `todo.ts:33-46` is rewritten assuming the new envelope; old sessions become fresh.

5. **No overlay component for `/todos`**. The current `ctx.ui.notify` toast at `todo.ts:140-159` is enhanced with status grouping; the real UI investment goes into a per-action `renderResult` inside `registerTodoTool` that mirrors `web-tools/index.ts:253-272`. `pi-tui` overlays hard-truncate at `maxHeight` (`tui.js:565-567`) and require self-implemented scrolling — not worth the ~150 LOC for the single resume-handoff use case.

6. **No `appendEntry` persistence insurance**. Pi's compaction path at `session-manager.js:613-627` is strictly additive — it calls `_persist(entry)` (appendFileSync) and never rewrites the session file, so pre-compaction `toolResult` entries survive and `getBranch()` keeps returning them. The feared "in_progress tasks vanish on compact" hazard does not exist in Pi as shipped. Trust the existing replay loop; revisit if a future Pi release changes compaction behavior.

**Recommended implementation shape**: a single `todo` tool whose `execute` delegates into a pure `applyTaskMutation(state, verb, params) → {state, details, content}` reducer that is ALSO called from `reconstructTodoState`. This unifies the run-forward and replay code paths so invariants (state transitions, blockedBy cycle checks) are enforced identically in both directions.

## Detailed Findings

### Current Implementation (post-split, working tree)

The `todo` tool was extracted from the pre-split `extensions/rpiv-core/index.ts:412-546` into a dedicated module at `extensions/rpiv-core/todo.ts` as part of the uncommitted "complete pi migration" sweep. `index.ts` now holds only the session-lifecycle glue and registers the tool via `registerTodoTool(pi)` / `registerTodosCommand(pi)` at `index.ts:28-30`.

- `Todo` interface at `extensions/rpiv-core/todo.ts:16-20` — three fields (`id: number`, `text: string`, `done: boolean`).
- Module-level closure state at `todo.ts:22-23` — `let todos: Todo[] = []; let nextId = 1;`.
- Exported `getTodos()` at `todo.ts:25-27` — the `/todos` command reads via this accessor.
- `reconstructTodoState(ctx)` at `todo.ts:33-46` — the ONLY persistence path. Walks `ctx.sessionManager.getBranch()`, filters `entry.type === "message" && msg.role === "toolResult" && msg.toolName === "todo"`, overwrites `todos`/`nextId` from each match (last write wins).
- `registerTodoTool(pi)` at `todo.ts:52-133` — TypeBox schema at `todo.ts:64-68` (`action`, `text?`, `id?`), 4-case switch at `todo.ts:71-130`, `promptGuidelines` at `todo.ts:59-63`.
- `registerTodosCommand(pi)` at `todo.ts:139-160` — `ctx.ui.notify` toast for the current `/todos` slash command.
- Wiring at `extensions/rpiv-core/index.ts:24` (import), `index.ts:28-30` (registration), `index.ts:35` (replay on `session_start`), `index.ts:99` (replay on `session_tree`).

### Q1 — Data Model & Schema Shape

Each field added to the Task record must be serialised through `AgentToolResult.details` at `@mariozechner/pi-agent-core/dist/types.d.ts:248-253` (typed `T` with no shape constraint), because the reconstruction loop at `todo.ts:33-46` is the only persistence channel. Whatever the reducer writes into `details.tasks` is what survives.

Target shape (keep reading `details.todos` at `todo.ts:41` but internally treat the array as `Task[]` — no rename needed, since the word "todos" is just an envelope key):

```
Task {
  id: number;                                    // monotonic, keeps todo.ts:92 semantics
  subject: string;                               // replaces `text`, matches CC
  description?: string;                          // long-form body
  activeForm?: string;                           // spinner string while in_progress
  status: "pending" | "in_progress" | "completed" | "deleted";  // replaces boolean `done`
  blockedBy?: number[];                          // dependency edges
  owner?: string;                                // agent assignment
  metadata?: Record<string, unknown>;            // forward-compat escape hatch
}
```

**First-class vs metadata decisions**:
- `subject`, `description`, `activeForm`, `status`, `blockedBy`, `owner` are first-class — each has defined CC semantics and may drive `renderResult` branches.
- `blocks` (inverse of `blockedBy`) is DERIVED — computed on read in the `list`/`get` actions, NOT accepted as a parameter. Halves the write-validation surface.
- `metadata` is a catch-all bag for forward-compat telemetry. Not used by rpiv-pi code itself.
- `createdAt` / `updatedAt` are OPTIONAL — nice-to-have for deterministic ordering but not strictly needed because the reducer processes entries in `getBranch()` order.

**Numeric vs string IDs**: Keep numeric. CC uses string IDs, but `todo.ts:92` (`nextId++`) and the `nextId: details.nextId ?? todos.length + 1` fallback at `todo.ts:43` both depend on numeric semantics. Changing to strings would touch every write site.

### Q2 — API Shape (single tool vs four tools)

**Decision: keep single `todo` tool** with an expanded `action` enum. Because Q1 (tool name) locked to `todo`, the four-tool CC-parity path is off the table — splitting into `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet` would require four new permissions entries and hit the rename hazard described in Q6.

Within the single tool, the cleanest factoring is:

- One `pi.registerTool({ name: "todo", ... })` call at `todo.ts:52-133`.
- TypeBox schema uses a discriminated union-ish shape: `action` enum + per-action optional parameters. TypeBox doesn't support true discriminated unions gracefully, so use a flat `Type.Object` with all optional-except-`action` fields and validate per-action inside the reducer.
- One pure reducer `applyTaskMutation(state, action, params) → { state, details, content, error? }` that:
  1. The `execute` callback at `todo.ts:70-131` calls per tool invocation.
  2. The `reconstructTodoState` loop at `todo.ts:33-46` calls per replayed entry (needs `details.action` + `details.params` recorded in the envelope — see Architecture Insights below).
- `renderResult` dispatches on `result.details.action`, matching the upstream example at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts:228-280` which already does `switch (details.action)` across its four verbs.

`promptGuidelines` at `todo.ts:59-63` is rewritten to teach the 4-state vocabulary and each action verb.

### Q3 — Status Transition Semantics

**4-state machine**: `pending → in_progress → completed`, with `deleted` as a universal tombstone target.

Legal transitions (enforced in the reducer):
- `pending → in_progress` (starting work)
- `pending → completed` (skip — finishing without starting)
- `in_progress → completed` (finishing)
- `in_progress → pending` (pause)
- `* → deleted` (tombstone)

Illegal (reducer returns `details.error` using the existing error-return pattern at `todo.ts:88-90, 104-105, 110-112`):
- `completed → *` (terminal)
- `deleted → *` (terminal)

**`create` never accepts `status`** — tasks are always born `pending`. Matches CC's TaskCreate.

**`activeForm` is a persisted, first-class field**. Rationale:
1. The `details.tasks` snapshot at the session-entry level is the only persistence channel — a transient field would be lost across `session_tree` events that trigger replay at `index.ts:99`.
2. `renderResult` is a per-result renderer — it can only read what lives in `details`.
3. Default it to `subject` if unset, matching CC's fallback.
4. Accepted on `create` and `update`, rendered inline next to the task row when `status === "in_progress"`.

**`blockedBy` enforcement**: reject at runtime.
- Unknown id in `blockedBy` → error (the LLM can recover by creating the referenced task first).
- Cycle in `blockedBy` graph → error. Linear DFS from the new/updated task, ~15 LOC. CC enforces this.
- `blocks` field is NOT a parameter — it's computed on read in `list`/`get`.

**Reducer is the single source of truth for invariants**. Both `execute` and `reconstructTodoState` call into the same reducer; any invariant added in one place is automatically enforced in the other.

**Skill-prose impact of `in_progress`**: The only live skill that reads the string `"in_progress"` is `skills/resume-handoff/SKILL.md:177` (rpiv-pi) / `:191` (rpiv-skillbased), both of which are Scenario 3 "Incomplete Handoff Work" blocks that parse literal status labels out of handoff markdown files written by `create-handoff`. These are FREE-TEXT labels in the handoff doc, NOT tool-call parameters. The upgraded tool's `status: "in_progress"` vocabulary lines up with the handoff prose; no skill edit needed to make this work. This also resolves the pre-existing contradiction where `resume-handoff` assumed `"in_progress"` was expressible but the current `toggle`-only tool could not represent it.

### Q4 — State Persistence & Compaction

**Finding: the compaction hazard does not exist in Pi as shipped.**

Trace:
- `SessionManager.appendCompaction` at `@mariozechner/pi-coding-agent/dist/core/session-manager.js:613-627` builds a single `{type:"compaction", …}` entry and pipes it through `_appendEntry` at `session-manager.js:564-568`, which does `fileEntries.push(entry)` + `byId.set(...)` + `_persist(entry)`.
- `_persist` at `session-manager.js:545-562` is `appendFileSync` — pure append, never truncates.
- The only `_rewriteFile` path at `session-manager.js:524-528` is invoked from `setSessionFile` (line 469 version migration), the empty-file recovery path (line 462), and `createBranchedSession` (line 933). **Never from compaction.**
- After compaction, `getBranch()` at `session-manager.js:751-759` still walks the parent chain via `byId` (no filtering, no compaction awareness) and returns every single pre-compaction entry — including the pre-compaction `todo` `toolResult`s. `reconstructTodoState` at `todo.ts:33-46` reads them as before.

What compaction DOES change is the LLM's view: `buildSessionContext` at `session-manager.js:108-203` special-cases compaction entries and only emits the post-compaction summary + entries after `firstKeptEntryId`. So the LLM loses its chat-history reminder of the tasks, but the extension's in-memory state is intact.

**Decision: no `appendEntry` insurance.** Reasons:
1. The hazard is purely theoretical given Pi's current compaction implementation.
2. Adding it introduces a second persistence channel that needs to stay in sync with the toolResult-replay path. More surface area, more drift risk.
3. If a future Pi release ever physically prunes toolResult entries on compact, this decision can be revisited without breaking anything — the reducer is already pure and can be re-used from a `session_before_compact` handler.

**`session_start` handler ordering**: the scaffolding handler at `index.ts:33-85` runs before the todo replay at `index.ts:35` (replay is inlined into the same handler now, so there's no ordering concern). `pi.appendEntry("active_agent", ...)` at `index.ts:45` appends a `CustomEntry` whose `customType: "active_agent"` is filtered out by the replay loop's `entry.type === "message"` check at `todo.ts:37` — no interference.

**Resume after compact**: `session_start` fires with `reason: "resume"` (`@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:325-331`). The replay loop sees the normal branch including the compaction entry and the pre-compaction `toolResult` entries, and the `entry.type === "message"` filter at `todo.ts:37` skips the compaction entry. No special handling needed.

### Q5 — Rendering (`/todos` + `renderCall`/`renderResult`)

**Decision: no overlay component. Keep `/todos` as `ctx.ui.notify` with status grouping; invest the UI effort into a rich `renderResult`.**

**Why not an overlay**: `pi-tui` overlays hard-truncate at `maxHeight` (`@mariozechner/pi-tui/dist/tui.js:565-567`: `if (maxHeight !== undefined && overlayLines.length > maxHeight) overlayLines = overlayLines.slice(0, maxHeight);`). Any task list longer than ~15 lines silently disappears off the bottom unless the component implements its own `scrollOffset` + `handleInput(up/down/pageUp/pageDown)` via `matchesKey` from `@mariozechner/pi-tui/dist/keys.d.ts:152`, following the ~130-LOC `StreamingOverflowComponent` precedent at `examples/extensions/overlay-qa-tests.ts:448-578`. For resume-handoff's single use case, the persistent inline `renderResult` in chat history already covers 90% of the value.

**Current `/todos` at `todo.ts:139-160`** just dumps a flat notify toast. Enhance it to group by status:
```
3/7 completed · 1 in_progress
── Pending ──
  ○ #4 subject…    ⛓ #2
── In Progress ──
  ◐ #2 (writing tests)
── Completed ──
  ✓ #1 subject
```
Still a single `ctx.ui.notify(...)` call; the string is just richer.

**`renderCall` / `renderResult` shape**: matches the `web-tools` precedent at `extensions/web-tools/index.ts:247-272` (web_search) and `407-441` (web_fetch), the ONLY existing render-callback precedents in rpiv-pi. Both follow the pattern `return new Text(styled, 0, 0)` with branches on `isPartial`/`isError`/`expanded`.

**Per-action `renderResult` (single tool dispatching on `details.action`)**:
- `create`: collapsed → `✓ Created #N subject (pending)`. Expanded → also show `activeForm` and any `blockedBy` as `⛓ blocked by #1, #2`.
- `update`: collapsed → status-glyph + status arrow (e.g. `◐ #3 pending → in_progress`). Glyph colors: `theme.fg("warning", "◐")` for in_progress, `theme.fg("success", "✓")` for completed, `theme.fg("dim", "○")` for pending, `theme.fg("error", "✗")` for deleted. Expanded → also show previous status and any unblocked downstream ids.
- `list`: collapsed → `3 pending · 1 in_progress · 5 completed`. Expanded → grouped by status, first 15 items, then `... N more` — directly modeled on `web-tools/index.ts:264-269` (`slice(0, 5)` + "...and N more").
- `get`: collapsed → single line with status glyph + subject. Expanded → full record (description, activeForm, blockedBy, owner).
- `delete`: `✗ Deleted #N subject`.
- `clear`: `✓ Cleared N tasks`.

**`renderCall`** is a one-liner showing action + key arg: `theme.bold("todo ") + theme.fg("muted", args.action) + ...`. Identical shape to the upstream example at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts:221-226`.

### Q6 — Permissions & Migration Hazard

**Finding: this was the #1 risk for the upgrade. The keep-`todo`-name decision eliminates it entirely.**

`pi-permission-system@0.4.1` handles the `tools` category differently from all its sibling categories:
- `special`, `skills`, `mcp`, and `bash` are compiled through `compilePermissionPatternsFromSources` at `permission-manager.ts:556-561` — those support wildcards like `"Task*"` via regex compilation in `wildcard-matcher.ts:17-28`.
- **`tools` is NEVER compiled.** The lookup at `permission-manager.ts:724` is a plain JavaScript object-property access: `merged.tools?.[normalizedToolName]`. Literal `"Task*"` as a key becomes a property name that never matches any actual tool name.

Consequence: if the upgrade had renamed to `TaskCreate`/etc., every existing user with the seeded `"todo": "allow"` at `templates/pi-permissions.jsonc:26` would fall through to `defaultPolicy.tools: "ask"` (template line 12). That path at `pi-permission-system/src/index.ts:1331-1382` blocks non-interactive runs with `Using tool 'X' requires approval, but no interactive UI is available.` (line 1351) and prompts a modal for every single call in interactive mode. Unusable.

**Keep-the-name resolves this.** `templates/pi-permissions.jsonc:26` stays as `"todo": "allow"` — the upgraded tool is still registered as `name: "todo"` at `todo.ts:54`, and every existing user's seeded file matches on first call. No JSONC upsert needed, no `/rpiv-migrate-permissions` command needed, no `jsonc-parser` dependency needed. Zero migration surface.

**Also noted**: no programmatic allowlist API exists on `ExtensionAPI`. Grepping `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:701-779` for `registerPermission`/`bypassPermission`/`alwaysAllow`/`trust` returns zero matches. The on-disk JSONC file is the ONLY channel to grant trust. Good to know for any future "trusted-by-default" tools rpiv-pi might ship.

### Q7 — Cross-Skill Caller Impact

**Finding: zero skill edits required.**

The 2026-04-10 "delete don't replace" decision recorded in `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md:138,208` and `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md:169-171` removed all 13 `TaskCreate`/`TaskUpdate` prose mentions from rpiv-pi skills on the philosophy that `todo.promptGuidelines` is the single teaching surface.

Inventory of the 20 remaining call-site mentions (8 rpiv-pi, 12 rpiv-skillbased) confirms:
1. **All mentions are name-only one-liners** like "Create a research task list using the `todo` tool to track exploration tasks" (`skills/create-plan/SKILL.md:109`). None of them pass `activeForm`, `blockedBy`, `owner`, `description`, or any status string as tool parameters.
2. **No skill uses richer semantics**. Grepping both trees for `activeForm`, `subject`, `blockedBy`, `dependencies` (as tool fields), or `status: in_progress` returns zero hits inside any `TaskCreate`/`todo` prose.
3. **The `in_progress` string in `resume-handoff` is not a tool field**. `skills/resume-handoff/SKILL.md:177` (rpiv-pi) and `:191` (rpiv-skillbased) parse literal `"in_progress"` strings out of handoff markdown files written by `create-handoff` — free-text English, not tool parameters. The upgraded tool happens to use the same string for `status`, which is a nice alignment but not a load-bearing coupling.

Because the tool name stays `todo` and no skill references a specific action verb that vanishes (the closest is "Update todos as you complete research" at `skills/create-plan/SKILL.md:349` which maps to the new `update` verb by phrase), the only edits needed are in the extension itself:

- Rewrite `promptGuidelines` at `todo.ts:59-63` to teach the 4-state status vocabulary and each action verb.
- Update `description` at `todo.ts:56-57` to list the new action enum.

**Zero skill-prose edits. Zero rpiv-skillbased edits. The rpiv-pi + rpiv-skillbased repos continue to diverge on the `todo` vs `TaskCreate` string literal, which is already intentional per the existing migration table.**

## Code References

- `extensions/rpiv-core/todo.ts:16-20` — current `Todo` interface (3 fields)
- `extensions/rpiv-core/todo.ts:22-23` — module-level closure state
- `extensions/rpiv-core/todo.ts:25-27` — `getTodos()` accessor used by `/todos`
- `extensions/rpiv-core/todo.ts:33-46` — `reconstructTodoState` replay loop
- `extensions/rpiv-core/todo.ts:52-133` — `registerTodoTool` (tool definition + execute)
- `extensions/rpiv-core/todo.ts:56-57` — tool description (needs rewrite for new actions)
- `extensions/rpiv-core/todo.ts:59-63` — `promptGuidelines` (needs rewrite)
- `extensions/rpiv-core/todo.ts:64-68` — TypeBox parameter schema (needs expansion)
- `extensions/rpiv-core/todo.ts:70-131` — execute switch (rewrite to dispatch via reducer)
- `extensions/rpiv-core/todo.ts:100-119` — `toggle` case (delete; replaced by `update`)
- `extensions/rpiv-core/todo.ts:139-160` — `registerTodosCommand` (/todos notify toast, enhance with status grouping)
- `extensions/rpiv-core/index.ts:24` — todo module import
- `extensions/rpiv-core/index.ts:28-30` — tool & command registration entry points
- `extensions/rpiv-core/index.ts:35` — replay on `session_start`
- `extensions/rpiv-core/index.ts:45` — existing `appendEntry("active_agent", ...)` precedent
- `extensions/rpiv-core/index.ts:88-90` — `session_compact` handler (only clears guidance markers; do NOT add todo logic here)
- `extensions/rpiv-core/index.ts:98-100` — replay on `session_tree`
- `extensions/rpiv-core/permissions.ts:39-55` — `seedPermissionsFile` (write-if-absent; unchanged by this upgrade)
- `extensions/rpiv-core/templates/pi-permissions.jsonc:20-34` — `tools` allowlist (unchanged)
- `extensions/rpiv-core/templates/pi-permissions.jsonc:26` — `"todo": "allow"` (preserved by the keep-name decision)
- `extensions/web-tools/index.ts:247-272` — `web_search` `renderCall`/`renderResult` precedent
- `extensions/web-tools/index.ts:407-441` — `web_fetch` `renderCall`/`renderResult` precedent

## Integration Points

### Inbound References
- `extensions/rpiv-core/index.ts:24` — imports `registerTodoTool`, `registerTodosCommand`, `reconstructTodoState` from `./todo.js`
- `extensions/rpiv-core/index.ts:29-30` — calls `registerTodoTool(pi)` and `registerTodosCommand(pi)`
- `extensions/rpiv-core/index.ts:35` — calls `reconstructTodoState(ctx)` inside the `session_start` handler
- `extensions/rpiv-core/index.ts:99` — calls `reconstructTodoState(ctx)` inside the `session_tree` handler
- `skills/create-plan/SKILL.md:109,349-351` (rpiv-pi) — name-only prose references to the `todo` tool
- `skills/write-plan/SKILL.md:231-232` (rpiv-pi)
- `skills/iterate-plan/SKILL.md:178-179` (rpiv-pi)
- `skills/implement-plan/SKILL.md:24,57` (rpiv-pi)
- `skills/validate-plan/SKILL.md:143` (rpiv-pi)
- `skills/resume-handoff/SKILL.md:108-117,150,177,206` (rpiv-pi) — line 177 reads `"in_progress"` from handoff markdown, not the tool
- `skills/design-feature/SKILL.md:375` (rpiv-pi)
- `skills/code-review/SKILL.md:44` (rpiv-pi)

### Outbound Dependencies
- `ctx.sessionManager.getBranch()` — `@mariozechner/pi-coding-agent/dist/core/session-manager.d.ts:244` via `ReadonlySessionManager` at `.d.ts:136`
- `SessionEntry` / `message` / `toolResult` filtering — `session-manager.d.ts:65-69`
- `AgentToolResult<T>.details` envelope — `@mariozechner/pi-agent-core/dist/types.d.ts:248-253`
- `ToolDefinition<TParams, TDetails, TState>` interface — `@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:281-302`
- `ExtensionContext.ui.notify` — `types.d.ts:63`
- `ExtensionContext.hasUI` — `types.d.ts:184`
- `Theme.fg(role, text)` — `@mariozechner/pi-coding-agent/dist/modes/interactive/theme/theme.d.ts`
- `Text` component — `@mariozechner/pi-tui/dist/tui.d.ts` (single-line styled text)
- `StringEnum` — `@mariozechner/pi-ai`
- `Type.Object`, `Type.Optional`, `Type.String`, `Type.Number`, `Type.Array` — `@sinclair/typebox`

### Infrastructure Wiring
- `extensions/rpiv-core/index.ts:28-30` — tool + command registration
- `extensions/rpiv-core/index.ts:33-85` — `session_start` handler (reconstruct + scaffold)
- `extensions/rpiv-core/index.ts:98-100` — `session_tree` handler (reconstruct on branch nav)
- `extensions/rpiv-core/templates/pi-permissions.jsonc:26` — `"todo": "allow"` seeded on first install
- No route/middleware/job wiring — Pi extensions are in-process event handlers

## Architecture Insights

### The pure reducer is the load-bearing abstraction

The single most important design decision is to factor the mutation logic into a pure `applyTaskMutation(state, action, params) → { state, details, content, error? }` function that:

1. **The `execute` callback** at `todo.ts:70` calls once per tool invocation, wrapping the reducer's return in an `AgentToolResult`.
2. **`reconstructTodoState`** at `todo.ts:33-46` calls per replayed entry. Replay is deterministic re-execution, not "load the last snapshot."

For the replay path to work, the `details` envelope must carry enough to replay the mutation. Two options:
- **Snapshot-based replay** (current approach): `details.tasks` is the full post-mutation task list. Replay just copies into state. Simple, forgiving, but invariants are never re-checked on replay.
- **Event-sourced replay**: `details = { verb, params, tasks, nextId, error? }`. Replay re-runs the reducer from `(state, verb, params)`, which re-validates every invariant. Catches any future divergence between writer and replayer.

**Recommended**: snapshot-based replay is sufficient for rpiv-pi because the reducer is the only writer (no external mutation path). Keep `details.tasks` as the authoritative shape but also record `details.action` and `details.params` for debugging and future event-sourcing.

### The `details` envelope is a single persistence bottleneck

Every new field must be serialised through `AgentToolResult<T>.details` at `@mariozechner/pi-agent-core/dist/types.d.ts:248-253`. Since replay replaces the whole `tasks` array on every read, there is no "partial write" concept — the full task list is snapshotted on every mutation. This is CORRECT for branching: a session tree branch sees the last-written snapshot on the parent chain, which is exactly right.

### The four `status` values are vocabulary, not structure

`pending` / `in_progress` / `completed` / `deleted` are strings in a TypeBox `StringEnum`, not subclasses. The reducer's `switch (action)` is the only dispatch axis — status is just a field. This is simpler than a state-machine library and matches CC's actual implementation.

### `clear` vs `delete`

`delete` tombstones a single task (sets `status: "deleted"`, keeps the record so references in `blockedBy` don't dangle). `clear` removes all tasks and resets `nextId` to 1 — it's a bulk reset for "I'm starting a new session, scrap everything." Both verbs are useful; they're not redundant.

### `promptSnippet` visibility gate

Per the precedent sweep and `system-prompt.js:42-46`, tools without a `promptSnippet` are OMITTED from the "Available tools:" section of the default system prompt, even though they're still callable. The current `todo.ts:58` sets `promptSnippet: "Manage a task list to track multi-step progress"` — keep this on the upgraded tool or the LLM won't see it in the Available Tools list.

### Why a single tool (not four)

The single-tool dispatch via `action` enum matches:
- The upstream Pi example at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts:136-281`.
- The current rpiv-pi implementation at `todo.ts:52-133`.
- The keep-name decision (a single `"todo"` permissions entry covers everything).

Four tools sharing closure state is technically allowed by `ToolDefinition` at `types.d.ts:281-302` but has zero precedent in either repo and would require four `"TaskCreate"/"TaskUpdate"/"TaskList"/"TaskGet"` allowlist entries that don't exist in any user's seeded file.

## Precedents & Lessons

**7 relevant prior artifacts analyzed.** Git history is effectively empty — rpiv-pi has exactly one commit (`a01a4a3` — "Initial rpiv-pi package: Pi extension with 9 agents and 21 skills ported from rpiv-skillbased", 2026-04-10), and a large uncommitted working-tree rewrite is in progress (19 modified `SKILL.md` files + the extension-split that created `todo.ts`/`permissions.ts`/`guidance.ts`/`ask-user-question.ts`/`agents.ts`/`package-checks.ts`). All institutional memory lives in `thoughts/` documents.

Key commits: `a01a4a3` (initial port — chose Option 1 "minimal todo" from the gap analysis Appendix B, explicitly deferring the rich Task record as Option 2 / P2).

Composite lessons:
- **"Delete, don't replace" is the live philosophy and it holds here.** The 2026-04-10 sweep deleted 13 `TaskCreate`/`TaskUpdate` prose hits on the premise that `todo.promptGuidelines` carries the teaching. This upgrade validates that choice — no skill-prose restoration is needed because the keep-`todo`-name decision keeps all existing references correct and the rewritten `promptGuidelines` at `todo.ts:59-63` is the only edit needed to teach the new vocabulary.
- **Freeze the uncommitted refactor before stacking this work on top.** `git status` (per the precedent sweep) shows 19 SKILL.md + 6 new extension files modified since `a01a4a3`. Commit or stash the extension-split (already landed in working tree: `index.ts` now imports from `todo.ts`/`permissions.ts`/etc.) before starting the Task upgrade, so the Task changes have a clean diff against a stable baseline.
- **The `promptSnippet` visibility gate is load-bearing** (from `system-prompt.js:42-46` via the precedent sweep). Any tool without `promptSnippet` is invisible in the Available Tools section. The current setting at `todo.ts:58` works; don't drop it when rewriting `promptGuidelines`.
- **First use of richer `renderResult` in rpiv-pi**. Only `web-tools/index.ts` currently has `renderCall`/`renderResult` (`:247-272`, `:407-441`). The upgraded `todo` tool becomes the second implementation and the first to dispatch via `details.action`. Use `web-tools` as the style reference (single `Text` return, `theme.fg(role, text)` coloring, `expanded` branch with `slice(0, N)` + "...more").
- **No prior multi-channel persistence use**. `pi.appendEntry("active_agent", {...})` at `index.ts:45` is the only `appendEntry` call site in the repo, and it's a single-value marker, not a state snapshot. The decision to NOT add `appendEntry` insurance keeps this unchanged.
- **The `in_progress` string at `resume-handoff/SKILL.md:177` is a pre-existing contradiction** the current `toggle`-only tool cannot satisfy. The upgrade is the regression fix: once `status: "in_progress"` is expressible, the handoff-to-resume round-trip becomes consistent with the skill prose. Treat this as the acceptance test.
- **rpiv-skillbased divergence is intentional** per the 2026-04-10 migration table. Keeping the rpiv-pi tool name `todo` while rpiv-skillbased continues to reference `TaskCreate` in its Claude-Code-targeting prose is the designed steady state, not a bug to fix.

## Historical Context (from thoughts/)

- `thoughts/shared/questions/2026-04-10_20-59-46_todo-tool-cc-parity.md` — The 7-question discovery artifact that seeded this research
- `thoughts/shared/questions/2026-04-10_08-45-32_complete-pi-migration.md` — Earlier Q7 pre-assessed the TaskCreate-to-todo rewrite tradeoff
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — Exhaustive grep (367 pattern hits) that established the "delete don't replace" decision at lines 138, 208
- `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md` — Design Decision 16 ("delete don't replace") at lines 169-171; architecture starts at line 173
- `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md` — 8-phase execution plan currently being applied in the working tree (the file split that produced `todo.ts`)
- `thoughts/MIGRATION.md` — Roadmap ledger; §17 explicitly defers "richer `task` tool" to Option 2 / P2 — this research cashes that in
- `/Users/sguslystyi/rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` — Appendix B contains the pre-drafted Option 2 TypeBox sketch at lines 642-658 that the upgrade can lift almost verbatim

## Developer Context

**Q (tool name / permissions hazard): `permission-manager.ts:724` does exact-name lookup with no wildcards, and `templates/pi-permissions.jsonc:26` seeds only `"todo": "allow"`. Rename/split/hybrid?**
A: Keep `todo` name + expand actions (Recommended). Zero permissions migration surface, zero existing-user breakage.

**Q (schema scope): all 20 skill mentions are name-only; no skill uses activeForm/blockedBy/owner. Go minimal or full CC parity?**
A: Full CC-parity Task record — `subject/description?/activeForm?/status/blockedBy?/owner?/metadata?`. Over-builds vs current usage but future-proofs for LLMs trained on CC's richer schema.

**Q (action verbs): `toggle` at `todo.ts:114` is ambiguous under 4-state. Replace, add-new, or rename?**
A: CC-verb rename to `create/update/list/get/delete` (plus keep `clear` as bulk reset). `toggle` is removed entirely; `update` carries the full state machine.

**Q (legacy replay): pre-upgrade session entries are shaped `{id, text, done}`. Shim or no shim?**
A: No shim. rpiv-pi is pre-production, no legacy sessions to preserve. Cleanest solution — reducer and replay loop both assume the new shape.

**Q (`/todos` UI): pi-tui overlays hard-truncate at maxHeight with no built-in scrolling. How much UI investment?**
A: Notify + rich `renderResult`. Keep `ctx.ui.notify` for `/todos` (enhanced with status grouping); invest the design effort in a per-action `renderResult` modeled on `extensions/web-tools/index.ts:247-272`. No overlay component.

**Q (persistence insurance): Pi compaction is additive; the `in_progress`-vanish hazard is theoretical. Add `appendEntry` snapshots anyway?**
A: No. Trust the replay loop at `todo.ts:33-46`. Zero new code. Revisit only if Pi's compaction behavior changes.

**Correction from developer**: the `todo` tool was already extracted from `index.ts` into `extensions/rpiv-core/todo.ts` as part of the uncommitted file-split refactor (per the complete-pi-migration plan at `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md`). All file:line references in this research are remapped to the new split. Semantics are identical to the pre-split version; only the module boundary changed.

## Related Research

- Questions source: `thoughts/shared/questions/2026-04-10_20-59-46_todo-tool-cc-parity.md`
- `/Users/sguslystyi/rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` — Appendix B Option 2 sketch (the starting point for this upgrade's schema)
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — the prior "delete don't replace" analysis that this upgrade validates
- `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md` — Decision 16

## Open Questions

1. **Does `list` accept a status filter parameter?** e.g., `todo({action: "list", status: "in_progress"})`. CC's `TaskList` does support filtering. Not critical — the reducer can return all tasks and the LLM can filter client-side — but it's a small UX win. **Deferred to the planner.**

2. **Tombstone retention policy for `deleted` tasks.** Should `list` return deleted tasks by default, filter them out, or accept an `includeDeleted?: boolean` flag? Matters for `blockedBy` reference integrity: if task `#2` is deleted, what does `TaskCreate({blockedBy: [2]})` do — error, warn, or silently allow a dangling reference? **Deferred to the planner.**

3. **`addBlockedBy` / `addBlocks` vs replace-array semantics on `update`.** CC uses additive-merge fields. The rpiv-pi reducer can either match (add-only, never remove) or allow full replacement via a `blockedBy` field. **Deferred to the planner.**

4. **`activeForm` spinner animation**. The field is persisted and rendered inline in `renderResult`. Should `/todos` actually animate it (e.g., `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` rotating) while the task is `in_progress`, or is a static `(writing tests)` label enough? Animation requires a `setInterval` + `ctx.ui.invalidate` loop inside the overlay, which adds complexity. **Recommendation: static label in v1, animation deferred.**

5. **Does `session_compact` need todo state clearing?** The handler at `index.ts:88-90` currently only clears guidance markers. Since the tasks survive compaction (Q4), no clearing is needed — but should we add a `reconstructTodoState(ctx)` call here defensively to catch any future drift? **Recommendation: no — the replay loop already runs on `session_start`/`session_tree`, and `session_compact` doesn't change the branch view.**
