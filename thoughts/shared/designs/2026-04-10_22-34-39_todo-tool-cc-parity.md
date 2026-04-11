---
date: 2026-04-10T22-34-39-0400
designer: Claude Code
git_commit: d484cb3
branch: master
repository: rpiv-pi
topic: "Upgrade rpiv-core `todo` tool to Claude Code TaskCreate/TaskUpdate/TaskList/TaskGet parity"
tags: [design, todo-tool, rpiv-core, pi-extensions, claude-code-parity, state-machine, reducer-pattern]
status: complete
research_source: "thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md"
last_updated: 2026-04-10
last_updated_by: Claude Code
last_updated_note: "Finalized after 5-slice iterative generation; removed unused Static import during integration verification. 2026-04-10 patch: reducer now rejects blockedBy refs to deleted tasks on both create and update.addBlockedBy, aligning code with Decision 10."
---

# Design: `todo` Tool CC-Parity Upgrade

## Summary

Rewrite `extensions/rpiv-core/todo.ts` from the legacy 3-field `{id, text, done}` + 4-action switch (`list/add/toggle/clear`) to a full Claude-Code-parity `Task` record + 6-verb action set (`create/update/list/get/delete/clear`) backed by a pure `applyTaskMutation` reducer. Tool name stays `todo` (zero permissions migration surface); rendering gains per-action dispatch modeled on `extensions/web-tools/index.ts:247-272`; replay stays snapshot-based per research recommendation.

## Requirements

From `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md`:

- Match Claude Code's `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet` vocabulary and schema as closely as possible within Pi's constraints
- Survive Pi's compaction/session-tree model (replay must be deterministic)
- Zero permissions migration surface (keep tool name `todo`)
- Zero skill-prose edits required (verified by integration scanner)
- Full 4-state status machine: `pending → in_progress → completed` plus `deleted` tombstone
- `blockedBy` dependency tracking with cycle detection
- `activeForm` spinner string (persisted, not transient)
- Per-action `renderResult` in the chat; enhanced `/todos` notify for the slash command
- No legacy-session shim (rpiv-pi is pre-production)

## Current State Analysis

### Key Discoveries

- `extensions/rpiv-core/todo.ts:16-20` — `Todo` interface with only `id: number`, `text: string`, `done: boolean`
- `extensions/rpiv-core/todo.ts:22-23` — module-level state `let todos: Todo[] = []; let nextId = 1;`
- `extensions/rpiv-core/todo.ts:33-46` — `reconstructTodoState(ctx)` — snapshot-based replay walking `ctx.sessionManager.getBranch()` and overwriting from the last `toolResult` entry whose `toolName === "todo"`
- `extensions/rpiv-core/todo.ts:52-133` — `registerTodoTool` with 4-action switch (`list/add/toggle/clear`), TypeBox schema at `:64-68`, `promptGuidelines` at `:59-63`
- `extensions/rpiv-core/todo.ts:139-160` — `registerTodosCommand` (plain notify toast grouped only by done count)
- `extensions/rpiv-core/index.ts:24,29-30,35,99` — only consumer of the todo module (import, register, replay on `session_start`, replay on `session_tree`)
- `extensions/rpiv-core/templates/pi-permissions.jsonc:26` — `"todo": "allow"` seeded on first install; the literal string must not change or every existing user falls through to `defaultPolicy.tools: "ask"` (template line 12)
- `extensions/web-tools/index.ts:247-272,407-441` — the only existing `renderCall`/`renderResult` precedent in the repo (web_search, web_fetch); both return `new Text(styled, 0, 0)` with branches on `expanded`/`isError`/`isPartial`
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts:221-280` — upstream Pi example, already uses `switch (details.action)` across its 4 verbs; template for dispatch shape
- `@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:281-302` — `ToolDefinition<TParams, TDetails, TState>` signature. `execute` returns `Promise<AgentToolResult<TDetails>>`; `renderCall(args, theme, context)` and `renderResult(result, {expanded, isPartial}, theme, context)` are optional
- `@mariozechner/pi-agent-core/dist/types.d.ts:248-253` — `AgentToolResult<T>` = `{ content, details, isError? }` (web-tools uses `isError: true` on the result object directly)
- `@mariozechner/pi-ai` `ToolResultMessage.details` is OPTIONAL — the replay loop must guard for undefined
- `StringEnum([...] as const)` from `@mariozechner/pi-ai` produces `{type:"string", enum:[...]}` (via `Type.Unsafe`) — use it for the `action`/`status` enums
- Valid `theme.fg()` roles include `success`, `error`, `warning`, `muted`, `dim`, `accent`, `toolTitle`, `text` (full `ThemeColor` union in `theme.d.ts`)
- `ctx.ui.notify(message, type)` accepts only `"info" | "warning" | "error"` — no `"success"`

### Constraints to Work Within

- **Permissions exact-name match** — `permission-manager.ts:724` does literal object-key lookup; tool name must stay `todo`
- **Single persistence channel** — `AgentToolResult.details` is the only place state flows through session entries; anything not in `details` is lost on replay
- **`pi-tui` overlay hard-truncate** — overlays cap at `maxHeight` without scrolling (`tui.js:565-567`); rules out a scrollable task list component without ~130 LOC of input handling
- **Compaction is additive** — `session-manager.js:613-627` never rewrites the session file; pre-compaction `toolResult` entries survive and `getBranch()` returns them. No compaction insurance needed.
- **Replay runs on both `session_start` and `session_tree`** — any mutation must be idempotent under repeated replay

## Scope

### Building

- Full rewrite of `extensions/rpiv-core/todo.ts` (single file)
- New `Task` interface replacing `Todo` (7 fields + optional metadata)
- New `TaskDetails` envelope with `{action, params, tasks, nextId, error?}`
- `VALID_TRANSITIONS` map + pure helper functions (`isTransitionValid`, `detectCycle`, `deriveBlocks`)
- `applyTaskMutation(state, action, params) → {state, details, content}` pure reducer enforcing all invariants
- Expanded TypeBox schema for the tool's parameters (single flat `Type.Object` with per-action validation inside the reducer)
- Rewritten `promptGuidelines` teaching the new 4-state vocabulary
- Rewritten `reconstructTodoState` with type-guard for the new envelope shape
- New `renderCall` (compact) and `renderResult` (per-action dispatch, collapsed/expanded)
- Enhanced `registerTodosCommand` with status-grouped notify output

### Not Building

- **Four-tool split** (`TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet` as separate tools) — research decision, permissions hazard
- **Overlay component for `/todos`** — research decision, `pi-tui` truncation cost > single-use-case benefit
- **`appendEntry` persistence insurance** — research decision, compaction hazard is theoretical
- **Skill-prose edits** — integration scanner verified zero edits needed (all 20 mentions are name-only)
- **Legacy `{id, text, done}` shim** — research decision, rpiv-pi is pre-production
- **`session_compact` todo logic** — research decision, replay already covers it via `session_start`/`session_tree`
- **`activeForm` spinner animation** — static label only in v1 (research recommendation)
- **`createdAt`/`updatedAt` timestamps** — deferred, not strictly needed because reducer processes `getBranch()` in order
- **String task IDs** — research decision, keep numeric (touch site too large otherwise)
- **`index.ts:6` stale doc comment cleanup** — cosmetic, not required for correctness
- **`README.md:48` tool-list entry update** — cosmetic, entry already says "todo"

## Decisions

### Decision 1: Keep tool name `todo`

**Evidence**: Research + `pi-permission-system@0.4.1` at `permission-manager.ts:724` does exact-name lookup with no wildcards; `templates/pi-permissions.jsonc:26` seeds `"todo": "allow"`. Renaming pushes every LLM call to `defaultPolicy.tools: "ask"` (template line 12), which hangs non-interactive runs and prompts on every call in interactive mode.

### Decision 2: Single tool with action enum (not four tools)

**Evidence**: Matches (a) upstream Pi example at `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts:136-281`, (b) current rpiv-pi implementation at `todo.ts:52-133`, (c) Decision 1 (a single permissions entry covers everything). Four tools sharing closure state has zero precedent in either repo.

### Decision 3: Pure `applyTaskMutation` reducer

**Ambiguity**: Should invariant enforcement live inline in `execute` (current) or be extracted into a pure reducer?

**Explored**:
- **Option A (inline)** — keep the `switch (params.action)` body directly in `execute`. Simpler, matches existing code.
- **Option B (pure reducer)** — extract `applyTaskMutation(state, action, params) → {state, details, content}`. Invariants (state machine, cycle check, additive merge) defined in one place. Slight conceptual overhead but zero external API change.

**Decision**: **Option B**. The reducer is the research artifact's explicit "load-bearing abstraction" (Architecture Insights, research line 273). It centralizes invariant enforcement and makes future event-sourced replay a drop-in if Pi's compaction semantics ever change. Replay itself remains snapshot-based for v1 — the reducer is only called from `execute`, not from `reconstructTodoState`.

### Decision 4: Snapshot-based replay (not event-sourced)

**Evidence**: Research line 284 — "snapshot-based replay is sufficient for rpiv-pi because the reducer is the only writer." `reconstructTodoState` just copies `details.tasks` and `details.nextId` from the last matching `toolResult`; invariants are not re-checked on replay because they were already checked on write.

**Trade-off**: If a future Pi release physically prunes pre-compaction `toolResult` entries, replay would break. Mitigation: the reducer is already pure, so switching to event-sourced replay is a one-function change.

### Decision 5: Envelope key `details.tasks` (not `details.todos`)

**Evidence**: Research is pre-production; "no legacy-session shim" (line 32) means we can rename freely. `details.tasks` aligns with the CC vocabulary the upgrade targets and with the rest of the Architecture Insights section in the research artifact.

### Decision 6: `list` hides deleted tasks by default (opt-in `includeDeleted`)

**Evidence**: Developer checkpoint selected "Hide by default + opt-in flag" (Recommended). Matches CC `TaskList` default behavior; tombstones still anchor `blockedBy` references so they're preserved in state, just filtered from the default view.

### Decision 7: `update` uses additive `addBlockedBy` / `removeBlockedBy` (not replace)

**Evidence**: Developer checkpoint selected "CC-style additive merge" (Recommended). Matches Claude Code's `TaskUpdate` field names exactly; avoids the full-array resend error class.

### Decision 8: `list` accepts optional `status` filter

**Evidence**: Developer checkpoint selected "Yes — single status string" (Recommended). ~5 LOC in the reducer; small UX win; matches CC `TaskList` filter.

### Decision 9: Legal state transitions

```
pending      → in_progress  (start work)
pending      → completed    (skip — finish without start)
in_progress  → pending      (pause)
in_progress  → completed    (finish)
*            → deleted      (tombstone from any state)
completed    → *            REJECTED (terminal)
deleted      → *            REJECTED (terminal)
```

Enforced in the reducer via a `VALID_TRANSITIONS: Record<TaskStatus, Set<TaskStatus>>` lookup. `create` never accepts a `status` parameter — tasks are always born `pending`.

### Decision 10: `blockedBy` invariants

- Unknown id in `blockedBy` → error (reducer returns `{error: "#N not found"}`)
- Cycle in `blockedBy` graph → error (DFS, reject pre-commit)
- Dangling reference to a `deleted` task on `create`/`update` → error (same treatment as unknown)
- `blocks` (the inverse) is DERIVED via `deriveBlocks()` on read in `list`/`get` — never a parameter

### Decision 11: `get` returns tombstoned tasks

**Evidence**: Matches CC `TaskGet` — a known id always returns the record regardless of status. Only unknown ids error.

### Decision 12: Mutable fields on `update`

- `subject`, `description`, `activeForm`, `status`, `owner`, `metadata` — standard replace semantics (pass the new value, reducer replaces)
- `addBlockedBy` / `removeBlockedBy` — additive merge semantics per Decision 7
- `update` with zero mutable fields passed → error ("at least one field required")
- `id` is never mutable (it's the selector)

### Decision 13: Per-action `renderResult` dispatch

`renderResult(result, {expanded, isPartial}, theme, _ctx)` reads `result.details.action` and branches:

- `create`: `✓ Created #N subject (pending)` collapsed; expanded adds `activeForm` and `blockedBy` edges
- `update`: `◐ #3 pending → in_progress` collapsed; expanded adds previous status + unblocked downstream ids
- `list`: `N pending · M in_progress · K completed` collapsed; expanded shows grouped-by-status with first 15 items + `... N more` footer
- `get`: single line with status glyph + subject collapsed; expanded shows full record
- `delete`: `✗ Deleted #N subject`
- `clear`: `✓ Cleared N tasks`

Glyphs: `◐` (in_progress, warning), `✓` (completed, success), `○` (pending, dim), `✗` (deleted, error). Pattern modeled on `extensions/web-tools/index.ts:253-272` (web_search renderResult).

### Decision 14: `/todos` enhancement (no overlay)

`ctx.ui.notify` with status-grouped output:

```
3/7 completed · 1 in_progress · 2 pending
── Pending ──
  ○ #4 subject…    ⛓ #2
── In Progress ──
  ◐ #2 (writing tests)
── Completed ──
  ✓ #1 subject
```

Single `ctx.ui.notify(string, "info")` call; no custom component. Research decision — pi-tui overlays hard-truncate at `maxHeight`.

### Decision 15: Error-return pattern (recoverable errors)

Match existing pattern at `todo.ts:87-90,102-105,108-112`: return `{ content: [text], details: {action, params, tasks, nextId, error: string} }`. Do NOT throw for recoverable errors (missing required field, unknown id, illegal transition, cycle) — return the error in `details.error` so the LLM can read the message and retry with correct parameters. No `isError: true` on the result for these cases (matches existing file).

## Architecture

### extensions/rpiv-core/todo.ts — MODIFY (full rewrite)

Single-file rewrite. The file is currently 161 lines; the new version replaces all of it but keeps the three exports consumed by `index.ts`: `registerTodoTool`, `registerTodosCommand`, `reconstructTodoState`. (`getTodos()` is also kept as a no-consumer internal accessor used by `registerTodosCommand`.)

```typescript
/**
 * todo tool + /todos command — Claude-Code-parity Task management.
 *
 * State lives in this module and persists via the tool's AgentToolResult.details
 * envelope. reconstructTodoState (Slice 3) walks ctx.sessionManager.getBranch()
 * and restores the last snapshot; the pure applyTaskMutation reducer (Slice 2)
 * is the single source of truth for invariants — state machine transitions,
 * blockedBy cycle checks, dangling-reference rejection. Tool name is
 * deliberately "todo" (not TaskCreate/etc.) to preserve the permissions entry
 * at templates/pi-permissions.jsonc:26.
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

export interface TaskDetails {
	action: TaskAction;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Legal status transitions. `deleted` is a universal tombstone reachable from
 * every non-terminal state. `completed` and `deleted` are terminal; any
 * transition out of them (other than to `deleted`) is rejected by the reducer.
 */
const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
	pending: new Set(["in_progress", "completed", "deleted"]),
	in_progress: new Set(["pending", "completed", "deleted"]),
	completed: new Set(["deleted"]),
	deleted: new Set(),
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let tasks: Task[] = [];
let nextId = 1;

/** Internal accessor used by the /todos command. */
export function getTodos(): readonly Task[] {
	return tasks;
}

// ---------------------------------------------------------------------------
// Pure helpers — no state mutation, no I/O
// ---------------------------------------------------------------------------

export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return true;
	return VALID_TRANSITIONS[from].has(to);
}

/**
 * Detects a cycle in the blockedBy graph that would be introduced by merging
 * `newBlockedBy` into task `taskId`'s existing edges. Pure — does not mutate.
 * Linear DFS over the full task list; acceptable for realistic list sizes.
 */
export function detectCycle(
	taskList: readonly Task[],
	taskId: number,
	newBlockedBy: readonly number[],
): boolean {
	const edges = new Map<number, number[]>();
	for (const t of taskList) {
		if (t.id === taskId) {
			const merged = new Set([...(t.blockedBy ?? []), ...newBlockedBy]);
			edges.set(t.id, [...merged]);
		} else {
			edges.set(t.id, t.blockedBy ? [...t.blockedBy] : []);
		}
	}

	const visiting = new Set<number>();
	const visited = new Set<number>();
	const hasCycleFrom = (node: number): boolean => {
		if (visiting.has(node)) return true;
		if (visited.has(node)) return false;
		visiting.add(node);
		for (const nb of edges.get(node) ?? []) {
			if (hasCycleFrom(nb)) return true;
		}
		visiting.delete(node);
		visited.add(node);
		return false;
	};

	for (const node of edges.keys()) {
		if (hasCycleFrom(node)) return true;
	}
	return false;
}

/**
 * Inverse of blockedBy: for each task id, the list of task ids that are
 * currently blocked by it. Computed on read in list/get renderers; never
 * accepted as a write parameter.
 */
export function deriveBlocks(taskList: readonly Task[]): Map<number, number[]> {
	const blocks = new Map<number, number[]>();
	for (const t of taskList) {
		for (const dep of t.blockedBy ?? []) {
			const arr = blocks.get(dep) ?? [];
			arr.push(t.id);
			blocks.set(dep, arr);
		}
	}
	return blocks;
}

// ---------------------------------------------------------------------------
// Reducer — pure, single source of truth for invariants
// ---------------------------------------------------------------------------

interface ReducerState {
	tasks: Task[];
	nextId: number;
}

interface ReducerResult {
	state: ReducerState;
	details: TaskDetails;
	content: Array<{ type: "text"; text: string }>;
}

/**
 * Parameter surface — mirrors the TypeBox schema registered in Slice 3.
 * Index signature keeps the upcast into `details.params` (Record<string, unknown>)
 * a clean widening with no `as unknown as` hack.
 */
interface TaskMutationParams {
	[key: string]: unknown;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TaskStatus;
	blockedBy?: number[];
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
	id?: number;
	includeDeleted?: boolean;
}

function errorResult(
	state: ReducerState,
	action: TaskAction,
	params: TaskMutationParams,
	error: string,
): ReducerResult {
	return {
		state,
		details: {
			action,
			params: params as Record<string, unknown>,
			tasks: state.tasks,
			nextId: state.nextId,
			error,
		},
		content: [{ type: "text", text: `Error: ${error}` }],
	};
}

/**
 * The load-bearing abstraction. Accepts the current state + an action verb +
 * its parameters, returns the new state and the tool result. Pure: no module
 * state touched, no I/O. Called from execute (Slice 3); replay uses a simpler
 * snapshot copy, so the reducer's invariants are enforced once at write time.
 */
export function applyTaskMutation(
	state: ReducerState,
	action: TaskAction,
	params: TaskMutationParams,
): ReducerResult {
	switch (action) {
		case "create": {
			if (!params.subject || !params.subject.trim()) {
				return errorResult(state, action, params, "subject required for create");
			}
			if (params.blockedBy && params.blockedBy.length) {
				for (const dep of params.blockedBy) {
					const depTask = state.tasks.find((t) => t.id === dep);
					if (!depTask) {
						return errorResult(
							state,
							action,
							params,
							`blockedBy: #${dep} not found`,
						);
					}
					if (depTask.status === "deleted") {
						return errorResult(
							state,
							action,
							params,
							`blockedBy: #${dep} is deleted`,
						);
					}
				}
			}
			const newTask: Task = {
				id: state.nextId,
				subject: params.subject,
				status: "pending",
			};
			if (params.description) newTask.description = params.description;
			if (params.activeForm) newTask.activeForm = params.activeForm;
			if (params.blockedBy && params.blockedBy.length) {
				newTask.blockedBy = [...params.blockedBy];
			}
			if (params.owner) newTask.owner = params.owner;
			if (params.metadata) newTask.metadata = { ...params.metadata };

			const newTasks = [...state.tasks, newTask];
			const newState: ReducerState = { tasks: newTasks, nextId: state.nextId + 1 };
			return {
				state: newState,
				details: {
					action: "create",
					params: params as Record<string, unknown>,
					tasks: newTasks,
					nextId: newState.nextId,
				},
				content: [
					{
						type: "text",
						text: `Created #${newTask.id}: ${newTask.subject} (pending)`,
					},
				],
			};
		}

		case "update": {
			if (params.id === undefined) {
				return errorResult(state, action, params, "id required for update");
			}
			const idx = state.tasks.findIndex((t) => t.id === params.id);
			if (idx === -1) {
				return errorResult(state, action, params, `#${params.id} not found`);
			}
			const current = state.tasks[idx];

			const hasMutation =
				params.subject !== undefined ||
				params.description !== undefined ||
				params.activeForm !== undefined ||
				params.status !== undefined ||
				params.owner !== undefined ||
				params.metadata !== undefined ||
				(params.addBlockedBy && params.addBlockedBy.length > 0) ||
				(params.removeBlockedBy && params.removeBlockedBy.length > 0);
			if (!hasMutation) {
				return errorResult(
					state,
					action,
					params,
					"update requires at least one mutable field",
				);
			}

			// Status transition check
			let newStatus = current.status;
			if (params.status !== undefined) {
				if (!isTransitionValid(current.status, params.status)) {
					return errorResult(
						state,
						action,
						params,
						`illegal transition ${current.status} → ${params.status}`,
					);
				}
				newStatus = params.status;
			}

			// blockedBy additive merge — remove first, then add (CC semantics)
			let newBlockedBy = current.blockedBy ? [...current.blockedBy] : [];
			if (params.removeBlockedBy && params.removeBlockedBy.length) {
				const toRemove = new Set(params.removeBlockedBy);
				newBlockedBy = newBlockedBy.filter((dep) => !toRemove.has(dep));
			}
			if (params.addBlockedBy && params.addBlockedBy.length) {
				for (const dep of params.addBlockedBy) {
					if (dep === current.id) {
						return errorResult(
							state,
							action,
							params,
							`cannot block #${current.id} on itself`,
						);
					}
					const depTask = state.tasks.find((t) => t.id === dep);
					if (!depTask) {
						return errorResult(
							state,
							action,
							params,
							`addBlockedBy: #${dep} not found`,
						);
					}
					if (depTask.status === "deleted") {
						return errorResult(
							state,
							action,
							params,
							`addBlockedBy: #${dep} is deleted`,
						);
					}
					if (!newBlockedBy.includes(dep)) newBlockedBy.push(dep);
				}
				if (detectCycle(state.tasks, current.id, newBlockedBy)) {
					return errorResult(
						state,
						action,
						params,
						"addBlockedBy would create a cycle in the blockedBy graph",
					);
				}
			}

			// metadata merge with null-delete (CC semantics)
			let newMetadata = current.metadata;
			if (params.metadata !== undefined) {
				const merged: Record<string, unknown> = { ...(current.metadata ?? {}) };
				for (const [k, v] of Object.entries(params.metadata)) {
					if (v === null) delete merged[k];
					else merged[k] = v;
				}
				newMetadata = Object.keys(merged).length ? merged : undefined;
			}

			const updated: Task = { ...current, status: newStatus };
			if (params.subject !== undefined) updated.subject = params.subject;
			if (params.description !== undefined) updated.description = params.description;
			if (params.activeForm !== undefined) updated.activeForm = params.activeForm;
			if (params.owner !== undefined) updated.owner = params.owner;
			if (newBlockedBy.length) {
				updated.blockedBy = newBlockedBy;
			} else {
				delete updated.blockedBy;
			}
			if (newMetadata === undefined) {
				delete updated.metadata;
			} else {
				updated.metadata = newMetadata;
			}

			const newTasks = [...state.tasks];
			newTasks[idx] = updated;
			const transition =
				current.status !== newStatus
					? ` (${current.status} → ${newStatus})`
					: "";
			return {
				state: { tasks: newTasks, nextId: state.nextId },
				details: {
					action: "update",
					params: params as Record<string, unknown>,
					tasks: newTasks,
					nextId: state.nextId,
				},
				content: [
					{ type: "text", text: `Updated #${updated.id}${transition}` },
				],
			};
		}

		case "list": {
			const includeDeleted = params.includeDeleted === true;
			const statusFilter = params.status;
			let view = state.tasks;
			if (!includeDeleted) {
				view = view.filter((t) => t.status !== "deleted");
			}
			if (statusFilter) {
				view = view.filter((t) => t.status === statusFilter);
			}
			const text =
				view.length === 0
					? "No tasks"
					: view
							.map((t) => {
								const block = t.blockedBy?.length
									? ` ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`
									: "";
								const form =
									t.status === "in_progress" && t.activeForm
										? ` (${t.activeForm})`
										: "";
								return `[${t.status}] #${t.id} ${t.subject}${form}${block}`;
							})
							.join("\n");
			return {
				state,
				details: {
					action: "list",
					params: params as Record<string, unknown>,
					tasks: state.tasks,
					nextId: state.nextId,
				},
				content: [{ type: "text", text }],
			};
		}

		case "get": {
			if (params.id === undefined) {
				return errorResult(state, action, params, "id required for get");
			}
			const task = state.tasks.find((t) => t.id === params.id);
			if (!task) {
				return errorResult(state, action, params, `#${params.id} not found`);
			}
			const blocks = deriveBlocks(state.tasks).get(task.id) ?? [];
			const lines = [`#${task.id} [${task.status}] ${task.subject}`];
			if (task.description) lines.push(`  description: ${task.description}`);
			if (task.activeForm) lines.push(`  activeForm: ${task.activeForm}`);
			if (task.blockedBy?.length) {
				lines.push(
					`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`,
				);
			}
			if (blocks.length) {
				lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
			}
			if (task.owner) lines.push(`  owner: ${task.owner}`);
			return {
				state,
				details: {
					action: "get",
					params: params as Record<string, unknown>,
					tasks: state.tasks,
					nextId: state.nextId,
				},
				content: [{ type: "text", text: lines.join("\n") }],
			};
		}

		case "delete": {
			if (params.id === undefined) {
				return errorResult(state, action, params, "id required for delete");
			}
			const idx = state.tasks.findIndex((t) => t.id === params.id);
			if (idx === -1) {
				return errorResult(state, action, params, `#${params.id} not found`);
			}
			const current = state.tasks[idx];
			if (current.status === "deleted") {
				return errorResult(
					state,
					action,
					params,
					`#${current.id} is already deleted`,
				);
			}
			const updated: Task = { ...current, status: "deleted" };
			const newTasks = [...state.tasks];
			newTasks[idx] = updated;
			return {
				state: { tasks: newTasks, nextId: state.nextId },
				details: {
					action: "delete",
					params: params as Record<string, unknown>,
					tasks: newTasks,
					nextId: state.nextId,
				},
				content: [
					{ type: "text", text: `Deleted #${updated.id}: ${updated.subject}` },
				],
			};
		}

		case "clear": {
			const count = state.tasks.length;
			return {
				state: { tasks: [], nextId: 1 },
				details: {
					action: "clear",
					params: params as Record<string, unknown>,
					tasks: [],
					nextId: 1,
				},
				content: [{ type: "text", text: `Cleared ${count} tasks` }],
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Persistence — snapshot-based replay with type-guard
// ---------------------------------------------------------------------------

/**
 * Type-guard for the new TaskDetails envelope shape. Legacy pre-upgrade
 * session entries were shaped as `{action, todos: [{id, text, done}], nextId}`
 * and lack the `tasks` key — they are silently skipped by the replay loop.
 */
function isTaskDetails(value: unknown): value is TaskDetails {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.tasks) && typeof v.nextId === "number";
}

/**
 * Rebuild module state from the session entries on the current branch.
 * Walks `ctx.sessionManager.getBranch()` and applies each matching
 * `toolResult` entry's snapshot in order; last write wins. Called on
 * `session_start` and `session_tree` from `index.ts:35,99`.
 *
 * `ctx` is typed loosely to avoid coupling to the ExtensionContext surface.
 */
export function reconstructTodoState(ctx: any): void {
	tasks = [];
	nextId = 1;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
		if (!isTaskDetails(msg.details)) continue;
		tasks = msg.details.tasks.map((t) => ({ ...t }));
		nextId = msg.details.nextId;
	}
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function statusGlyph(status: TaskStatus, theme: Theme): string {
	switch (status) {
		case "pending":
			return theme.fg("dim", "○");
		case "in_progress":
			return theme.fg("warning", "◐");
		case "completed":
			return theme.fg("success", "✓");
		case "deleted":
			return theme.fg("error", "✗");
	}
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const TodoParams = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	subject: Type.Optional(
		Type.String({ description: "Task subject line (required for create)" }),
	),
	description: Type.Optional(
		Type.String({ description: "Long-form task description" }),
	),
	activeForm: Type.Optional(
		Type.String({
			description:
				"Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
			description: "Target status (update) or list filter (list)",
		}),
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Initial blockedBy ids (create only)",
		}),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to add to blockedBy (update only, additive merge)",
		}),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to remove from blockedBy (update only, additive merge)",
		}),
	),
	owner: Type.Optional(
		Type.String({ description: "Agent/owner assigned to this task" }),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description:
				"Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(
		Type.Number({
			description: "Task id (required for update, get, delete)",
		}),
	),
	includeDeleted: Type.Optional(
		Type.Boolean({
			description:
				"If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
		}),
	),
});

export function registerTodoTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
		promptSnippet: "Manage a Claude-Code-style task list to track multi-step progress",
		promptGuidelines: [
			"Use `todo` to plan and track multi-step work: create tasks up front, update status as you progress, and list/get to check state. Replaces TaskCreate/TaskUpdate/TaskList/TaskGet from Claude Code.",
			"Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. When starting work on a task, call update with status:\"in_progress\" and an activeForm spinner label. When finishing, call update with status:\"completed\".",
			"Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
			"list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
			"Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress (e.g. 'researching existing tool').",
		],
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = applyTaskMutation(
				{ tasks, nextId },
				params.action,
				params as TaskMutationParams,
			);
			tasks = result.state.tasks;
			nextId = result.state.nextId;
			return {
				content: result.content,
				details: result.details,
			};
		},

		renderCall(args, theme, _context) {
			let text =
				theme.fg("toolTitle", theme.bold("todo ")) +
				theme.fg("muted", args.action);
			if (args.action === "create" && args.subject) {
				text += ` ${theme.fg("dim", `"${args.subject}"`)}`;
			} else if (
				(args.action === "update" ||
					args.action === "get" ||
					args.action === "delete") &&
				args.id !== undefined
			) {
				text += ` ${theme.fg("accent", `#${args.id}`)}`;
				if (args.action === "update" && args.status) {
					text += ` ${theme.fg("muted", `→ ${args.status}`)}`;
				}
			} else if (args.action === "list" && args.status) {
				text += ` ${theme.fg("muted", args.status)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as TaskDetails | undefined;
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (details.error) {
				return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
			}

			switch (details.action) {
				case "create": {
					const created = details.tasks[details.tasks.length - 1];
					let text =
						theme.fg("success", "✓ Created ") +
						theme.fg("accent", `#${created.id}`) +
						" " +
						theme.fg("muted", created.subject) +
						" " +
						theme.fg("dim", "(pending)");
					if (expanded) {
						if (created.activeForm) {
							text += `\n  ${theme.fg("dim", `activeForm: ${created.activeForm}`)}`;
						}
						if (created.blockedBy?.length) {
							text += `\n  ${theme.fg(
								"dim",
								`⛓ blocked by ${created.blockedBy
									.map((id) => `#${id}`)
									.join(", ")}`,
							)}`;
						}
					}
					return new Text(text, 0, 0);
				}

				case "update": {
					const updatedId = details.params.id as number;
					const updated = details.tasks.find((t) => t.id === updatedId);
					if (!updated) return new Text(theme.fg("muted", "Updated"), 0, 0);
					let text =
						statusGlyph(updated.status, theme) +
						" " +
						theme.fg("accent", `#${updated.id}`);
					if (details.params.status !== undefined) {
						text += " " + theme.fg("muted", `→ ${updated.status}`);
					}
					text += " " + theme.fg("dim", updated.subject);
					if (expanded) {
						if (updated.activeForm && updated.status === "in_progress") {
							text += `\n  ${theme.fg("dim", `activeForm: ${updated.activeForm}`)}`;
						}
						if (updated.blockedBy?.length) {
							text += `\n  ${theme.fg(
								"dim",
								`⛓ blocked by ${updated.blockedBy
									.map((id) => `#${id}`)
									.join(", ")}`,
							)}`;
						}
						if (updated.description) {
							text += `\n  ${theme.fg("dim", updated.description)}`;
						}
					}
					return new Text(text, 0, 0);
				}

				case "list": {
					const includeDeleted = details.params.includeDeleted === true;
					const statusFilter = details.params.status as TaskStatus | undefined;
					let view = details.tasks;
					if (!includeDeleted) {
						view = view.filter((t) => t.status !== "deleted");
					}
					if (statusFilter) {
						view = view.filter((t) => t.status === statusFilter);
					}
					if (view.length === 0) {
						return new Text(theme.fg("dim", "No tasks"), 0, 0);
					}
					const counts: Record<TaskStatus, number> = {
						pending: 0,
						in_progress: 0,
						completed: 0,
						deleted: 0,
					};
					for (const t of view) counts[t.status]++;
					const summary = [
						counts.pending > 0 && `${counts.pending} pending`,
						counts.in_progress > 0 && `${counts.in_progress} in_progress`,
						counts.completed > 0 && `${counts.completed} completed`,
						counts.deleted > 0 && `${counts.deleted} deleted`,
					]
						.filter(Boolean)
						.join(" · ");
					let text = theme.fg("muted", summary);

					if (expanded) {
						const display = view.slice(0, 15);
						for (const t of display) {
							const glyph = statusGlyph(t.status, theme);
							const subject =
								t.status === "completed" || t.status === "deleted"
									? theme.fg("dim", t.subject)
									: theme.fg("text", t.subject);
							const form =
								t.status === "in_progress" && t.activeForm
									? " " + theme.fg("dim", `(${t.activeForm})`)
									: "";
							const block = t.blockedBy?.length
								? " " +
								  theme.fg(
										"dim",
										`⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`,
								  )
								: "";
							text += `\n  ${glyph} ${theme.fg(
								"accent",
								`#${t.id}`,
							)} ${subject}${form}${block}`;
						}
						if (view.length > 15) {
							text += `\n  ${theme.fg("dim", `... and ${view.length - 15} more`)}`;
						}
					}
					return new Text(text, 0, 0);
				}

				case "get": {
					const taskId = details.params.id as number;
					const task = details.tasks.find((t) => t.id === taskId);
					if (!task) {
						return new Text(theme.fg("error", `#${taskId} not found`), 0, 0);
					}
					let text =
						statusGlyph(task.status, theme) +
						" " +
						theme.fg("accent", `#${task.id}`) +
						" " +
						theme.fg("muted", task.subject);
					if (expanded) {
						if (task.description) {
							text += `\n  ${theme.fg("dim", task.description)}`;
						}
						if (task.activeForm) {
							text += `\n  ${theme.fg("dim", `activeForm: ${task.activeForm}`)}`;
						}
						if (task.blockedBy?.length) {
							text += `\n  ${theme.fg(
								"dim",
								`⛓ blocked by ${task.blockedBy
									.map((id) => `#${id}`)
									.join(", ")}`,
							)}`;
						}
						if (task.owner) {
							text += `\n  ${theme.fg("dim", `owner: ${task.owner}`)}`;
						}
					}
					return new Text(text, 0, 0);
				}

				case "delete": {
					const taskId = details.params.id as number;
					const task = details.tasks.find((t) => t.id === taskId);
					const label = task?.subject
						? " " + theme.fg("muted", task.subject)
						: "";
					return new Text(
						theme.fg("error", "✗ Deleted ") +
							theme.fg("accent", `#${taskId}`) +
							label,
						0,
						0,
					);
				}

				case "clear": {
					return new Text(
						theme.fg("success", "✓ ") +
							theme.fg("muted", "Cleared all tasks"),
						0,
						0,
					);
				}
			}
		},
	});
}

// ---------------------------------------------------------------------------
// /todos slash command
// ---------------------------------------------------------------------------

export function registerTodosCommand(pi: ExtensionAPI): void {
	pi.registerCommand("todos", {
		description: "Show all todos on the current branch, grouped by status",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}
			const visible = tasks.filter((t) => t.status !== "deleted");
			if (visible.length === 0) {
				ctx.ui.notify("No todos yet. Ask the agent to add some!", "info");
				return;
			}

			const pending = visible.filter((t) => t.status === "pending");
			const inProgress = visible.filter((t) => t.status === "in_progress");
			const completed = visible.filter((t) => t.status === "completed");

			const header: string[] = [];
			if (completed.length > 0) {
				header.push(`${completed.length}/${visible.length} completed`);
			}
			if (inProgress.length > 0) {
				header.push(`${inProgress.length} in_progress`);
			}
			if (pending.length > 0) {
				header.push(`${pending.length} pending`);
			}

			const lines: string[] = [header.join(" · ")];

			const renderTask = (t: Task, glyph: string): string => {
				const form =
					t.status === "in_progress" && t.activeForm
						? ` (${t.activeForm})`
						: "";
				const block = t.blockedBy?.length
					? `    ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`
					: "";
				return `  ${glyph} #${t.id} ${t.subject}${form}${block}`;
			};

			if (pending.length > 0) {
				lines.push("── Pending ──");
				for (const t of pending) lines.push(renderTask(t, "○"));
			}
			if (inProgress.length > 0) {
				lines.push("── In Progress ──");
				for (const t of inProgress) lines.push(renderTask(t, "◐"));
			}
			if (completed.length > 0) {
				lines.push("── Completed ──");
				for (const t of completed) lines.push(renderTask(t, "✓"));
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
```

## Desired End State

### Example 1: LLM creates a research task list

```typescript
// LLM calls:
todo({ action: "create", subject: "Research existing todo tool" })
// → { content: [{type:"text", text:"Created #1: Research existing todo tool (pending)"}],
//     details: {action:"create", params:{...}, tasks:[{id:1, subject:"Research existing todo tool", status:"pending"}], nextId:2} }

todo({ action: "create", subject: "Draft upgrade plan", blockedBy: [1] })
// → tasks:[{id:1,...}, {id:2, subject:"Draft upgrade plan", status:"pending", blockedBy:[1]}], nextId:3

todo({ action: "update", id: 1, status: "in_progress", activeForm: "scanning todo.ts" })
// → task #1 now status:"in_progress", activeForm:"scanning todo.ts"
// → renderResult shows: ◐ #1 pending → in_progress

todo({ action: "list" })
// → returns all non-deleted tasks grouped by status
// → renderResult shows: 1 pending · 1 in_progress · 0 completed
```

### Example 2: `/todos` slash command output

```
3/7 completed · 1 in_progress · 2 pending
── Pending ──
  ○ #4 Write implementation    ⛓ #2
  ○ #5 Run tests               ⛓ #4
── In Progress ──
  ◐ #2 (writing tests)
── Completed ──
  ✓ #1 Research current impl
  ✓ #3 Draft design artifact
```

### Example 3: State survives compaction + branch navigation

- User starts session, LLM creates 3 tasks → 3 `toolResult` entries persisted in session
- Compaction triggers → `session_compact` event; extension does nothing
- New `toolResult` entries arrive → state advances via `execute` → reducer
- User navigates to a branch mid-session → `session_tree` event fires → `reconstructTodoState` walks `getBranch()` and restores the snapshot for that branch point

## File Map

```
extensions/rpiv-core/todo.ts    # MODIFY — full rewrite (single file in scope)
```

No other files touched. `index.ts` import signature is preserved (`registerTodoTool`, `registerTodosCommand`, `reconstructTodoState`); `getTodos()` remains exported for the `/todos` command.

## Ordering Constraints

Slices are sequential because they all MODIFY the same file:

```
Slice 1 (types + helpers)        ← foundation
   ↓
Slice 2 (reducer)                ← consumes Slice 1 helpers
   ↓
Slice 3 (tool registration)      ← consumes reducer from Slice 2
   ↓
Slice 4 (rendering callbacks)    ← consumes action enum + TaskDetails from Slice 3
   ↓
Slice 5 (/todos command)         ← consumes module state from Slice 1 (logically), written last to keep file layout clean
```

Slice 5 is logically dependent only on Slice 1 (module state), but it goes last in generation order because it occupies the bottom of the file and merging it mid-file would invalidate later slice merges.

No parallel slices — single-file modification forbids it.

## Verification Notes

- **Tool name literal**: `grep -n '"todo"' extensions/rpiv-core/todo.ts` must show `name: "todo"` at the `pi.registerTool` call site. Any rename is a regression.
- **Permissions file unchanged**: `git diff extensions/rpiv-core/templates/pi-permissions.jsonc` must be empty after the upgrade.
- **Export surface preserved**: `grep -n '^export' extensions/rpiv-core/todo.ts` must show at least `registerTodoTool`, `registerTodosCommand`, `reconstructTodoState`. `getTodos` is optional but expected.
- **No skill edits**: `git diff skills/ agents/` must be empty.
- **State machine**: manual test — `todo({action:"update", id:X, status:"completed"})` followed by `todo({action:"update", id:X, status:"pending"})` must return `details.error` matching `/completed/i`.
- **Cycle detection**: manual test — create #1, create #2 blockedBy #1, then `update #1 addBlockedBy:[2]` must return `details.error` matching `/cycle/i`.
- **Dangling reference**: `todo({action:"create", subject:"x", blockedBy:[999]})` must return `details.error` matching `/not found/i`.
- **Deleted reference rejection**: create #1, `delete #1`, then `todo({action:"create", subject:"y", blockedBy:[1]})` must return `details.error` matching `/deleted/i`. Same for `update` with `addBlockedBy:[1]`.
- **Tombstone hidden from list**: create #1, `delete #1`, then `list` must return empty tasks; `list({includeDeleted:true})` must include the tombstone.
- **Replay idempotency**: run `reconstructTodoState(ctx)` twice in a row; state must be identical after both calls.
- **Render glyphs**: visual inspection of `/todos` output after a mixed-state session.
- **Build**: `pnpm --filter rpiv-core build` (or repo-level `pnpm build`) must succeed with no TypeScript errors.

## Performance Considerations

- Reducer is O(n) in the number of tasks for cycle detection (single DFS per `update` with `addBlockedBy`); acceptable for realistic task list sizes (< 100).
- `deriveBlocks()` in `list`/`get` is O(n²) worst case (scan every task for every task's `blockedBy` edges). Fine for < 100 tasks; optimize only if this becomes hot.
- Replay loop is O(m) in the number of session entries on the branch (already the case today); reducer is NOT called during replay, only a snapshot copy, so per-entry work stays O(1).
- No additional `appendEntry` calls — no extra session I/O beyond what the existing tool already does.

## Migration Notes

**Legacy data**: pre-upgrade session entries shaped as `{id, text, done}` exist only in in-progress developer sessions (rpiv-pi is pre-production). Per Decision 4 + research decision (research line 32), no shim: the replay loop's new type-guard on `TaskDetails` shape will skip these entries, and any affected sessions start fresh on first `todo` tool call after the upgrade. Acceptable because there are no deployed users.

**Rollback strategy**: revert `extensions/rpiv-core/todo.ts` to the previous version via git. No external state to undo — the `templates/pi-permissions.jsonc` file is untouched, and no new files are created.

**Backwards compatibility**: `registerTodoTool`, `registerTodosCommand`, `reconstructTodoState` signatures are preserved; `index.ts` does not need to change.

## Pattern References

- `extensions/web-tools/index.ts:247-272` — `renderCall` + `renderResult` pattern with `expanded`/`isPartial`/`isError` branches; exact style to follow for the new `todo` renderers
- `extensions/web-tools/index.ts:253-269` — `slice(0, 5) + "... and N more"` pattern for truncated list rendering, reused here for `list` action's expanded view
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts:221-280` — upstream Pi example's `switch (details.action)` dispatch in `renderResult`; direct shape template
- `extensions/rpiv-core/todo.ts:87-90,102-105,108-112` — existing recoverable-error return pattern (`{content, details: {..., error: string}}` with no throw) — preserve semantics, just extend to new verbs
- `extensions/rpiv-core/todo.ts:33-46` — existing snapshot-replay loop structure, minus the schema-specific field names

## Developer Context

**Q (tombstone visibility on list)** — `Research Q2` deferred to planner. Hide deleted by default vs always show?
A: Hide deleted by default + opt-in `includeDeleted?: boolean` param (Recommended). Matches CC TaskList; tombstones still anchor `blockedBy` refs.

**Q (blockedBy semantics on update)** — `Research Q3` deferred to planner. Additive CC-style merge vs replace-array?
A: CC-style additive merge — `addBlockedBy: number[]` and `removeBlockedBy: number[]` separate fields (Recommended). Matches Claude Code exactly; avoids full-array resend errors.

**Q (list status filter param)** — `Research Q1` deferred to planner. Include `status?` filter param or force LLM to filter client-side?
A: Yes — `status?: TaskStatus` single-status filter on `list` (Recommended). ~5 LOC reducer change; small UX win.

**Q (slice decomposition)** — Developer proposed 5 slices (Types+Helpers → Reducer → Registration → Rendering → /todos) vs my initial 3-slice (Types+Reducer → Registration → Rendering+/todos).
A: Adopted developer's 5-slice. Reducer isolation is the right call per research artifact's "load-bearing abstraction" framing; helpers-first exposes the invariant contract; rendering vs /todos are genuinely distinct concerns.

## Design History

- Slice 1: types, state & helpers — approved as generated
- Slice 2: pure reducer — approved as generated
- Slice 3: tool registration & persistence — approved as generated
- Slice 4: rendering callbacks — approved as generated (with minor cascade: added `Theme` to Slice 1 import line; no semantic change to prior slices)
- Slice 5: /todos command — approved as generated

## References

- Research: `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md`
- Research questions source: `thoughts/shared/questions/2026-04-10_20-59-46_todo-tool-cc-parity.md`
- Prior migration research: `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md`
- Gap analysis (Option 2 TypeBox sketch): `/Users/sguslystyi/rpiv-skillbased/thoughts/shared/research/2026-04-10_gap-analysis-porting-to-pi.md` (Appendix B, lines 642-658)
- Current implementation: `extensions/rpiv-core/todo.ts` (pre-upgrade baseline at commit `d484cb3`)
- Upstream Pi example: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts`
- Render precedent: `extensions/web-tools/index.ts:247-272` (web_search), `:407-441` (web_fetch)
- `ToolDefinition` types: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:281-302`
- `AgentToolResult` types: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-agent-core/dist/types.d.ts:248-253`
- `Theme.fg` roles: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/theme/theme.d.ts`
- `ToolResultMessage.details` (optional!): `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/types.d.ts:134-142`
