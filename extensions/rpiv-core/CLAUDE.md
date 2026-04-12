# rpiv-core Extension

## Responsibility
The main Pi extension. Registers tools, slash commands, and session lifecycle hooks with the Pi `ExtensionAPI`. Manages in-session state (todos, advisor config, guidance injection). All workflow intelligence lives in `skills/` — this layer only provides runtime infrastructure.

## Dependencies
- **`@mariozechner/pi-coding-agent`**: `ExtensionAPI`, `DynamicBorder`, session types, `convertToLlm`
- **`@mariozechner/pi-ai`**: `completeSimple`, `StringEnum`, `ThinkingLevel`, `Model`
- **`@mariozechner/pi-tui`**: `Container`, `SelectList`, `Text`, `Spacer`, `truncateToWidth`
- **`@sinclair/typebox`**: `Type` — JSON Schema builder for tool parameter schemas

## Consumers
- **Pi extension host**: loads via `package.json` `"extensions": ["./extensions"]`; calls `default export(pi: ExtensionAPI)` at session start

## Module Structure
```
index.ts                  — Entry point; wires all hooks; imports all register* functions
ask-user-question.ts      — ask_user_question tool (SelectList + free-text fallback)
todo.ts                   — todo tool + /todos command + pure reducer + getTodos() accessor
advisor.ts                — advisor tool + /advisor command + config persistence (~/.config/rpiv-pi/)
todo-overlay.ts           — TodoOverlay: persistent TUI widget above editor input
guidance.ts               — resolveGuidance() + handleToolCallGuidance(); session-scoped dedup Set
agents.ts, permissions.ts, package-checks.ts  — pure utilities; no ExtensionAPI; filesystem/OS only
templates/                — pi-permissions.jsonc seeded to ~/.pi/agent/ once on first run
```

## Tool Registration (`pi.registerTool`)

```typescript
export function registerMyTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "my_tool",                         // snake_case; must match pi-permissions.jsonc entry
        label: "My Tool",
        description: "Full description for tool picker UI.",
        promptSnippet: "Short imperative (≤15 words)",
        promptGuidelines: ["Rule 1.", "Rule 2."],  // array → one bullet per item in system prompt
        parameters: Type.Object({
            action: StringEnum(["create", "update"] as const),
            id: Type.Optional(Type.Number()),
        }),
        async execute(_id, params, signal, onUpdate, ctx) {
            onUpdate?.({ content: [{ type: "text", text: "Working…" }], details: { action: params.action } });
            // return { content, details } — details is persisted in branch for reconstruct*State()
            return { content: [{ type: "text", text: "Done" }], details: { action: params.action } };
            // isError: true  — add on failure; never throw from execute()
        },
        renderResult(result, { expanded }, theme) {    // optional TUI renderer
            return new Text(result.isError ? theme.fg("error", "✗") : theme.fg("success", "✓"), 0, 0);
        },
    });
}
```

## Branch Replay (State Reconstruction)

Tool state survives `session_compact` / `/reload` by storing it in the `details` envelope and replaying the session branch.

```typescript
export function reconstructMyState(ctx: any): void {
    items = []; nextId = 1;                            // always reset before walking
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (msg.role !== "toolResult" || msg.toolName !== "my_tool") continue;
        if (!isMyDetails(msg.details)) continue;       // type guard rejects stale schema
        items = msg.details.items.map(t => ({ ...t }));  // clone — never alias branch data
        nextId = msg.details.nextId;
    }
}
// Call from: session_start, session_compact, session_tree — NEVER from tool_execution_end
```

## Architectural Boundaries
- **NO business logic in index.ts**: orchestration only — all logic in imported modules
- **NO ExtensionAPI in utility modules**: `agents.ts`, `permissions.ts`, `package-checks.ts`, `guidance.ts` are `pi`-free
- **NO state mutation in tool_execution_end**: branch is stale; call `overlay?.update()` only, never `reconstruct*State()`
- **NO advisor in active tools when model unset**: stripped each `before_agent_start` via `pi.setActiveTools()`

<important if="you are adding a new tool to this extension">
## Adding a New Tool
1. Create `extensions/rpiv-core/my-tool.ts`; export `registerMyTool(pi: ExtensionAPI): void`
2. Define `Type.Object({...})` schema and a `MyToolDetails` interface for the `details` envelope
3. If stateful: add module-level `let items`, write a pure `applyMutation()` reducer, export `reconstructMyState(ctx)`
4. In `index.ts`: import + call `registerMyTool(pi)` in the registration section; call `reconstructMyState(ctx)` in `session_start`, `session_compact`, `session_tree` handlers
5. Add the tool name to `templates/pi-permissions.jsonc` under `tools` — use `"allow"` for safe read-only tools; leave at default `"ask"` for tools with side effects or external API calls
</important>

<important if="you are adding a new slash command to this extension">
## Adding a New Slash Command
1. Short handler (no UI): inline `pi.registerCommand("name", { description, handler })` in `index.ts`
2. Complex handler: create `my-command.ts`, export `registerMyCommand(pi)`, import + call in `index.ts`
3. Guard interactive operations: `if (!ctx.hasUI) { ctx.ui.notify("…", "error"); return; }`
4. Handler returns `void`; use `ctx.ui.notify` / `ctx.ui.input` / `ctx.ui.confirm` / `ctx.ui.custom<T>`
</important>

<important if="you are adding a new session lifecycle hook to this extension">
## Adding a Session Hook
1. Identify the event: `session_start`, `session_compact`, `session_tree`, `session_shutdown`, `tool_execution_end`, `tool_call`, `before_agent_start`
2. Add `pi.on("event_name", async (event, ctx) => { … })` in `index.ts` (or a dedicated `registerMyHook(pi)` function)
3. State reset/reconstruction must be called from `session_start`, `session_compact`, and `session_tree` — all three
4. `before_agent_start` can return `{ message: { customType, content, display: false } }` to inject a hidden LLM-only context message
</important>

<important if="you are adding a new pure utility module to this extension">
## Adding a Utility Module
1. Create `extensions/rpiv-core/my-util.ts` with no `ExtensionAPI` import
2. Every function returns a value or `void`; never throws — catch all errors and return a safe default
3. Config files: `loadX()` returns empty default on absent/parse errors; `saveX()` swallows all errors; call `chmodSync(path, 0o600)` after writing any file with credentials
4. `PACKAGE_ROOT` is resolved via `import.meta.url` + `fileURLToPath` — never `__dirname`
</important>

<important if="you are adding a persistent TUI widget to this extension">
## Adding a Persistent Widget
1. Create `my-overlay.ts` with a class exposing `setUICtx(ctx)`, `update()`, `dispose()`
2. Follow the `widgetRegistered` / `tui` / `setWidget(KEY, factory, { placement: "aboveEditor" })` pattern from `TodoOverlay`
3. In `index.ts`: `let overlay: MyOverlay | undefined` (closure variable); in `session_start` → `overlay ??= new MyOverlay(); overlay.setUICtx(ctx.ui); overlay.update()`; in `session_compact`/`session_tree` → `overlay?.update()`; in `session_shutdown` → `overlay?.dispose(); overlay = undefined`
4. Apply `truncateToWidth(line, width)` to every rendered line; use `├─` for all rows, `└─` for the last
</important>
