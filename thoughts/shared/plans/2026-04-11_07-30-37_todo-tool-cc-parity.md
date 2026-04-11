---
date: 2026-04-11T03:30:37+0000
planner: Claude Code
git_commit: d484cb3
branch: master
repository: rpiv-pi
topic: "Upgrade rpiv-core `todo` tool to Claude Code TaskCreate/TaskUpdate/TaskList/TaskGet parity"
tags: [plan, todo-tool, rpiv-core, pi-extensions, claude-code-parity, state-machine, reducer-pattern]
status: ready
design_source: "thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Todo Tool CC-Parity Upgrade Implementation Plan

## Overview

Full rewrite of `extensions/rpiv-core/todo.ts` from a legacy 3-field `{id, text, done}` + 4-action switch (`list/add/toggle/clear`) to a full Claude-Code-parity `Task` record + 6-verb action set (`create/update/list/get/delete/clear`) backed by a pure `applyTaskMutation` reducer. The tool name stays `todo` to preserve the permissions entry at `templates/pi-permissions.jsonc:26`. Single-file rewrite — no other files touched; `index.ts` import signature is preserved.

Reference: design artifact at `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md`.

## Desired End State

- LLM creates tasks with `todo({ action: "create", subject: "..." })` — returns `Task` objects with full 4-state status machine
- Tasks transition: `pending → in_progress → completed`, plus `deleted` tombstone
- `blockedBy` dependency tracking with cycle detection and deleted-reference rejection
- `activeForm` spinner labels persisted on tasks
- Per-action `renderCall`/`renderResult` with collapsed and expanded views
- Enhanced `/todos` slash command with status-grouped output
- State survives compaction + branch navigation via snapshot-based replay
- No changes to permissions file, skill files, or `index.ts`

## What We're NOT Doing

- **Four-tool split** (`TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`) — single tool preserves permissions entry
- **Overlay component for `/todos`** — `ctx.ui.notify` toast enhanced instead
- **Legacy `{id, text, done}` shim** — rpiv-pi is pre-production
- **`activeForm` spinner animation** — static label only
- **`createdAt`/`updatedAt` timestamps** — deferred
- **String task IDs** — keep numeric
- **`index.ts` stale doc comment cleanup** — cosmetic
- **`README.md` tool-list entry update** — cosmetic

## Phase 1: Full Todo Tool Rewrite

### Overview
Replace the entire `extensions/rpiv-core/todo.ts` file with the CC-parity implementation. The new file contains: types (`Task`, `TaskDetails`, `TaskStatus`, `TaskAction`), state machine (`VALID_TRANSITIONS`), pure helpers (`isTransitionValid`, `detectCycle`, `deriveBlocks`), pure reducer (`applyTaskMutation`), snapshot-based replay (`reconstructTodoState` with type-guard), rendering helpers (`statusGlyph`), tool registration (`registerTodoTool` with `renderCall`/`renderResult`), and enhanced `/todos` command (`registerTodosCommand`).

### Changes Required:

#### 1. Full rewrite of todo module
**File**: `extensions/rpiv-core/todo.ts`
**Changes**: Replace entire file (161 lines → ~530 lines). Three exports consumed by `index.ts` are preserved: `registerTodoTool`, `registerTodosCommand`, `reconstructTodoState`. `getTodos()` remains exported for the `/todos` command.

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

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `pnpm --filter rpiv-core build` (no workspace present — verified via `bunx tsc -p /tmp/rpiv-tsconfig-check.json` against installed peer-deps, 0 errors)
- [x] Tool name literal preserved: `grep -n '"todo"' extensions/rpiv-core/todo.ts` must show `name: "todo"` at the `registerTool` call
- [x] Permissions file unchanged: `git diff extensions/rpiv-core/templates/pi-permissions.jsonc` must be empty
- [x] Export surface preserved: `grep -n '^export' extensions/rpiv-core/todo.ts` must show `registerTodoTool`, `registerTodosCommand`, `reconstructTodoState`, and optionally `getTodos`
- [x] No skill edits: `git diff skills/ agents/` must be empty
- [x] No index.ts changes: `git diff extensions/rpiv-core/index.ts` must be empty

#### Manual Verification:
- [ ] **State machine**: create a task, update to `completed`, then try to update back to `pending` — must return error matching `/completed/i`
- [ ] **Cycle detection**: create #1, create #2 blockedBy #1, then `update #1 addBlockedBy:[2]` — must return error matching `/cycle/i`
- [ ] **Dangling reference**: `todo({action:"create", subject:"x", blockedBy:[999]})` must return error matching `/not found/i`
- [ ] **Deleted reference rejection**: create #1, delete #1, then `create` with `blockedBy:[1]` must return error matching `/deleted/i`. Same for `update` with `addBlockedBy:[1]`
- [ ] **Tombstone hidden from list**: create #1, delete #1, then `list` must return empty; `list({includeDeleted:true})` must include the tombstone
- [ ] **Replay idempotency**: run `reconstructTodoState(ctx)` twice in a row; state must be identical after both calls
- [ ] **Render glyphs**: visual inspection of `/todos` output after a mixed-state session — verify ○/◐/✓/✗ glyphs and status grouping
- [ ] **`/todos` grouping**: after creating tasks in multiple statuses, run `/todos` — verify header shows "N/M completed · K in_progress · J pending" and sections are correctly grouped

---

## Testing Strategy

### Automated:
- `pnpm --filter rpiv-core build` — TypeScript compilation
- Grep checks for tool name, export surface, unchanged permissions file
- No lint/typecheck errors from the rewritten module

### Manual Testing Steps:
1. Start an interactive session and ask the agent to create 3-4 tasks with dependencies
2. Verify `renderCall` shows compact one-line with action + id/subject
3. Verify `renderResult` shows status glyph + transition info when collapsed, full details when expanded
4. Ask agent to update tasks through status transitions (pending → in_progress → completed)
5. Ask agent to delete a task and verify it's hidden from `list` but visible with `includeDeleted:true`
6. Run `/todos` command and verify grouped output
7. Test cycle detection: ask agent to create circular dependencies
8. Test dangling reference: ask agent to create a task with a non-existent blockedBy id
9. Navigate to a different branch and back — verify state restores correctly

## Performance Considerations

- Reducer is O(n) for cycle detection (single DFS per `update` with `addBlockedBy`); acceptable for realistic task list sizes (< 100)
- `deriveBlocks()` in `list`/`get` is O(n²) worst case; fine for < 100 tasks
- Replay loop is O(m) in session entries; reducer is NOT called during replay (snapshot copy only), so per-entry work stays O(1)
- No additional `appendEntry` calls — no extra session I/O

## Migration Notes

**Legacy data**: pre-upgrade session entries shaped as `{id, text, done}` will be silently skipped by the new type-guard in `reconstructTodoState`. Affected sessions start fresh on first `todo` tool call after upgrade. Acceptable — rpiv-pi is pre-production with no deployed users.

**Rollback strategy**: `git revert` on `extensions/rpiv-core/todo.ts`. No external state to undo; `templates/pi-permissions.jsonc` is untouched.

**Backwards compatibility**: `registerTodoTool`, `registerTodosCommand`, `reconstructTodoState` signatures are preserved; `index.ts` does not need to change.

## References

- Design: `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md`
- Research: `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md`
- Research questions: `thoughts/shared/questions/2026-04-10_20-59-46_todo-tool-cc-parity.md`
- Current implementation: `extensions/rpiv-core/todo.ts` (baseline at commit `d484cb3`)
- Upstream Pi example: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/todo.ts`
- Render precedent: `extensions/web-tools/index.ts:247-272`
