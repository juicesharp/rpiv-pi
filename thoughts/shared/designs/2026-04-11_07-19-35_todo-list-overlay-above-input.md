---
date: 2026-04-11T07:19:35-0400
designer: Claude Code
git_commit: d484cb3
branch: master
repository: rpiv-pi
topic: "Todo list overlay above user input"
tags: [design, todo-overlay, tui, interactive-mode, pi-tui, widget, extension-ui, rpiv-core]
status: complete
research_source: "thoughts/shared/research/2026-04-11_07-05-28_todo-list-overlay-above-input.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Design: Todo List Overlay Above User Input

## Summary

A `TodoOverlay` controller — a direct shape-match of `@tintinweb/pi-subagents`'s `AgentWidget` — registers a factory-form widget in `widgetContainerAbove` via `ctx.ui.setWidget("rpiv-todos", factory, { placement: "aboveEditor" })`. The overlay displays live todo state above the editor, auto-hides when empty, caps at 12 rendered lines with priority-based collapse (`in_progress → pending → completed`, rest summarized as `+N more`). The rich inline `renderResult` is dropped from the tool definition in favor of a one-line audit stub from `createResultFallback`.

## Requirements

- Render todos as a persistent overlay above the editor while the list is non-empty.
- Mirror `AgentWidget`'s visual/lifecycle language so users see a familiar pattern.
- Respect a hard cap (12 lines) with graceful overflow summary instead of scrolling.
- Refresh on todo mutations without re-instantiating the widget (avoid layout thrashing, avoid reshuffling `extensionWidgetsAbove` Map order).
- Replace (not duplicate) the rich inline chat `renderResult` — the overlay is the canonical live view.
- Survive `session_start`, `session_compact`, `session_tree`, and `session_shutdown` cleanly. Handle `ctx.ui` rebinds.

## Current State Analysis

No widget infrastructure in `extensions/rpiv-core/`. The todo tool currently renders rich inline state via `renderResult` at `extensions/rpiv-core/todo.ts:643-829`, which takes ≥4 lines per tool invocation (`Spacer(1)` at `tool-execution.js:39` + `Box.paddingY=1` at `tool-execution.js:42`). Module-level state (`let tasks`, `let nextId`) at `todo.ts:60-61` is mutated synchronously inside the `execute` callback at `todo.ts:607-619`.

`reconstructTodoState` at `todo.ts:496-508` walks `ctx.sessionManager.getBranch()` and restores state from persisted `msg.details`. It is the right primitive for `session_start` and `session_tree` hooks (branch is authoritative), but unsafe for `tool_execution_end` hooks (branch is stale — `message_end` persistence runs AFTER `tool_execution_end`).

### Key Discoveries

- `interactive-mode.js:1138-1141` — factory branch of `setExtensionWidget` stores the factory's return value once; render closure reads live state on every frame. No line cap applies to this branch.
- `interactive-mode.js:1183` — `MAX_WIDGET_LINES = 10` is scoped to the **string-array** branch at lines 1127-1136, NOT the factory branch.
- `interactive-mode.js:1114-1121` — `setExtensionWidget` always removes-then-inserts, so re-registering moves a widget to the bottom of `extensionWidgetsAbove: Map`. Call `setWidget` once, then use `tui.requestRender()`.
- `agent-session.js:293-303` — `message_end` is where toolResult appends to the branch. `tool_execution_end` at `agent-session.js:438-447` fires **before** this. Reading `getTodos()` (module state) is safe; reading the branch is not.
- `runner.js:203-205` — `ctx.hasUI === true` is a hard guarantee that `ctx.ui` is the real bound object.
- `agent-widget.js:112-121` — `setUICtx` uses identity-compare to invalidate cached `widgetRegistered`/`tui` on rebind. Must call on every `session_start`.
- `agent-widget.js:341-345` — auto-hide via `setWidget(key, undefined)` when state is empty.
- `agent-widget.js:380-396` — register-once + `requestRender()` pattern.
- `agent-widget.js:135-138` — AgentWidget uses `setInterval(80ms)` for spinner frame advance. **Not needed for todos** (no animation, no live duration counter).
- `tool-execution.js:61-69, 95-101` — `getResultRenderer()` returning undefined triggers `createResultFallback()` which uses `result.content[0].text` as a one-line stub.

## Scope

### Building

- New file `extensions/rpiv-core/todo-overlay.ts` — `TodoOverlay` class.
- Modification to `extensions/rpiv-core/todo.ts` — drop `renderResult` key from `registerTodoTool`. Keep `renderCall`, `execute`, reducer, types, `/todos` command.
- Modification to `extensions/rpiv-core/index.ts` — module-scope `todoOverlay`, lifecycle wiring in `session_start`, `session_compact`, `session_shutdown`, `session_tree`, new `tool_execution_end` handler.

### Not Building

- **Scrolling**: no `scrollOffset` state, no `handleInput`, no global input listener. Explicitly rejected — focus stays on editor, overflow collapses to `+N more` summary (mirrors `AgentWidget`).
- **Non-capturing overlay pattern** (`ctx.ui.custom` + `overlayOptions.nonCapturing`): not needed for read-only display.
- **Timer-driven refresh**: `setInterval` omitted entirely. Refresh is purely event-driven (`tool_execution_end` + session hooks). AgentWidget's 80ms timer exists only for spinner animation; todos have none.
- **Status bar integration**: no `setStatus("rpiv-todos", ...)`. AgentWidget does this for concurrent agent counts; not meaningful for todos.
- **Completed-task aging**: AgentWidget's `finishedTurnAge` (linger-then-expire) does NOT apply. Todos are persistent planning state; completed tasks remain visible until explicitly deleted or cleared.
- **Widget ordering enforcement** vs. `"agents"` widget: accept registration-race order. No attempt to force a slot.
- **Scroll-safe full-list view inside the overlay**: use the existing `/todos` slash command for the explicit grouped dump.
- **Changes to `renderCall`, `execute`, reducer, types, `/todos` slash command, `reconstructTodoState`, or permissions**.

## Decisions

### 1. Overflow model: priority-collapse, not scroll

**Ambiguity**: AgentWidget uses 12-line cap with prioritized collapse; ConversationViewer uses scroll (but is a capturing modal). Which applies?

**Explored**:
- **A. Collapse (AgentWidget-style)** at `agent-widget.js:276-315` — priority-ordered fit (`running > queued > finished`) with `+N more` summary. Read-only, no input. Implementation ~50 LOC.
- **B. Scroll (ConversationViewer-style)** at `conversation-viewer.js:38-71, 147-149` — scrollable viewport with `up/down/k/j/pageUp/pageDown` handling. Requires global input listener (`tui.js:262-267`) because editor owns focus via `interactive-mode.js:362`. Collides with `editor.js:646-654` `pageUp/pageDown` binding for chat scroll.

**Decision**: A. Collapse with priority order `in_progress → pending → completed`. Eliminates focus-vs-scroll complexity. Matches visual language users know from agents widget. Developer-confirmed.

### 2. Event hook: `tool_execution_end`, filter on `"todo"` tool name

**Simple decision**: Subscribe via `pi.on("tool_execution_end", (event, ctx) => { ... })`. Filter on `event.toolName === "todo" && !event.isError`. Read module-level `getTodos()` directly — do NOT call `reconstructTodoState(ctx)` here (branch is stale).

**Evidence**: `agent-session.js:438-447` fires the event before `message_end` persists the toolResult. Reducer at `todo.ts:607-619` writes module state synchronously before returning, so `getTodos()` already reflects post-mutation state.

### 3. Register-once + `requestRender()` refresh

**Simple decision**: Mirror `agent-widget.js:378-396`. First `update()` call with live state calls `setWidget(key, factory, options)` and captures `tui` inside the factory into `this.tui`. Subsequent `update()` calls invoke `this.tui?.requestRender()` and return.

**Why not re-call `setWidget`**: `interactive-mode.js:1114-1121` always removes-then-inserts, which (a) disposes the existing component, (b) re-instantiates via factory, (c) moves the entry to the bottom of `extensionWidgetsAbove`. O(N) layout churn per mutation and widget reshuffling.

### 4. Auto-hide on empty state

**Simple decision**: When `getTodos()` returns no non-deleted tasks, call `this.uiCtx.setWidget("rpiv-todos", undefined)`, clear cached `widgetRegistered` and `tui`. Mirrors `agent-widget.js:341-345`.

**Trade-off accepted**: after `/clear` or last task deletion, re-registration on next mutation reshuffles position in the `extensionWidgetsAbove` Map.

### 5. Data source: module-level `getTodos()`

**Simple decision**: Overlay reads `getTodos()` from `todo.ts:63-65` directly at render time. No parameter passing, no closure capture of task arrays. Single source of truth.

### 6. No timer

**Simple decision**: Omit `setInterval` entirely. AgentWidget's 80ms timer at `agent-widget.js:135-138` only exists for spinner frame animation and live duration counters. Todos have neither. All refreshes are event-driven.

### 7. Drop `renderResult` from tool definition

**Ambiguity**: With the overlay showing live state, the rich `renderResult` is redundant but occupies ≥4 rows per invocation.

**Explored**:
- **A. Drop `renderResult`** — `tool-execution.js:61-69` returns undefined → `tool-execution.js:95-101` `createResultFallback()` uses `result.content[0].text`. Produces one-line stub from reducer `content` (e.g., `"Created #5: write tests (pending)"` from `todo.ts:226-231`).
- **B. Keep `renderResult`** but return `Text("", 0, 0)` — `text.js:43-49` short-circuits empty strings but the immovable `Spacer(1)` + `Box.paddingY=1` still costs ~3 rows per invocation.

**Decision**: A. Drop entirely. `renderCall` at `todo.ts:621-641` survives as the 1-line audit marker. Developer-confirmed.

**Replay safety**: `reconstructTodoState` at `todo.ts:496-508` depends only on `msg.details`, not on the rendered component. No other code reads `toolName === "todo"` toolResults. Safe.

### 8. Widget ordering vs. `"agents"` widget

**Ambiguity**: `extensionWidgetsAbove: Map` orders widgets by insertion order. Hide/show reshuffles. How to claim a consistent slot?

**Decision**: Accept registration-race order. No enforcement logic. Document the behavior: after either widget hides and re-registers, its position moves to the bottom of the Map. Developer-confirmed.

### 9. Session-compact policy: eager reconstruct + update

**Ambiguity**: `session_compact` at `agent-session.js:1287-1306` does not re-bind extensions, so `uiCtx` identity is preserved. But the persisted branch has been replaced. Should the overlay reconstruct todo state immediately, or wait until next `/reload`?

**Decision**: Eager. In `session_compact` handler, call `reconstructTodoState(ctx); todoOverlay?.update();`. The overlay immediately reflects tasks that survived compaction; tasks below the cutoff vanish immediately rather than silently on next reload. Developer-confirmed.

### 10. `hasUI` gating in all hooks

**Simple decision**: Every lifecycle hook that touches `todoOverlay` gates on `ctx.hasUI`. In print-mode or RPC-mode, `runner.js:56-83` returns `noOpUIContext` and `ctx.hasUI === false`. `TodoOverlay` construction is deferred to `session_start` under this gate; module-scope `todoOverlay` starts as `undefined`.

### 11. File naming and module boundary

**Simple decision**: New file `extensions/rpiv-core/todo-overlay.ts`, sibling to `todo.ts`. Matches the module boundary established by commit `8610ae5` ("Refactor rpiv-core extension into focused modules"). Keeps `todo.ts` focused on tool/reducer/replay.

## Architecture

### extensions/rpiv-core/todo-overlay.ts — NEW

TodoOverlay controller class. Mirrors `agent-widget.js:91-410` structure with todo-specific rendering and simplified lifecycle (no timer, no status bar, no aging).

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

### extensions/rpiv-core/todo.ts — MODIFY

Three focused removals: (1) unused `Theme` import, (2) `statusGlyph` helper at `todo.ts:514-525` (dead after renderResult removal), (3) the entire `renderResult` key from `registerTodoTool` at `todo.ts:643-829`. `renderCall`, `execute`, reducer, types, `/todos` slash command, and `reconstructTodoState` are unchanged.

**(1) Import line — remove unused `Theme`**

`todo.ts:13` — before:
```typescript
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
```

After:
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
```

**(2) Rendering helpers section — remove `statusGlyph`**

`todo.ts:510-529` — replace the entire "Rendering helpers" subsection with just `formatStatus`:

```typescript
// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function formatStatus(status: TaskStatus): string {
	return status === "in_progress" ? "in progress" : status;
}
```

**(3) Tool definition — drop the entire `renderResult` key**

`todo.ts:621-829` — `registerTodoTool`'s tool config after the change. `renderCall` becomes the last key; no `renderResult`:

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

**Effect on chat history**: `tool-execution.js:61-69` `getResultRenderer()` returns undefined for the `todo` tool, triggering `createResultFallback()` at `tool-execution.js:95-101` which reads `result.content[0].text` from the reducer's `content` field (set at `todo.ts:226-231`, `361`, `464-466`, etc.). Chat row shows a single-line stub like `"Created #5: write tests (pending)"`.


### extensions/rpiv-core/index.ts — MODIFY

Add `TodoOverlay` import, declare a closure-scoped `todoOverlay` instance, wire into lifecycle hooks, add a `tool_execution_end` handler. Renames the previously-unused `_ctx` parameter in `session_compact` since it's now used by `reconstructTodoState(ctx)`.

**(1) Import — add TodoOverlay**

`index.ts:24` — add the sibling import:

```typescript
import { registerTodoTool, registerTodosCommand, reconstructTodoState } from "./todo.js";
import { TodoOverlay } from "./todo-overlay.js";
```

**(2) Extension setup — declare closure-scoped instance**

`index.ts:26-30` — the top of the default export function. `todoOverlay` is closure-captured by all hook callbacks; single instance per Pi process.

```typescript
export default function (pi: ExtensionAPI) {
	// Todo overlay widget — constructed lazily at the first session_start with UI.
	let todoOverlay: TodoOverlay | undefined;

	// ── Register Tools & Commands ──────────────────────────────────────────
	registerAskUserQuestionTool(pi);
	registerTodoTool(pi);
	registerTodosCommand(pi);
```

**(3) session_start — construct + bind + first update**

`index.ts:33-85` — insert the overlay wiring AFTER `reconstructTodoState(ctx)` so the first `update()` sees the correct module state. Gated on `ctx.hasUI` per `runner.js:203-205` guarantee.

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

**(4) session_compact — eager reconstruct + update**

`index.ts:88-90` — rename `_ctx` → `ctx`, add reconstruct call and overlay refresh:

```typescript
	// ── Session Compact ────────────────────────────────────────────────────
	pi.on("session_compact", async (_event, ctx) => {
		clearInjectionState();
		reconstructTodoState(ctx);
		todoOverlay?.update();
	});
```

**(5) session_shutdown — dispose and null the reference**

`index.ts:93-95` — dispose so a subsequent `session_start` in the same process constructs a fresh instance:

```typescript
	// ── Session Shutdown ───────────────────────────────────────────────────
	pi.on("session_shutdown", async (_event, _ctx) => {
		clearInjectionState();
		todoOverlay?.dispose();
		todoOverlay = undefined;
	});
```

**(6) session_tree — refresh after reconstruct**

`index.ts:98-100` — already calls `reconstructTodoState`; add overlay refresh:

```typescript
	// ── Session Tree (reconstruct todo state) ─────────────────────────────
	pi.on("session_tree", async (_event, ctx) => {
		reconstructTodoState(ctx);
		todoOverlay?.update();
	});
```

**(7) tool_execution_end — new handler for todo mutations**

Insert after the `session_tree` handler (before the existing `tool_call` guidance hook). Filters on `toolName === "todo"` and skips errors (reducer leaves state unchanged on error per `errorResult` at `todo.ts:153-169`).

```typescript
	// ── Tool Execution End — refresh todo overlay on todo mutations ───────
	pi.on("tool_execution_end", async (event, _ctx) => {
		if (event.toolName !== "todo" || event.isError) return;
		// Reads getTodos() at render time; do NOT call reconstructTodoState
		// here (branch is stale — message_end runs after tool_execution_end).
		todoOverlay?.update();
	});
```


## Desired End State

```typescript
// User adds a task via tool call → overlay auto-registers above editor
await agentInvocation("todo", { action: "create", subject: "write tests" });
// Rendered above editor:
//   ● Todos (0/1)
//   └─ ○ #1 write tests

// Status transition → overlay updates live via requestRender()
await agentInvocation("todo", { action: "update", id: 1, status: "in_progress", activeForm: "writing tests" });
//   ● Todos (0/1)
//   └─ ◐ #1 write tests (writing tests)

// Completion → still visible, shown as done
await agentInvocation("todo", { action: "update", id: 1, status: "completed" });
//   ○ Todos (1/1)
//   └─ ✓ #1 write tests

// All cleared → overlay unregisters, blank row collapses
await agentInvocation("todo", { action: "clear" });
// Overlay gone.
```

## File Map

```
extensions/rpiv-core/todo-overlay.ts  # NEW — TodoOverlay controller
extensions/rpiv-core/todo.ts          # MODIFY — drop renderResult from registerTodoTool
extensions/rpiv-core/index.ts         # MODIFY — wire todoOverlay into session + tool hooks
```

## Ordering Constraints

- **Slice 1** (`todo-overlay.ts`) must exist before **Slice 3** (`index.ts` imports it).
- **Slice 2** (`todo.ts` drop `renderResult`) is independent of the other slices — can run in parallel, but sequenced after Slice 1 for commit-history clarity.
- No runtime ordering constraints between slices once all three are applied: the overlay, tool, and hooks all come up together at `session_start`.

## Verification Notes

- **No TypeScript errors**: `pnpm tsc --noEmit` (or project equivalent) clean after all three slices applied.
- **Widget appears above editor when todo added**: start interactive session, invoke `todo create ...`, observe `● Todos` heading row above editor with one child line.
- **Widget updates without reshuffling**: in an interactive session with both `"agents"` and `"rpiv-todos"` registered, trigger repeated todo updates and confirm the two widgets stay in their original Map order. Use `grep -n 'setExtensionWidget\|extensionWidgetsAbove' interactive-mode.js` for instrumentation hooks if needed.
- **Widget auto-hides on empty**: invoke `todo clear`, confirm the heading row disappears and the blank spacer above the editor collapses.
- **Tool row reduces to ≤1 line after renderResult drop**: after Slice 2, confirm the inline chat row for a `todo create` call shows only `renderCall` + the `Created #N: …` fallback stub (not the expanded status card).
- **Overlay does not revert to stale state on `tool_execution_end`**: stress test with rapid sequential `create → update → update` calls and confirm each mutation is visible in the overlay. No `reconstructTodoState` call in the `tool_execution_end` path.
- **Compaction trims overlay**: in a session with tasks, trigger `/compact`. After compaction, overlay should reflect only tasks whose toolResults survived in the compacted branch.
- **Dispose on shutdown**: `pi.on("session_shutdown", ...)` calls `todoOverlay.dispose()`. Confirm no orphan widget remains if shutdown re-emits `session_start` (reload flow).
- **`/todos` slash command still works**: unchanged — produces grouped dump via `ctx.ui.notify`.

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

## Pattern References

- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:91-410` — primary template for class shape, lifecycle, and factory closure pattern. The only structural differences are: no `setInterval`, no `setStatus`, no aging map, no spinner.
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:195-317` — `renderWidget(tui, theme)` method. The priority-collapse loop at lines 276-315 is the pattern for todo overflow handling.
- `extensions/rpiv-core/todo.ts:710-769` — existing themed rendering for todo list (colors, glyphs, block indicators). Reusable palette for the overlay's row formatting.
- `extensions/rpiv-core/todo.ts:514-529` — `statusGlyph` + `formatStatus` helpers. Reusable; move to module-level or duplicate.

## Developer Context

- **Q (`agent-widget.js:276-315`, `agent-widget.js:11`): What overflow model should `TodoOverlay` use?**
  A: Collapse. Priority order `in_progress → pending → completed`. Mirrors AgentWidget's 12-line cap with `+N more` summary tail. Eliminates focus-vs-scroll complexity. (Resolved in Step 5.)

- **Q (`agent-session.js:1287-1306` no-rebind vs. post-compaction stale state): `session_compact` todo policy?**
  A: Eager reconstruct + update. Call `reconstructTodoState(ctx); todoOverlay?.update();` in the `session_compact` hook. Post-compaction overlay reflects only surviving tasks immediately. (Resolved in Step 5.)

- **Q (`interactive-mode.js:1114-1121` remove-then-insert Map order): Widget ordering vs. `"agents"` widget?**
  A: Accept registration-race order. No enforcement logic. Document the behavior in this design. (Resolved in Step 5.)

- **Q (`tool-execution.js:39-42` 4-line floor, inline `renderResult` overlap): Drop `renderResult`?**
  A: Drop. `createResultFallback` produces a one-line stub from `result.content[0].text`. `renderCall` at `todo.ts:621-641` stays as the audit marker. (Pre-resolved in research.)

- **Q (`agent-widget.js:135-138` 80ms spinner timer): Should `TodoOverlay` use a refresh timer?**
  A: No. Todos have no animation. All refreshes are event-driven. Keeps the class simpler and consumes zero idle CPU. (Resolved silently in Step 3.)

## Design History

- Slice 1: todo-overlay.ts (NEW) — approved as generated
- Slice 2: todo.ts (MODIFY, drop renderResult) — approved as generated
- Slice 3: index.ts (MODIFY, wire hooks) — approved as generated

## References

- Research: `thoughts/shared/research/2026-04-11_07-05-28_todo-list-overlay-above-input.md`
- Prior rejection (overturned): `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md`
- Prior design (inline `renderResult`): `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md`
- Prior plan: `thoughts/shared/plans/2026-04-11_07-30-37_todo-tool-cc-parity.md`
- Pattern template: `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js`
- Extension types: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
