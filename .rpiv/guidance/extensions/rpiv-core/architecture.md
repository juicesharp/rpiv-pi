# rpiv-core Extension

## Responsibility
Pi runtime orchestrator. Owns zero tools. Wires five session lifecycle hooks (guidance injection, git-context injection, `thoughts/` scaffold, bundled-agent sync) and registers two slash commands (`/rpiv-update-agents`, `/rpiv-setup`). All tool surfaces live in sibling plugins listed in `siblings.ts`; all workflow intelligence lives in `skills/`.

## Dependencies
- **`@mariozechner/pi-coding-agent`**: `ExtensionAPI`, `isToolCallEventType`. Only runtime import.
- Node built-ins: `node:fs`, `node:path`, `node:url`, `node:os`, `node:child_process`.
- External processes: `git` (via `pi.exec`), `pi` CLI (via `spawn` in `pi-installer.ts`).

No runtime imports of any sibling plugin — detection is filesystem-based (regex over `~/.pi/agent/settings.json`).

## Consumers
- **Pi extension host**: loads via `package.json` `"extensions": ["./extensions"]`; calls `default export(pi: ExtensionAPI)` at session start

## Module Structure
```
index.ts                   — Thin composer; three register*(pi) calls only
siblings.ts                — Declarative SIBLINGS registry (5 sibling plugins) — single source of truth
session-hooks.ts           — registerSessionHooks: session_start/compact/shutdown, tool_call, before_agent_start
setup-command.ts           — registerSetupCommand: /rpiv-setup installer
update-agents-command.ts   — registerUpdateAgentsCommand: /rpiv-update-agents
guidance.ts                — resolveGuidance + handleToolCallGuidance + injectRootGuidance; session-scoped dedup Set
git-context.ts             — branch+commit+user cache + takeGitContextIfChanged + isGitMutatingCommand
agents.ts                  — syncBundledAgents: manifest-based add/update/remove engine
package-checks.ts          — findMissingSiblings: thin projection over SIBLINGS
pi-installer.ts            — spawnPiInstall: Windows-safe `pi install <pkg>` wrapper
```

## Tool Registration (`pi.registerTool`)

rpiv-core registers zero tools today — it is a pure orchestrator. New tools belong in sibling plugins. The pattern below applies to sibling plugins that register tools.

```typescript
export function registerMyTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "my_tool",                         // snake_case
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

rpiv-core has no tool state today (all state is sibling-owned). The pattern below applies to sibling plugins: tool state survives `session_compact` / `/reload` by storing it in the `details` envelope and replaying the session branch.

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
// Call from: session_start, session_compact — never from events where the branch is stale
```

## Architectural Boundaries
- **NO business logic in index.ts**: orchestration only — all logic in imported registrar modules
- **NO ExtensionAPI in utility modules**: `siblings.ts`, `package-checks.ts`, `agents.ts`, `pi-installer.ts` are `pi`-free; `guidance.ts`'s injection helpers take `pi` explicitly
- **NO runtime import of sibling packages**: presence detection stays filesystem-based (regex over `~/.pi/agent/settings.json`)
- **NO tools registered here**: rpiv-core is pure orchestrator — new tools belong in sibling plugins

<important if="you are adding a new tool to this extension">
## Adding a New Tool
New tools do not belong in rpiv-core — it is a pure orchestrator and registers zero tools. Add the tool to a sibling plugin instead:
1. Add the tool to an existing sibling (`@juicesharp/rpiv-advisor`, `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-web-tools`, etc.) or create a new sibling plugin repo.
2. Register the new sibling in rpiv-core by adding one entry to `SIBLINGS` in `siblings.ts` — presence detection, session_start missing-plugin warning, and `/rpiv-setup` all pick it up automatically.
3. Add the package to `peerDependencies` in rpiv-pi's `package.json` pinned to `"*"`.
</important>

<important if="you are adding a new slash command to this extension">
## Adding a New Slash Command
1. Create `my-command.ts`, export `registerMyCommand(pi: ExtensionAPI): void` — this is the default pattern; `index.ts` is a thin composer with no inline handlers.
2. Register in `index.ts` by adding one call: `registerMyCommand(pi)`.
3. Guard interactive operations: `if (!ctx.hasUI) { ctx.ui.notify("…", "error"); return; }`
4. Group user-facing strings at file top as `MSG_*`/`ERR_*` constants or arrow-message helpers; no inline template literals in logic.
5. Handler returns `void`; use `ctx.ui.notify` / `ctx.ui.input` / `ctx.ui.confirm` / `ctx.ui.custom<T>`
</important>

<important if="you are adding a new session lifecycle hook to this extension">
## Adding a Session Hook
1. Add the `pi.on("event_name", async (event, ctx) => { … })` line inside `registerSessionHooks` in `session-hooks.ts`.
2. Extract the handler body into a named helper function in the same file — `pi.on` lines are pure wiring.
3. Valid events used here: `session_start`, `session_compact`, `session_shutdown`, `tool_call`, `before_agent_start`. rpiv-core has no tool state to reconstruct, so branch-replay events are not subscribed.
4. `before_agent_start` can return `{ message: { customType, content, display: false } }` to inject a hidden LLM-only context message.
</important>

<important if="you are adding a new pure utility module to this extension">
## Adding a Utility Module
1. Create `extensions/rpiv-core/my-util.ts` with no `ExtensionAPI` import
2. Every function returns a value or `void`; never throws — catch all errors and return a safe default
3. `PACKAGE_ROOT` is resolved via `import.meta.url` + `fileURLToPath` — never `__dirname`
</important>

<important if="you are adding a persistent TUI widget to this extension">
## Adding a Persistent Widget
`TodoOverlay` was extracted to `@juicesharp/rpiv-todo`; no widgets currently live in rpiv-core. Widgets belong in sibling plugins that own the underlying tool state. The pattern below applies to sibling plugins:
1. Create `my-overlay.ts` with a class exposing `setUICtx(ctx)`, `update()`, `dispose()`
2. Follow the `widgetRegistered` / `tui` / `setWidget(KEY, factory, { placement: "aboveEditor" })` pattern from `TodoOverlay`
3. In the sibling's `index.ts`: `let overlay: MyOverlay | undefined` (closure variable); in `session_start` → `overlay ??= new MyOverlay(); overlay.setUICtx(ctx.ui); overlay.update()`; in `session_compact` and the sibling's branch-replay event → `overlay?.update()`; in `session_shutdown` → `overlay?.dispose(); overlay = undefined`
4. Apply `truncateToWidth(line, width)` to every rendered line; use `├─` for all rows, `└─` for the last
</important>
