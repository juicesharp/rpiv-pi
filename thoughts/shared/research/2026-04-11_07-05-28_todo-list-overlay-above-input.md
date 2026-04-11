---
date: 2026-04-11T07:05:28-0400
researcher: Claude Code
git_commit: d484cb3
branch: master
repository: rpiv-pi
topic: "Render the todo list as a persistent overlay above user input (analogous to the subagent overlay), with scroll support when the list exceeds the overlay's max height"
tags: [research, codebase, todo-overlay, tui, interactive-mode, pi-tui, pi-subagents, agent-widget, widget-container, extension-ui]
status: complete
questions_source: "thoughts/shared/questions/2026-04-11_10-40-21_todo-list-overlay-above-input.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Research: Todo List Overlay Above User Input

## Research Question
Render the todo list as a persistent overlay above user input (analogous to the subagent overlay), with scroll support when the list exceeds the overlay's max height. Revisits a prior rejection (`thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md`) that blocked overlay work on "pi-tui overlays hard-truncate at maxHeight"; this research covers the factory-form `setExtensionWidget` branch, which has no line cap, and whether any of the subagents patterns (`AgentWidget`, `ConversationViewer`) apply.

## Summary

A `TodoOverlay` controller — a direct shape-match of `@tintinweb/pi-subagents`'s `AgentWidget` — is the correct primitive. It registers as a factory-form child in `widgetContainerAbove` via `ctx.ui.setWidget("rpiv-todos", factory, { placement: "aboveEditor" })` (`interactive-mode.js:1112,1138-1143`), which bypasses the `MAX_WIDGET_LINES = 10` cap at line 1183 (that cap applies only to the `string[]` content branch at lines 1127-1136). The factory returns a `Component` whose `render(tui, theme, width)` closure reads live state at render time — mutations become visible via `this.tui?.requestRender()` without re-invoking `setWidget`.

Scrolling is **NOT** implemented. Developer decision: mirror `AgentWidget.renderWidget` at `agent-widget.js:195-317`, which caps at 12 lines and **collapses** overflow to a prioritized summary (`+N more` tail) rather than scrolling. This eliminates the focus-vs-scroll dilemma (editor permanently owns focus via `interactive-mode.js:362`; `TUI.handleInput` at `tui.js:315-365` only dispatches to `focusedComponent`), removes the need for a global `addInputListener`, and matches the visual language users already know from the agents widget.

The overlay subscribes to `pi.on("tool_execution_end", ...)` and reads module-level `getTodos()` directly — the tool's `execute` callback at `extensions/rpiv-core/todo.ts:607-619` has already written `tasks`/`nextId` synchronously by the time the event fires. It must **not** call `reconstructTodoState(ctx)` from this hook: `tool_execution_end` fires before `sessionManager.appendMessage(toolResult)` runs at `agent-session.js:293-303`, so the branch does not yet contain the new entry and reconstruction would revert the mutation. `reconstructTodoState` remains the right call in `session_start` and `session_tree` hooks where the branch is authoritative.

The inline `renderResult` at `todo.ts:643-829` is being **dropped** from the tool definition (developer decision). `tool-execution.js:61-69`'s `getResultRenderer()` returns undefined, which triggers `createResultFallback()` at `tool-execution.js:95-101` that uses `result.content[0].text` — giving a one-line stub like "Created #5: write tests (pending)". `renderCall` at `todo.ts:621-641` survives as the minimal audit trace. Note the unavoidable ~4-line floor per tool invocation: `tool-execution.js:39` inserts `Spacer(1)` and `contentBox = Box(1, 1, ...)` at line 42 has `paddingY = 1`, so even zero-text renderers still consume that vertical budget.

The overlay auto-hides when todos are empty (developer decision). On empty state, `this.uiCtx.setWidget("rpiv-todos", undefined)` unregisters the widget (matching `agent-widget.js:341-345`); the next non-empty `refresh()` re-registers. Because `setExtensionWidget` at `interactive-mode.js:1114-1121` always removes-then-inserts, re-registration moves the widget to the bottom of the `extensionWidgetsAbove` Map — so if `"agents"` is already registered, the todo widget will appear below the agents widget after a hide/show cycle.

## Detailed Findings

### Widget Mount Mechanism

The canonical `setWidget` entry point for extensions is `ExtensionUIContext.setWidget(key, content, options)`, wired in `createExtensionUIContext()` at `interactive-mode.js:1311` to `(key, content, options) => this.setExtensionWidget(key, content, options)`.

`InteractiveMode.setExtensionWidget(key, content, options)` at `interactive-mode.js:1112-1144` has three branches:

- **Remove** (line 1114-1121): always removes any existing entry for `key` from both `extensionWidgetsAbove` and `extensionWidgetsBelow`, calling `existing.dispose?.()` if the component has a `dispose()` method.
- **Clear signal** (line 1122-1125): `content === undefined` is the unregister path; re-renders and returns.
- **String-array branch** (line 1127-1136): wraps lines in a `Container` of `Text`, slices to `InteractiveMode.MAX_WIDGET_LINES = 10` (declared at line 1183), appends `"... (widget truncated)"`.
- **Factory branch** (line 1138-1141): calls `content(this.ui, theme)` **once** at registration time, storing the returned `Component` directly. **No line cap** applies; the component is trusted to self-limit.

The factory is the **only** path that supports a stateful overlay — the returned component's `render(width)` is called on every frame, so the closure over `this` can read live state each time.

The `ExtensionWidgetOptions` type at `core/extensions/types.d.ts:41-45` supports only `{ placement?: "aboveEditor" | "belowEditor" }`. There is no third anchor option, no z-order, no "floating" semantics. The overlay is implemented compositionally by being a child of `widgetContainerAbove`.

### Canonical Widget Lifecycle (AgentWidget reference)

`AgentWidget` at `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js` is the reference implementation the `TodoOverlay` should mirror:

- **`setUICtx(ctx)` at lines 112-121**: stash the `ExtensionUIContext` reference, and reset cached `widgetRegistered`/`tui` state when the identity differs from the previous call. This lets the handler call `setUICtx(ctx.ui)` unconditionally on every `session_start` — it is idempotent when the ctx is unchanged and correctly invalidates state on rebind.
- **`update()` at lines 319-396**: idempotent update cycle. If state is empty, unregister via `setWidget("agents", undefined)` (line 341-345). Otherwise, guard on `widgetRegistered` (line 379); first call goes to `setWidget(key, factory, { placement: "aboveEditor" })` (line 380-390); subsequent calls just do `this.tui?.requestRender()` (line 395).
- **Factory closure** at lines 380-390: captures `tui` into `this.tui` inside the factory (line 381), returns `{ render: () => this.renderWidget(tui, theme), invalidate: () => { this.widgetRegistered = false; this.tui = undefined; } }`. The `invalidate()` hook is called by the host on theme changes or widget eviction, forcing the next `update()` to re-register with a fresh factory invocation and a new theme.
- **`dispose()` at lines 398-410**: calls `setWidget("agents", undefined)`, clears any `setStatus(key, undefined)`, nulls cached state.

### Render Tree Order

The root TUI stack is assembled in `interactive-mode.js:327-373`:

- Line 327: `headerContainer`
- Line 366: `chatContainer`
- Line 367: `pendingMessagesContainer`
- Line 368: `statusContainer` (hosts `loadingAnimation`, added at line 1913)
- Line 370: `widgetContainerAbove` (extension widgets above editor)
- Line 371: `editorContainer`
- Line 372: `widgetContainerBelow`
- Line 373: `footer`

`Container.render(width)` at `pi-tui/dist/tui.js:61-67` concatenates children in child-array order. So during streaming, the vertical layout is: header → chat → pending → **spinner** → `widgetContainerAbove` → editor → below widgets → footer. The todo overlay sits BELOW the spinner and ABOVE the editor — matches the "pinned above input" mental model, though strictly it is in-tree stacking, not z-ordered floating.

`renderWidgetContainer(container, widgets, spacerWhenEmpty, leadingSpacer)` at `interactive-mode.js:1194-1208` is called with `(widgetContainerAbove, extensionWidgetsAbove, true, true)` from `renderWidgets()` at line 1190. It always emits exactly one leading `Spacer(1)` — both when the map is empty (line 1196-1200) and when non-empty (line 1202-1203). That single blank row is adjacent to the overlay, not inside it — so `TodoOverlay.render(width)` does not subtract from its own viewport for the spacer. There is no inter-widget spacer; multiple registered widgets render back-to-back.

Widget ordering within `widgetContainerAbove` is Map insertion order (`for (const component of widgets.values())` at line 1205). Because `setExtensionWidget` at line 1114-1121 always removes-then-inserts, re-registering a widget moves it to the bottom of the Map. So the `"rpiv-todos"` and `"agents"` widgets will appear in whichever order they first registered, and a hide/show cycle on either one reshuffles the order.

### MAX_WIDGET_LINES Cap Applicability

The `InteractiveMode.MAX_WIDGET_LINES = 10` static at `interactive-mode.js:1183` is branch-local to the string-array form at lines 1127-1136 and does NOT apply to factory components. Confirmed:

- `TUI.doRender()` at `tui.js:697-724` emits every line with no upper bound.
- `compositeLineAt` at `tui.js:632-644` enforces a *horizontal* width-truncation safeguard (column-wise) via `visibleWidth(line) > width` — not a row cap.
- `previousViewportTop` math at `tui.js:678-679, 719, 786, 834, 962` is pure cursor-positioning bookkeeping for differential rendering, not clipping.
- The only vertical-space drop path is `extraLines > 0` at line 815-819, which clears trailing rows when frame content shrinks — it doesn't clip new content.

So a factory-form `TodoOverlay` can legitimately render any number of lines; the terminal's native scrollback handles what goes above the viewport. For a pinned widget that is a bad fit (the editor would scroll off), so the widget must self-cap — which is where `AgentWidget`'s `MAX_WIDGET_LINES = 12` at `agent-widget.js:11` is the reasonable default to mirror.

### Todo Mutation Event Pipeline

The mutation entry point is the tool's `execute` callback at `extensions/rpiv-core/todo.ts:607-619`:

1. Line 608: `applyTaskMutation({ tasks, nextId }, params.action, params)` — pure reducer, no side effects.
2. Lines 613-614: writes back into module-level `let tasks` and `let nextId` at `todo.ts:60-61`.
3. Lines 615-618: returns `{ content, details }` where `details: TaskDetails` is the full post-mutation snapshot.

After `execute()` returns, `getTodos()` at `todo.ts:63-65` already yields the new state **synchronously**. Any subsequent reader in the same event loop tick sees the updated list.

Upstream event ordering in `agent-session.js:265-338`:

1. `tool_execution_start` → `_emitExtensionEvent` (line 289) → `_emit` (line 291). No persistence.
2. Tool executes; fires `tool_execution_update` events (optional).
3. `tool_execution_end` → `_emitExtensionEvent` at line 438-447. Contains `{ toolCallId, toolName, result, isError }` where `result = { content, details }`. **Still no persistence.**
4. `afterToolCall` hook → `tool_result` extension event.
5. Agent constructs toolResult `AgentMessage`, fires `message_start` (no persistence — line 299-303 gates persistence on `message_end`).
6. `message_end` → `sessionManager.appendMessage(event.message)` at line 303. **Only now** is the toolResult in the branch.

**Critical implication**: the overlay's `tool_execution_end` handler runs between steps 3 and 6. Module state (`tasks`) is live and correct; `ctx.sessionManager.getBranch()` is stale (does not yet contain the new toolResult). Calling `reconstructTodoState(ctx)` here would walk the pre-mutation branch and OVERWRITE module state back to its pre-mutation value. Read `getTodos()` (or `event.result.details.tasks`) directly.

The existing `reconstructTodoState` calls at `extensions/rpiv-core/index.ts:35` (`session_start`) and `index.ts:99` (`session_tree`) are correct for their hooks because the branch is fully populated at those lifecycle points; they do not race with the overlay refresh because they fire in different events.

### Request Render vs. Re-Registering setWidget

`AgentWidget` at `agent-widget.js:378-396` uses two patterns:

- **First-time registration** (`!this.widgetRegistered`): call `setWidget(key, factory, options)`. The factory captures `tui` into `this.tui` and returns a component whose `render` is a closure over `this.renderWidget(tui, theme)`.
- **Already-registered update**: `this.tui?.requestRender()` at line 395. This triggers `TUI.doRender()` → `Container.render(width)` → overlay's render closure → closure reads live state via `this.manager.listAgents()`.

The render closure reads *live* state on every invocation, so updates are automatic. **Do not call `setWidget` on every mutation** — it would tear down the existing component (`existing?.dispose?.()` at line 1117), re-instantiate via the factory, and reshuffle Map order. `requestRender()` is O(1) and preserves all state.

### UICtx Acquisition and Lifecycle

`createExtensionUIContext()` at `interactive-mode.js:1288-1352` builds the live `ExtensionUIContext` object that gets bound to `session._extensionUIContext`. `session.bindExtensions({ uiContext, ... })` at `agent-session.js:1596-1614` stores it and calls `runner.setUIContext(...)` at line 1656.

`runner.js:56-83` declares a `noOpUIContext` singleton; `runner.js:203-205` makes `hasUI()` a simple identity comparison against this singleton. So `ctx.hasUI === true` *guarantees* `ctx.ui` is the real bound object. In print-mode and some non-interactive paths, `ctx.ui` falls back to `noOpUIContext` — all methods are silent no-ops.

**Ordering guarantee**: `bindExtensions` at `agent-session.js:1610-1611` installs the UI context **before** emitting `session_start`, so `session_start` is the earliest safe point for the overlay to capture `ctx.ui`.

**Rebind**: `/reload` and session switching trigger a fresh `bindExtensions` cycle which re-emits `session_start` (via `agent-session.js:1896`). The `ctx.ui` reference identity MAY change across rebinds, so `setUICtx(ctx.ui)` must be called on every `session_start` invocation. `AgentWidget.setUICtx` at `agent-widget.js:112-121` does an identity-compare and resets cached state only on change; the `TodoOverlay` should mirror this exactly.

**Compaction**: `agent-session.js:1287-1306` emits `session_compact` WITHOUT re-binding extensions. The `ExtensionRunner.uiContext` identity is untouched. So the cached `todoOverlay.uiCtx` remains valid across compaction — no need to re-call `setUICtx` on compact.

**Shutdown**: `clearExtensionWidgets` at `interactive-mode.js:1146-1156` is called from `resetExtensionUI` at line 1171 but **NOT** from `session_shutdown`. The todo extension must explicitly call `todoOverlay.dispose()` in its shutdown handler to release the widget cleanly. (The process is exiting anyway, but clean disposal lets timers/listeners drain the node event loop.)

### Focus-vs-Input Dilemma (Resolved by Collapse Decision)

This section is preserved for context, though the developer decision to mirror `AgentWidget`'s collapse model (no scroll, no input handling) removes the need to implement any of it.

`widgetContainerAbove` children are never `focusedComponent`. The editor always is — `interactive-mode.js:362` sets `this.ui.setFocus(this.editor)` at startup, and eight other paths (1324, 1371, 1399, 1458, 1483, 2707, 3253, 3464) restore focus to it after dialogs close.

`TUI.handleInput(data)` at `tui.js:315-365`:

1. Line 316-331: runs global `inputListeners` Set first. Each can return `{consume: true}` (early return) or `{data: newString}` (mutate payload).
2. Lines 333-340: consume cell-size response bytes and handle debug shortcuts.
3. Lines 343-354: redirect to visible overlay if focused overlay became hidden.
4. Line 357: `this.focusedComponent.handleInput(data)`.

The two escape hatches for an in-tree widget to receive input were:

- **(a) Global input listener**: `TUI.addInputListener(listener)` at `tui.js:262-267` → `InteractiveMode.addExtensionTerminalInputListener(handler)` at `interactive-mode.js:1213-1220` → exposed via `ctx.ui.onTerminalInput(handler)` at line 1236 (signature at `core/extensions/types.d.ts:47-50`). Listeners run before focus dispatch, so they can consume keys the editor would otherwise see. Unsubscribe auto-invoked by `clearExtensionTerminalInputListeners` at `interactive-mode.js:1221-1226` from both `resetExtensionUI` (line 1110) and `stop` (line 3892).
- **(b) Non-capturing overlay**: `ctx.ui.custom(factory, { overlay: true, overlayOptions: { nonCapturing: true } })` → `showExtensionCustom` → `this.ui.showOverlay(component, options)` at `tui.js:140-211`. Line 150-152 skips `setFocus` when `nonCapturing: true`. `getTopmostVisibleOverlay()` at `tui.js:240-249` explicitly skips non-capturing overlays, so focus never lands on one.

Collision with editor keybindings: the editor binds `pageUp`/`pageDown` to `app.pageScroll` at `editor.js:646-654`, plus arrow keys, home, end for line navigation (`editor.js:642-644`). `CustomEditor.handleInput` at `custom-editor.js:24-68` runs `onExtensionShortcut` first (line 26), then app actions, then super. A global listener claiming `pageUp`/`pageDown` unconditionally would starve the editor's scroll.

Because the developer chose the collapse model, none of this needs implementation — the overlay is read-only.

### Scrollable Viewport Pattern (Not Adopted)

This section documents the `ConversationViewer` pattern for reference, though it is NOT being adopted.

`ConversationViewer` at `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/conversation-viewer.js`:

- **Fields** (lines 20-21): `scrollOffset = 0; autoScroll = true;`
- **Viewport height** at line 147-149: `Math.max(MIN_VIEWPORT, this.tui.terminal.rows - CHROME_LINES)` where `CHROME_LINES = 6` (line 11) and `MIN_VIEWPORT = 3` (line 12).
- **Render slicing** at lines 115-125: rebuilds `contentLines` every frame via `buildContentLines(innerW)`, clamps `scrollOffset` against `Math.max(0, contentLines.length - viewportHeight)`, slices to `visible = contentLines.slice(visibleStart, visibleStart + viewportHeight)`, pads with empty rows so the modal has stable height.
- **Input** at lines 38-71: `handleInput(data)` maps `up/k`, `down/j`, `pageUp`, `pageDown`, `home`, `end` to `scrollOffset` mutations with `autoScroll` toggling.
- **Invocation** at `pi-subagents/dist/index.js:1099-1108`: shown via `ctx.ui.custom(factory, { overlay: true, anchor: "center", width: "90%" })` — a **capturing modal**, which calls `setFocus(component)` at `tui.js:151`, diverting all input to the viewer until dismissed. Entirely different UX than a pinned widget.

The critical contrast: `OverlayOptions.maxHeight` at `tui.js:527-529` is `if (maxHeight !== undefined && overlayLines.length > maxHeight) { overlayLines = overlayLines.slice(0, maxHeight); }` — a one-shot hard truncation with no scroll state. Unusable for a long todo list.

### Inline renderResult Fate

`ToolExecutionComponent` construction path in `interactive-mode.js`:

- Line 1952-1957: during `message_update` streaming, creates component for each new `toolCall` content block and `chatContainer.addChild(component)`.
- Line 2012-2017: during `tool_execution_start`, fallback creation if not already created via streaming.
- Component is **never removed** — not on `tool_execution_end` (line 2031-2038 only calls `updateResult` and deletes from `pendingTools` map), not on `message_end`, not on `agent_end`.

Inside `ToolExecutionComponent` at `tool-execution.js`:

- Line 39: `this.addChild(new Spacer(1))` — one blank line at the top of every tool row.
- Line 42: `this.contentBox = new Box(1, 1, ...)` — `paddingY = 1`.
- Line 194-208 (`updateDisplay` → `updateResult`): invokes `getResultRenderer()` at lines 61-69, adds result Text to contentBox at line 207, sets `hasContent = true` unconditionally at line 186-208.
- Line 254-256: `hideComponent` escape only fires when `!hasContent`.

**Minimum row floor**: `Spacer(1)` + `Box.paddingY=1` top + 1 call renderer line + `Box.paddingY=1` bottom = **4 lines minimum** per tool invocation, even if `renderResult` returns `Text("", 0, 0)`. Zero-text renderers get short-circuited at `text.js:43-49` (`if (!this.text || this.text.trim() === "") return [];`) so they contribute no lines, but the immovable Spacer and Box padding still do.

**Developer decision**: drop `renderResult` from the tool definition entirely. `getResultRenderer()` at `tool-execution.js:61-69` returns `undefined` → `createResultFallback()` at `tool-execution.js:95-101` is called, reading `result.content[0].text` via `getTextOutput()` — producing a single-line stub like "Created #5: write tests (pending)" (the reducer's `content` text set at `todo.ts:226-231`, `361`, `464-466`, etc.). Keeps the audit trail minimal.

**Replay safety**: `reconstructTodoState` at `todo.ts:496-508` depends only on `msg.details` (the persisted `TaskDetails` snapshot), not on the rendered component. Confirmed via grep: no other consumer of `toolName === "todo"` toolResults exists anywhere in the repo. The `/todos` slash command at `todo.ts:837-895` reads module-level `tasks` directly. Safe to drop.

`renderCall` at `todo.ts:621-641` stays — it's the only per-invocation chronological marker showing `todo update #5 → in_progress` in chat history.

## Code References

- `extensions/rpiv-core/index.ts:26-30` — synchronous tool/command registration (add `TodoOverlay` construction later via session_start hook)
- `extensions/rpiv-core/index.ts:33-85` — `session_start` handler (add `if (ctx.hasUI) { overlay.setUICtx(ctx.ui); overlay.update(); }`)
- `extensions/rpiv-core/index.ts:88-90` — `session_compact` handler (add `reconstructTodoState(ctx); overlay?.update();`)
- `extensions/rpiv-core/index.ts:93-95` — `session_shutdown` handler (add `overlay?.dispose();`)
- `extensions/rpiv-core/index.ts:98-100` — `session_tree` handler (already calls `reconstructTodoState`; add `overlay?.update();`)
- `extensions/rpiv-core/todo.ts:60-61` — module-level `tasks` and `nextId` state (overlay reads via `getTodos()`)
- `extensions/rpiv-core/todo.ts:63-65` — `getTodos()` accessor (the overlay's data source)
- `extensions/rpiv-core/todo.ts:496-508` — `reconstructTodoState` (do NOT call from `tool_execution_end`)
- `extensions/rpiv-core/todo.ts:607-619` — tool `execute` callback (mutates module state synchronously before returning)
- `extensions/rpiv-core/todo.ts:621-641` — `renderCall` (keep)
- `extensions/rpiv-core/todo.ts:643-829` — `renderResult` (drop — remove key from tool definition)
- `extensions/rpiv-core/todo.ts:836-895` — `/todos` slash command (unchanged; reads module state directly)
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:11` — `MAX_WIDGET_LINES = 12` cap to mirror
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:91-121` — class skeleton + `setUICtx`
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:195-317` — `renderWidget(tui, theme)` overflow-collapse reference
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:276-315` — priority-ordered overflow-collapse logic
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:319-396` — `update()` lifecycle with auto-hide
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:341-345` — auto-hide on empty state (`setWidget(key, undefined)`)
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:378-396` — register-once-then-requestRender pattern
- `/usr/local/lib/node_modules/@tintinweb/pi-subagents/dist/ui/agent-widget.js:398-410` — `dispose()` teardown
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:327,366-373` — root TUI stack assembly order
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1112-1144` — `setExtensionWidget` three branches
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1127-1136` — string-array cap branch
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1138-1141` — factory branch (no cap)
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1146-1156` — `clearExtensionWidgets`
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1183` — `MAX_WIDGET_LINES = 10` static (string-array only)
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1187-1208` — `renderWidgets` / `renderWidgetContainer`
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1288-1352` — `createExtensionUIContext` (builds the live `ExtensionUIContext`)
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tool-execution.js:39-42` — `Spacer(1)` + `Box(1,1,...)` immovable row floor
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tool-execution.js:61-69` — `getResultRenderer`
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tool-execution.js:95-101` — `createResultFallback` fallback text path
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tool-execution.js:194-208` — `updateDisplay` result-render path
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:265-338` — `_processAgentEvent` (shows tool_execution_end vs message_end ordering)
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:293-303` — `message_end` is where toolResult appends to branch
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:438-447` — `tool_execution_end` extension dispatch
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:1287-1306` — `session_compact` emission (no rebind)
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:1596-1662` — `bindExtensions` / `_applyExtensionBindings`
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/runner.js:56-83` — `noOpUIContext` stub
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/runner.js:203-205` — `hasUI()` identity check
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:41-45` — `ExtensionWidgetOptions` / `WidgetPlacement`
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:74-76` — `setWidget` factory overload signature
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:461-467` — `tool_execution_end` event shape
- `/usr/local/lib/node_modules/pi-permission-system/node_modules/@mariozechner/pi-tui/dist/tui.js:41-67` — `Container.render(width)` concatenation
- `/usr/local/lib/node_modules/pi-permission-system/node_modules/@mariozechner/pi-tui/dist/tui.js:140-211` — `showOverlay` / `nonCapturing` focus skip
- `/usr/local/lib/node_modules/pi-permission-system/node_modules/@mariozechner/pi-tui/dist/tui.js:262-267` — `addInputListener`
- `/usr/local/lib/node_modules/pi-permission-system/node_modules/@mariozechner/pi-tui/dist/tui.js:315-365` — `handleInput` focus dispatch
- `/usr/local/lib/node_modules/pi-permission-system/node_modules/@mariozechner/pi-tui/dist/tui.js:527-529` — `OverlayOptions.maxHeight` hard-truncation
- `/usr/local/lib/node_modules/pi-permission-system/node_modules/@mariozechner/pi-tui/dist/terminal.js:251-253` — `rows` live getter

## Integration Points

### Inbound References

These are the paths that will CALL into the new overlay:

- `extensions/rpiv-core/index.ts:33` (`session_start` handler) — must construct `todoOverlay` if `ctx.hasUI`, then `setUICtx(ctx.ui)` + `update()` after `reconstructTodoState` runs at line 35
- `extensions/rpiv-core/index.ts:88-90` (`session_compact` handler) — must add `reconstructTodoState(ctx); todoOverlay?.update();` (currently only clears injection state)
- `extensions/rpiv-core/index.ts:93-95` (`session_shutdown` handler) — must call `todoOverlay?.dispose()`
- `extensions/rpiv-core/index.ts:98-100` (`session_tree` handler) — already calls `reconstructTodoState`; add `todoOverlay?.update();` afterward
- New `pi.on("tool_execution_end", ...)` handler in `extensions/rpiv-core/index.ts` — filter `event.toolName === "todo"` and skip `event.isError`; call `todoOverlay?.update()` only (do NOT touch `reconstructTodoState`)

### Outbound Dependencies

What the overlay depends on:

- `@mariozechner/pi-coding-agent` `ExtensionUIContext.setWidget(key, factory, { placement: "aboveEditor" })` — at `interactive-mode.js:1311`
- `@mariozechner/pi-coding-agent` `ExtensionContext.ui` (live when `ctx.hasUI`)
- `@mariozechner/pi-coding-agent` `Theme` (imported where `pi-tui` Theme used)
- `@mariozechner/pi-tui` `TUI.requestRender()` — via the `tui` reference captured in the factory closure
- `@mariozechner/pi-tui` `Component` interface (`render(width: number): string[]`)
- `@mariozechner/pi-tui` `Terminal.columns` / `Terminal.rows` live getters
- `extensions/rpiv-core/todo.ts` `getTodos()` — single source of truth for current task state
- `extensions/rpiv-core/todo.ts` `Task`, `TaskStatus` types

### Infrastructure Wiring

- `extensions/rpiv-core/index.ts:26-30` — existing `default export function` receives `ExtensionAPI`; new `const todoOverlay = new TodoOverlay(getTodos)` or `let todoOverlay: TodoOverlay | undefined` module-scope
- `@mariozechner/pi-coding-agent` wires `ExtensionUIContext` at `interactive-mode.js:1288-1352`; the overlay never touches this directly
- Event plumbing: `pi.on("tool_execution_end", handler)` → `ExtensionRunner._emitExtensionEvent` → `ExtensionContext` passed to handler; handler must NOT await on `ctx.sessionManager.getBranch()` for todo state (stale at this point)

## Architecture Insights

- **Widget registration is idempotent and factory-only**: `setExtensionWidget` at `interactive-mode.js:1114-1121` always removes-then-inserts, so re-registration moves a widget to the bottom of the Map. Call `setWidget` once in `update()` guarded by `widgetRegistered`; use `requestRender()` for refreshes.
- **Factory closure is the only pattern for stateful widgets**: `interactive-mode.js:1138-1141` stores the factory's return value, then calls its `render(width)` on every frame. Live state is read via closure; no serialization through props.
- **Module state is the fastest update path**: `todo.ts:60-61` + `execute` at line 607-619 mutate synchronously, so the overlay reading `getTodos()` in a `tool_execution_end` handler sees post-mutation state BEFORE the branch is persisted.
- **Extension events fire before message persistence**: `tool_execution_end` at `agent-session.js:438-447` runs in a separate step from `message_end` at `agent-session.js:293-303`. Anything that walks `ctx.sessionManager.getBranch()` from a tool-event hook reads a branch missing the just-executed tool's result.
- **hasUI is an identity check**: `runner.js:203-205` compares against `noOpUIContext` singleton. `ctx.hasUI === true` is a hard guarantee that `ctx.ui` is the real bound object, so `ctx.hasUI &&` gating is correct and sufficient.
- **Widget ordering is registration-order, no re-ordering API**: the `extensionWidgetsAbove: Map<string, Component>` at `interactive-mode.js:128-131` preserves insertion order; hide/show cycles move widgets to the bottom. There is no priority field, no sort, no z-order.
- **AgentWidget's collapse model has prior art**: `agent-widget.js:276-315` implements prioritized overflow (running > queued > finished) + `+N more` summary. Users are implicitly trained on this visual language — mirroring it for todos (e.g., in_progress > pending > completed, `+N more`) is the path of least resistance.
- **Inline tool rows have a 4-line floor**: `Spacer(1)` at `tool-execution.js:39` plus `Box.paddingY=1` at line 42 make it impossible to produce a zero-height tool row via renderer tweaks alone. Dropping `renderResult` keeps audit trail minimal but does not eliminate it.

## Precedents & Lessons

4 commits total in the repo, all 2026-04-10, NONE touching widgets or overlays. Only precedent lives in `thoughts/` docs and in `@tintinweb/pi-subagents` source.

- **Commit `a01a4a3`** (2026-04-10, "Initial rpiv-pi package"): monolith `extensions/rpiv-core/index.ts` with todo tool inline. No widgets.
- **Commit `8610ae5`** (2026-04-10, "Refactor rpiv-core extension into focused modules"): extracted `todo.ts` (160 LOC) from `index.ts`; established the per-module boundary the `TodoOverlay` should slot into as a new sibling file.
- **Commit `66eaea3`** (2026-04-10, "Migrate all skills to Pi-native patterns"): skills-only, no extension code.
- **Commit `d484cb3`** (2026-04-10, "Update README, mark plan progress, add research questions"): added questions artifact; no code changes.

Lessons:

- **The prior overlay rejection does NOT apply to this design**. `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md:34,151,350-351` and `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md:60,82,180-194` cite `"pi-tui overlays hard-truncate at maxHeight (tui.js:565-567) and require self-implemented scrolling — not worth the ~150 LOC for the single resume-handoff use case."` That constraint is about `showOverlay` / `OverlayOptions.maxHeight`. The factory-form `setWidget(..., { placement: "aboveEditor" })` path bypasses the cap entirely, and the developer's collapse-model decision removes the self-implemented-scrolling cost anyway. Cite this in the design artifact so reviewers don't resurrect the old objection.
- **Zero empirical failure data exists yet** — no follow-up fix commits after any todo work have landed. Every lesson about widget lifecycle comes from reading pi-subagents source, not from this repo's history.
- **Use `8610ae5`'s module boundary**: add `extensions/rpiv-core/todo-overlay.ts` as a sibling to `todo.ts`; keep `todo.ts` focused on tool/reducer/replay.

## Historical Context (from thoughts/)

- `thoughts/shared/questions/2026-04-11_10-40-21_todo-list-overlay-above-input.md` — the research questions this doc answers
- `thoughts/shared/questions/2026-04-10_20-59-46_todo-tool-cc-parity.md` — original todo-tool research questions (pre-rejection)
- `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md` — prior research that rejected the overlay approach on `maxHeight` grounds
- `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md` — design artifact that encoded the rejection and shipped inline `renderResult` instead
- `thoughts/shared/plans/2026-04-11_07-30-37_todo-tool-cc-parity.md` — implementation plan for the current inline `renderResult` / `/todos` UX
- `thoughts/shared/reviews/2026-04-11_design-evaluation-todo-tool-cc-parity.md` — evaluation of the prior design
- `thoughts/shared/questions/2026-04-11_06-36-22_pi-subagents-alt-library.md` — related pi-subagents investigation

## Developer Context

**Q (`agent-widget.js:276-315`, `agent-widget.js:11` `MAX_WIDGET_LINES = 12`): Since AgentWidget collapses overflow (priority-ordered + `+N more` summary) rather than scrolling, and ConversationViewer's scroll at `conversation-viewer.js:38-71` is a capturing modal, which overflow model should TodoOverlay use?**
A: Mirror AgentWidget: collapse. No scroll, no input handling, no focus interaction. This eliminates the entire focus-vs-scroll complexity (Q3/Q4 from the questions artifact) and matches the visual language users already know.

**Q (`extensions/rpiv-core/todo.ts:643-829` `renderResult`, `tool-execution.js:39-42` 4-line floor): With the overlay showing live state, the rich `renderResult` produces redundant rows in chat history. Box(1,1) paddingY + Spacer(1) means the minimum row height is ~4 lines even if `renderResult` returns `Text("",0,0)` — you cannot zero it via renderer tweaks. What should happen?**
A: Drop `renderResult` from the tool definition entirely. `tool-execution.js:61-69`'s `getResultRenderer()` returns undefined, triggering `createResultFallback()` at `tool-execution.js:95-101` which uses `result.content[0].text` — a one-line stub like "Created #5: write tests (pending)". `renderCall` at `todo.ts:621-641` stays as the minimal 1-line audit marker.

**Q (`agent-widget.js:341-345` auto-hide behavior, `interactive-mode.js:1114-1121` removes-then-inserts on re-register): Should the overlay auto-hide when todos are empty, stay always-visible with a placeholder, or register-once-and-persist?**
A: Auto-hide when empty. Match AgentWidget's `setWidget(key, undefined)` pattern. Trade-off accepted: after `/clear` or last task deletion the widget vanishes, and re-registering reshuffles its position in `widgetContainerAbove`'s Map — if `"agents"` is also registered, ordering depends on which was registered most recently.

## Related Research

- Questions source: `thoughts/shared/questions/2026-04-11_10-40-21_todo-list-overlay-above-input.md`
- Prior rejection: `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md` (overturned — see Precedents & Lessons)
- Prior design: `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md` (shipped inline `renderResult` instead)

## Open Questions

- **Widget ordering under `"agents"` coexistence**: when both `"rpiv-todos"` and `"agents"` are registered, the first-registered sits on top. Is there a preferred vertical order (e.g., "todos always above agents because they are persistent planning state while agents are transient")? If so, the overlay may need to force-re-register to claim the bottom slot, or the design needs to accept whichever order registration races produce.
- **`session_compact` todo rebuild policy**: currently `extensions/rpiv-core/index.ts:88-90` only clears injection state. After compaction, task state prior to the compaction cutoff may no longer be reconstructable from the branch on future reload. Calling `reconstructTodoState(ctx)` in `session_compact` would trim module state to match the post-compaction branch now rather than silently on next reload. The right behavior is a policy call — pre-emptive consistency (call it) vs. grace-period display (keep showing pre-compaction tasks until next reload). Default recommendation: call `reconstructTodoState(ctx); overlay.update();` in `session_compact` for consistency, but flag this explicitly in the plan.
- **Theme change propagation**: `AgentWidget.invalidate()` at `agent-widget.js:384-388` is called by the host on theme changes to force a factory re-invocation with a new theme reference. Confirm that `InteractiveMode` actually calls `invalidate()` on theme swap, or whether theme changes only require a `requestRender()` because the theme is a live module singleton.
