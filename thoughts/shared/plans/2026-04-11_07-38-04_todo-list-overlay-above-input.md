---
date: 2026-04-11T07:38:04-0400
planner: Claude Code
git_commit: d484cb3
branch: master
repository: rpiv-pi
topic: "Todo List Overlay Above User Input"
tags: [plan, todo-overlay, tui, interactive-mode, pi-tui, widget, extension-ui, rpiv-core]
status: ready
design_source: "thoughts/shared/designs/2026-04-11_07-19-35_todo-list-overlay-above-input.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Todo List Overlay Above User Input Implementation Plan

## Overview

Add a persistent `TodoOverlay` widget above the editor in `rpiv-core` that mirrors `@tintinweb/pi-subagents`'s `AgentWidget` shape. Registered via `ctx.ui.setWidget("rpiv-todos", factory, { placement: "aboveEditor" })`, auto-hides when empty, caps at 12 rendered rows with priority-based collapse (`in_progress → pending → completed`, rest summarized as `+N more`). Event-driven refresh (`tool_execution_end` + session hooks) with no timer. Drops the rich inline `renderResult` from the todo tool definition so the overlay becomes the canonical live view.

See design artifact `thoughts/shared/designs/2026-04-11_07-19-35_todo-list-overlay-above-input.md` for architectural decisions and code.

## Desired End State

After implementation:

- New file `extensions/rpiv-core/todo-overlay.ts` exports a `TodoOverlay` class with `setUICtx()`, `update()`, and `dispose()` methods.
- `extensions/rpiv-core/todo.ts` no longer has a `renderResult` key in `registerTodoTool` and no longer has the `statusGlyph` helper or the `Theme` import. `renderCall`, `execute`, reducer, types, `/todos` command, and `reconstructTodoState` are unchanged.
- `extensions/rpiv-core/index.ts` has a closure-scoped `todoOverlay` instance, imports `TodoOverlay`, and calls `setUICtx` + `update` in `session_start`, `session_compact`, `session_tree`, and a new `tool_execution_end` handler; `dispose` + null-out in `session_shutdown`.
- Interactive session with a todo task created shows the overlay above the editor: `● Todos (0/1)` heading + one child line. After `todo clear`, the overlay unregisters and the row collapses.
- Chat inline rendering for a `todo create` call shows only `renderCall` + the `Created #N: …` one-line fallback stub, not the expanded status card.
- TypeScript typechecks clean; no changes to permissions, tool name, or persistence schema.

## What We're NOT Doing

- **Scrolling**: no `scrollOffset` state, no `handleInput`, no global input listener. Overflow collapses to `+N more` summary.
- **Non-capturing overlay pattern** (`ctx.ui.custom` + `overlayOptions.nonCapturing`): not needed for read-only display.
- **Timer-driven refresh**: `setInterval` omitted entirely. All refreshes are event-driven.
- **Status bar integration**: no `setStatus("rpiv-todos", ...)`.
- **Completed-task aging**: no linger-then-expire. Completed tasks remain visible until explicitly deleted or cleared.
- **Widget ordering enforcement** vs. `"agents"` widget: accept registration-race Map order.
- **Scroll-safe full-list view inside the overlay**: use the existing `/todos` slash command.
- **Changes to `renderCall`, `execute`, reducer, types, `/todos` slash command, `reconstructTodoState`, or permissions**.

## Phase 1: Todo Overlay Widget

### Overview

Create the `TodoOverlay` controller class, drop `renderResult` from the todo tool definition, and wire the overlay into lifecycle hooks in `index.ts`. All three files land together because Slice 3 imports from Slice 1 and there are no runtime ordering constraints between them.

### Changes Required:

#### 1. TodoOverlay controller class (NEW)
**File**: `extensions/rpiv-core/todo-overlay.ts`
**Changes**: New file. Mirrors `agent-widget.js:91-410` structure (factory-form `setWidget`, register-once + `requestRender()`, auto-hide on empty) with todo-specific rendering and simplified lifecycle — no timer, no status bar, no aging.

```typescript
/**
 * todo-overlay.ts — Persistent widget showing todo list above the editor.
 *
 * Mirrors @tintinweb/pi-subagents's AgentWidget shape: factory-form setWidget
 * registration in widgetContainerAbove, register-once + requestRender() refresh,
 * 12-line collapse-not-scroll, auto-hide when empty. No timer (todos have no
 * animation), no status bar, no aging map.
 *
 * Data source is module-level getTodos() read at render time — NEVER
 * reconstructTodoState from a tool_execution_end handler, since the persisted
 * branch is stale at that point (message_end runs after the extension event).
 */

import type {
	ExtensionUIContext,
	Theme,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, type TUI } from "@mariozechner/pi-tui";
import { getTodos, type Task, type TaskStatus } from "./todo.js";

// ---- Constants ----

const WIDGET_KEY = "rpiv-todos";
/** Maximum rendered lines before overflow-collapse kicks in. Mirrors AgentWidget. */
const MAX_WIDGET_LINES = 12;

// ---- Helpers ----

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

// ---- Controller ----

export class TodoOverlay {
	private uiCtx: ExtensionUIContext | undefined;
	private widgetRegistered = false;
	private tui: TUI | undefined;

	/**
	 * Bind or rebind the UI context. Identity-compares the incoming ctx so
	 * subsequent session_start handlers are idempotent; on identity change
	 * (e.g. /reload) cached widgetRegistered/tui are invalidated so the next
	 * update() re-registers under the fresh context.
	 */
	setUICtx(ctx: ExtensionUIContext): void {
		if (ctx !== this.uiCtx) {
			this.uiCtx = ctx;
			this.widgetRegistered = false;
			this.tui = undefined;
		}
	}

	/**
	 * Idempotent refresh. Safe to call from session_start, session_compact,
	 * session_tree, and tool_execution_end. Reads live state via getTodos() —
	 * NEVER calls reconstructTodoState (branch is stale during tool events).
	 */
	update(): void {
		if (!this.uiCtx) return;

		const visible = getTodos().filter((t) => t.status !== "deleted");

		// Empty → unregister and clear cached refs.
		if (visible.length === 0) {
			if (this.widgetRegistered) {
				this.uiCtx.setWidget(WIDGET_KEY, undefined);
				this.widgetRegistered = false;
				this.tui = undefined;
			}
			return;
		}

		// Non-empty → register once, then requestRender on subsequent updates.
		if (!this.widgetRegistered) {
			this.uiCtx.setWidget(
				WIDGET_KEY,
				(tui, theme) => {
					this.tui = tui;
					return {
						render: (width: number) => this.renderWidget(theme, width),
						invalidate: () => {
							// Theme changed — force factory re-invocation to capture fresh theme.
							this.widgetRegistered = false;
							this.tui = undefined;
						},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetRegistered = true;
		} else {
			this.tui?.requestRender();
		}
	}

	/**
	 * Build rendered rows. Called from the registered widget's render() closure,
	 * so it reads live state each time via getTodos() rather than capturing it.
	 * Enforces 12-line cap with priority-collapse: in_progress → pending →
	 * completed, overflow summary on the tail.
	 */
	private renderWidget(theme: Theme, width: number): string[] {
		const all = getTodos().filter((t) => t.status !== "deleted");
		if (all.length === 0) return [];

		const inProgress = all.filter((t) => t.status === "in_progress");
		const pending = all.filter((t) => t.status === "pending");
		const completed = all.filter((t) => t.status === "completed");

		const truncate = (line: string): string => truncateToWidth(line, width);

		const completedCount = completed.length;
		const totalVisible = all.length;
		const hasActive = inProgress.length > 0 || pending.length > 0;

		const headingColor = hasActive ? "accent" : "dim";
		const headingIcon = hasActive ? "●" : "○";
		const headingText = `Todos (${completedCount}/${totalVisible})`;
		const heading = truncate(
			theme.fg(headingColor, headingIcon) +
				" " +
				theme.fg(headingColor, headingText),
		);

		const lines: string[] = [heading];
		const maxBody = MAX_WIDGET_LINES - 1; // heading takes 1 row
		const totalBody = inProgress.length + pending.length + completed.length;

		if (totalBody <= maxBody) {
			// Everything fits — emit in priority order with tree connectors.
			for (const t of inProgress) {
				lines.push(truncate(theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme)));
			}
			for (const t of pending) {
				lines.push(truncate(theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme)));
			}
			for (const t of completed) {
				lines.push(truncate(theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme)));
			}
			// Fix last connector.
			const last = lines.length - 1;
			lines[last] = lines[last].replace("├─", "└─");
			return lines;
		}

		// Overflow — reserve 1 line for overflow indicator.
		const budget = maxBody - 1;
		let emitted = 0;
		let hiddenInProgress = 0;
		let hiddenPending = 0;
		let hiddenCompleted = 0;
		for (const t of inProgress) {
			if (emitted < budget) {
				lines.push(truncate(theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme)));
				emitted++;
			} else {
				hiddenInProgress++;
			}
		}
		for (const t of pending) {
			if (emitted < budget) {
				lines.push(truncate(theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme)));
				emitted++;
			} else {
				hiddenPending++;
			}
		}
		for (const t of completed) {
			if (emitted < budget) {
				lines.push(truncate(theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme)));
				emitted++;
			} else {
				hiddenCompleted++;
			}
		}

		const overflowParts: string[] = [];
		if (hiddenInProgress > 0) overflowParts.push(`${hiddenInProgress} in progress`);
		if (hiddenPending > 0) overflowParts.push(`${hiddenPending} pending`);
		if (hiddenCompleted > 0) overflowParts.push(`${hiddenCompleted} completed`);
		const totalHidden = hiddenInProgress + hiddenPending + hiddenCompleted;
		lines.push(
			truncate(
				theme.fg("dim", "└─") +
					" " +
					theme.fg(
						"dim",
						`+${totalHidden} more (${overflowParts.join(", ")})`,
					),
			),
		);
		return lines;
	}

	private formatTaskLine(t: Task, theme: Theme): string {
		const glyph = statusGlyph(t.status, theme);
		const id = theme.fg("accent", `#${t.id}`);
		const subjectColor =
			t.status === "completed" || t.status === "deleted" ? "dim" : "text";
		const subject = theme.fg(subjectColor, t.subject);
		let line = `${glyph} ${id} ${subject}`;
		if (t.status === "in_progress" && t.activeForm) {
			line += " " + theme.fg("dim", `(${t.activeForm})`);
		}
		if (t.blockedBy && t.blockedBy.length > 0) {
			line +=
				" " +
				theme.fg(
					"dim",
					`⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`,
				);
		}
		return line;
	}

	dispose(): void {
		if (this.uiCtx) {
			this.uiCtx.setWidget(WIDGET_KEY, undefined);
		}
		this.widgetRegistered = false;
		this.tui = undefined;
		this.uiCtx = undefined;
	}
}
```

#### 2. Drop `renderResult` from todo tool definition
**File**: `extensions/rpiv-core/todo.ts`
**Changes**: Three focused removals: remove unused `Theme` import; remove the `statusGlyph` helper (dead after `renderResult` removal); remove the entire `renderResult` key from `registerTodoTool`. `renderCall`, `execute`, reducer, types, `/todos` slash command, and `reconstructTodoState` are unchanged.

**(a) Import line — remove unused `Theme`** at `todo.ts:13`:

```typescript
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
```

After:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
```

**(b) Rendering helpers section — remove `statusGlyph`** at `todo.ts:510-529`:

```typescript
// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function formatStatus(status: TaskStatus): string {
	return status === "in_progress" ? "in progress" : status;
}
```

**(c) Tool definition — drop the entire `renderResult` key** at `todo.ts:621-829`. `renderCall` becomes the last key:

```typescript
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
					text += ` ${theme.fg("muted", `→ ${formatStatus(args.status)}`)}`;
				}
			} else if (args.action === "list" && args.status) {
				text += ` ${theme.fg("muted", formatStatus(args.status))}`;
			}
			return new Text(text, 0, 0);
		},
	});
}
```

**Effect on chat history**: `tool-execution.js:61-69` `getResultRenderer()` returns undefined for the `todo` tool, triggering `createResultFallback()` at `tool-execution.js:95-101` which reads `result.content[0].text` from the reducer's `content` field. Chat row shows a single-line stub like `"Created #5: write tests (pending)"`.

#### 3. Wire overlay into extension lifecycle hooks
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Import `TodoOverlay`, declare closure-scoped `todoOverlay` instance, wire into `session_start` (construct + bind + update), `session_compact` (reconstruct + update), `session_shutdown` (dispose + null), `session_tree` (update after reconstruct), and add a new `tool_execution_end` handler filtered on `toolName === "todo"`. Renames `_ctx` → `ctx` in `session_compact` since it's now used.

**(a) Import — add TodoOverlay** at `index.ts:24`:

```typescript
import { registerTodoTool, registerTodosCommand, reconstructTodoState } from "./todo.js";
import { TodoOverlay } from "./todo-overlay.js";
```

**(b) Extension setup — declare closure-scoped instance** at `index.ts:26-30`:

```typescript
export default function (pi: ExtensionAPI) {
	// Todo overlay widget — constructed lazily at the first session_start with UI.
	let todoOverlay: TodoOverlay | undefined;

	// ── Register Tools & Commands ──────────────────────────────────────────
	registerAskUserQuestionTool(pi);
	registerTodoTool(pi);
	registerTodosCommand(pi);
```

**(c) session_start — construct + bind + first update** at `index.ts:33-85`. Insert AFTER `reconstructTodoState(ctx)` so the first `update()` sees the correct module state. Gated on `ctx.hasUI`:

```typescript
	// ── Session Start ──────────────────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		clearInjectionState();
		reconstructTodoState(ctx);

		// Construct/rebind the todo overlay when UI is available. setUICtx is
		// idempotent on identity match and re-registers on rebind (/reload).
		if (ctx.hasUI) {
			todoOverlay ??= new TodoOverlay();
			todoOverlay.setUICtx(ctx.ui);
			todoOverlay.update();
		}

		// Seed a root `active_agent` session entry so pi-permission-system's
		// input handler can resolve the root context on the very first user
		// input. Without this, `/skill:<name>` as the first message of a fresh
		// session is blocked with "active agent context is unavailable" —
		// pi-permission-system@0.4.1 calls resolveAgentName(ctx) without
		// systemPrompt in its input handler, so it only checks session entries
		// and a stale cache, both empty before before_agent_start has fired.
		if (hasPiPermissionSystemInstalled()) {
			pi.appendEntry("active_agent", { name: "general-purpose" });
		}

		// Scaffold thoughts/ directory structure (artifact chain)
		const dirs = [
			"thoughts/shared/research",
			"thoughts/shared/questions",
			"thoughts/shared/designs",
			"thoughts/shared/plans",
			"thoughts/shared/handoffs",
		];
		for (const dir of dirs) {
			mkdirSync(join(ctx.cwd, dir), { recursive: true });
		}

		// Auto-copy bundled agents into <cwd>/.pi/agents/
		const agentResult = copyBundledAgents(ctx.cwd, false);
		if (ctx.hasUI && agentResult.copied.length > 0) {
			ctx.ui.notify(
				`Copied ${agentResult.copied.length} rpiv-pi agent(s) to .pi/agents/`,
				"info",
			);
		}

		// Seed ~/.pi/agent/pi-permissions.jsonc with rpiv-pi-friendly rules
		const seeded = seedPermissionsFile();
		if (ctx.hasUI && seeded) {
			ctx.ui.notify(
				"Seeded ~/.pi/agent/pi-permissions.jsonc with rpiv-pi defaults",
				"info",
			);
		}

		// Warn if @tintinweb/pi-subagents is not installed
		if (ctx.hasUI && !hasPiSubagentsInstalled()) {
			ctx.ui.notify(
				"rpiv-pi needs @tintinweb/pi-subagents for the Agent tool. Run /rpiv-setup to install it.",
				"warning",
			);
		}
	});
```

**(d) session_compact — eager reconstruct + update** at `index.ts:88-90`. Rename `_ctx` → `ctx`:

```typescript
	// ── Session Compact ────────────────────────────────────────────────────
	pi.on("session_compact", async (_event, ctx) => {
		clearInjectionState();
		reconstructTodoState(ctx);
		todoOverlay?.update();
	});
```

**(e) session_shutdown — dispose and null the reference** at `index.ts:93-95`:

```typescript
	// ── Session Shutdown ───────────────────────────────────────────────────
	pi.on("session_shutdown", async (_event, _ctx) => {
		clearInjectionState();
		todoOverlay?.dispose();
		todoOverlay = undefined;
	});
```

**(f) session_tree — refresh after reconstruct** at `index.ts:98-100`:

```typescript
	// ── Session Tree (reconstruct todo state) ─────────────────────────────
	pi.on("session_tree", async (_event, ctx) => {
		reconstructTodoState(ctx);
		todoOverlay?.update();
	});
```

**(g) tool_execution_end — new handler for todo mutations**. Insert after the `session_tree` handler (before the existing `tool_call` guidance hook). Filters on `toolName === "todo"` and skips errors:

```typescript
	// ── Tool Execution End — refresh todo overlay on todo mutations ───────
	pi.on("tool_execution_end", async (event, _ctx) => {
		if (event.toolName !== "todo" || event.isError) return;
		// Reads getTodos() at render time; do NOT call reconstructTodoState
		// here (branch is stale — message_end runs after tool_execution_end).
		todoOverlay?.update();
	});
```

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm tsc --noEmit` (or project equivalent)
- [ ] Linting passes (if project has a lint command)
- [x] New file exists: `test -f extensions/rpiv-core/todo-overlay.ts`
- [x] `renderResult` key removed from todo tool: `grep -n "renderResult" extensions/rpiv-core/todo.ts` returns 0 matches
- [x] `Theme` import removed from `todo.ts`: `grep -n "import type.*Theme" extensions/rpiv-core/todo.ts` returns 0 matches
- [x] `statusGlyph` helper removed from `todo.ts`: `grep -n "function statusGlyph" extensions/rpiv-core/todo.ts` returns 0 matches
- [x] `TodoOverlay` is imported in `index.ts`: `grep -n "TodoOverlay" extensions/rpiv-core/index.ts` returns 2+ matches (import + usage)
- [x] `tool_execution_end` handler exists in `index.ts`: `grep -n "tool_execution_end" extensions/rpiv-core/index.ts` returns a match
- [x] No stray `reconstructTodoState` call inside the `tool_execution_end` handler body (branch is stale there): verify manually after the automated check

#### Manual Verification:
- [ ] Start an interactive session; invoke `todo create subject="write tests"`. Observe `● Todos (0/1)` heading row above the editor with one child line `└─ ○ #1 write tests`.
- [ ] Transition `#1` to `in_progress` with `activeForm="writing tests"`. Overlay updates live to `◐ #1 write tests (writing tests)` without layout reshuffling.
- [ ] Complete `#1`. Heading switches to `○ Todos (1/1)`; child shows `✓ #1 write tests` in dim styling.
- [ ] Invoke `todo clear`. Overlay unregisters; the blank row above the editor collapses.
- [ ] Create 15 todos with mixed statuses and confirm the overlay renders at most 12 lines including heading; overflow shows `+N more (X in progress, Y pending, Z completed)` on the tail with `└─` connector.
- [ ] In an interactive session with both `"agents"` widget (if `@tintinweb/pi-subagents` installed) and `"rpiv-todos"` registered, trigger repeated todo updates and confirm the two widgets stay in their original Map order (no reshuffling on update).
- [ ] Tool row reduces to ≤1 line after drop: after todo create call completes in chat, confirm the inline row shows only `renderCall` output (`todo create "write tests"`) + the `Created #1: write tests (pending)` fallback stub, not the expanded status card.
- [ ] Stress test: rapid sequential `create → update → update` calls. Each mutation visible in the overlay; no stale state.
- [ ] Compaction trims overlay: in a session with tasks, trigger `/compact`. After compaction, overlay reflects only tasks whose toolResults survived in the compacted branch.
- [ ] Dispose on shutdown: simulate `session_shutdown` (e.g., `/reload`). Confirm no orphan widget remains, and a fresh session reconstructs the overlay cleanly.
- [ ] `/todos` slash command still works — produces grouped dump via `ctx.ui.notify`.
- [ ] Replay safety: load a session recorded before the upgrade (with `renderResult` output in history). Reconstruction walks `msg.details` and restores todo state correctly.

---

## Testing Strategy

### Automated:
- `pnpm tsc --noEmit` (or project equivalent) clean after the phase.
- Lint clean if a lint command is configured.
- Grep-based checks from the automated verification list above to ensure removals actually happened.

### Manual Testing Steps:
1. Build and launch an interactive rpiv-core session.
2. Create a single todo. Observe overlay registers above editor with heading + one child.
3. Update status to `in_progress` with `activeForm`. Observe live update in place (no reshuffle).
4. Complete the task. Observe completion glyph + dim styling; heading count updates.
5. Clear todos. Observe overlay unregisters and the row collapses.
6. Create 15 todos across all statuses. Observe 12-line cap with `+N more` overflow summary.
7. Register another extension widget (e.g., `agents` from `@tintinweb/pi-subagents`). Trigger repeated todo mutations. Confirm neither widget's Map position changes.
8. Inspect chat history for a todo create call. Confirm one-line fallback stub, not expanded card.
9. Trigger `/compact`. Confirm overlay reflects surviving tasks only.
10. Trigger `/reload`. Confirm overlay disposes cleanly and re-registers under the fresh UI context.
11. Run `/todos` slash command. Confirm grouped dump still prints via `ctx.ui.notify`.

## Performance Considerations

- **Refresh cost**: `tui.requestRender()` is O(1) scheduling; actual render is bounded by the 12-line cap and runs on the next tick. No layout reflow.
- **No timer**: omitted entirely — zero idle CPU from this overlay.
- **Render closure**: reads `getTodos()` once per frame. `getTodos()` returns the module-level array reference (no copy). Filtering by status happens per-frame but is O(N) where N is capped by the 12-line budget anyway.
- **Factory-form registration**: `setExtensionWidget` factory branch at `interactive-mode.js:1138-1141` runs the factory ONCE at registration, not per render. Subsequent frames call the stored component's `render(width)`.
- **No memory growth**: module state in `todo.ts` is the only retained state; overlay holds only references (`uiCtx`, `tui`). No cache, no history, no aging map.

## Migration Notes

- **Backwards compatibility**: `reconstructTodoState` at `todo.ts:496-508` remains the persistence primitive. Sessions with pre-upgrade `renderResult` output in their history will replay correctly because reconstruction uses `msg.details`, not the rendered component. No data migration needed.
- **Permissions**: no changes. The `todo` tool name stays constant, so `templates/pi-permissions.jsonc:26` remains authoritative.
- **Rollback strategy**: revert all three files in one commit. No schema or state changes.

## References

- Design: `thoughts/shared/designs/2026-04-11_07-19-35_todo-list-overlay-above-input.md`
- Research: `thoughts/shared/research/2026-04-11_07-05-28_todo-list-overlay-above-input.md`
- Prior rejection (overturned): `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md`
- Prior design (inline `renderResult`): `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md`
- Prior plan: `thoughts/shared/plans/2026-04-11_07-30-37_todo-tool-cc-parity.md`
- Pattern template: `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js`
- Extension types: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
