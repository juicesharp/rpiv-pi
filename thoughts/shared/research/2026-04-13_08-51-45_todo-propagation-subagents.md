---
date: 2026-04-13T08:51:45-07:00
researcher: Claude Code
git_commit: 333949d
branch: master
repository: rpiv-pi
topic: "Todo tool propagation into parallel subagents — shared module-level state corruption bug"
tags: [research, todo, subagents, module-state, jiti-isolation, pi-subagents, session-lifecycle]
status: complete
questions_source: "thoughts/shared/questions/2026-04-13_07-54-32_todo-propagation-into-subagents.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Research: Todo Tool Propagation into Parallel Subagents — Module-Level State Isolation

## Research Question
Does the module-level state pattern in `todo.ts`, `guidance.ts`, and `advisor.ts` create a shared-state corruption bug when subagents are spawned in the same Node.js process?

## Summary
**The hypothesized shared-state corruption bug does NOT exist.** Each subagent session creates a fresh `DefaultResourceLoader` which calls `loadExtensionModule()` using jiti with `moduleCache: false`, producing completely isolated module instances. The child's `tasks`/`nextId`, `injectedGuidance` Set, and `selectedAdvisor` are independent of the parent's. However, the isolation depends on an implicit guarantee (jiti configuration) that is not enforced at the extension level — making the pattern a **latent architectural risk** if the module loading mechanism ever changes.

## Detailed Findings

### The Isolation Mechanism (Why the Bug Doesn't Exist)

The critical safeguard is at `loader.js:222-233`:

```js
async function loadExtensionModule(extensionPath) {
    const jiti = createJiti(import.meta.url, {
        moduleCache: false,   // ← KEY: no module caching
    });
    const module = await jiti.import(extensionPath, { default: true });
    ...
}
```

Each call to `loadExtensionModule()`:
1. Creates a **new jiti compiler instance** (`createJiti()`)
2. With `moduleCache: false`, jiti creates `Object.create(null)` as the require cache — a completely empty object with no prototype
3. After loading, jiti deletes the entry from Node.js's native `require.cache`
4. Module top-level code re-executes: `let tasks: Task[] = []` and `let nextId = 1` get fresh bindings

The loading chain per subagent session:
- `agent-runner.js:126-132`: Creates **new** `DefaultResourceLoader` → calls `.reload()`
- `resource-loader.js:273`: `.reload()` calls `loadExtensions(extensionPaths, ...)`
- `loader.js:284-303`: `loadExtensions()` iterates paths, calls `loadExtension()` for each
- `loader.js:238-256`: `loadExtension()` calls `loadExtensionModule()`
- `loader.js:222-233`: `loadExtensionModule()` creates fresh jiti → fresh module instance

Result: parent's `tasks` array at `todo.ts:60` and child's `tasks` array are **completely separate objects in memory**.

### Theoretical Corruption Sequence (If Isolation Were Absent)

If Pi were to switch to native ESM imports or set `moduleCache: true`, the following corruption would occur:

1. Parent creates tasks #1-5 via `todo.ts:600-607` (`execute()` handler)
2. Parent spawns subagent → `agent-runner.js:126` creates fresh `DefaultResourceLoader`
3. Child's `session.bindExtensions()` at `agent-runner.js:213` fires `session_start`
4. Child's `session_start` handler at `index.ts:41-46` calls `reconstructTodoState(ctx)`
5. `reconstructTodoState()` at `todo.ts:496-507`: `tasks = []; nextId = 1` — **would wipe parent state**
6. Child's empty `SessionManager.inMemory()` branch has no todo entries → state stays empty
7. Parent's next `todo` call reads corrupted empty state

The interleaving point for background agents: the `await` at `agent-runner.js:213` (`bindExtensions`) yields control, allowing the parent to continue while the child corrupts shared state.

### All Three Tools Share the Same Pattern

| Tool | Module-level state | File:Line | session_start reset |
|------|-------------------|-----------|-------------------|
| `todo.ts` | `let tasks: Task[] = []`, `let nextId = 1` | `todo.ts:60-61` | `reconstructTodoState(ctx)` at `index.ts:43` |
| `guidance.ts` | `const injectedGuidance = new Set<string>()` | `guidance.ts:59` | `clearInjectionState()` at `index.ts:42` |
| `advisor.ts` | `let selectedAdvisor`, `let selectedAdvisorEffort` | `advisor.ts:114-115` | `restoreAdvisorState(ctx, pi)` at `index.ts:44` |

All three are equally protected (or equally vulnerable) by the jiti isolation mechanism.

### Overlay Behavior

`todo-overlay.ts` reads state via `getTodos()` imported from `todo.ts:63`. Since modules are isolated, the parent's overlay always reads the parent's own state — never the child's. Child sessions don't even get a `todoOverlay` because `ctx.hasUI` is `false` in subagent sessions (`index.ts:51`).

### Skill Blast Radius (If Isolation Broke)

| Skill | Creates Todos | Spawns Subagents | Risk |
|-------|:---:|:---:|:---:|
| **code-review** | ✅ Step 2 explicit | ✅ Step 3 parallel | ⛔ **Affected** |
| **iterate-plan** | ⚠️ Guideline 5 | ✅ Step 2 conditional | ⚠️ **Potentially** |
| research-questions | ❌ | ✅ Step 2 parallel | ✅ Safe |
| research | ❌ | ✅ Step 2 parallel | ✅ Safe |
| design | ❌ | ✅ Step 2 parallel | ✅ Safe |
| write-plan | ⚠️ Guideline 5 | ❌ | ✅ Safe |
| validate-plan | ❌ | ✅ Step 1 parallel | ✅ Safe |
| commit | ❌ | ❌ | ✅ Safe |

### Hardening Strategies

Even though the bug doesn't exist today, the module-level singleton pattern is fragile:

**(a) WeakMap keyed on SessionManager** — `const stateMap = new WeakMap<SessionManager, {tasks, nextId}>()`
- Makes isolation explicit and independent of module loading behavior
- `SessionManager` is unique per session (parent=file-backed, child=`inMemory()`)
- Requires threading `ctx.sessionManager` through `getTodos()` and `execute()`
- **Recommended**: Lowest effort, no SDK changes needed

**(b) WeakMap keyed on ExtensionAPI** — key on `pi` instance instead
- Each `bindExtensions` creates a new `pi` object
- Same pros/cons as (a) but slightly less semantically clear

**(c) Skip reconstruction for child sessions** — detect in-memory SessionManager
- Only prevents the wipe, doesn't prevent sharing
- Incomplete: `execute()` still reads module-level state
- **Not recommended**: Doesn't solve the core pattern

**(d) Move state into ExtensionAPI context** — `pi.setData()`/`pi.getData()`
- Most architecturally sound — eliminates module-level state entirely
- Requires Pi SDK to expose per-session data store
- **Long-term**: Requires upstream changes

## Code References
- `extensions/rpiv-core/todo.ts:60-61` — Module-level `tasks` and `nextId` state
- `extensions/rpiv-core/todo.ts:63-65` — `getTodos()` reads module-level state
- `extensions/rpiv-core/todo.ts:496-507` — `reconstructTodoState()` resets state from session branch
- `extensions/rpiv-core/todo.ts:578-607` — `registerTodoTool()` and execute handler
- `extensions/rpiv-core/index.ts:41-46` — session_start handler wires all three state resets
- `extensions/rpiv-core/index.ts:107-110` — session_compact recovery point
- `extensions/rpiv-core/index.ts:122-123` — session_tree recovery point
- `extensions/rpiv-core/index.ts:127-131` — tool_execution_end overlay refresh
- `extensions/rpiv-core/guidance.ts:59-60` — Module-level Set + clearInjectionState
- `extensions/rpiv-core/guidance.ts:85-118` — handleToolCallGuidance injection logic
- `extensions/rpiv-core/advisor.ts:114-115` — Module-level advisor state
- `extensions/rpiv-core/advisor.ts:138-186` — restoreAdvisorState from config file
- `extensions/rpiv-core/todo-overlay.ts:44` — imports getTodos
- `extensions/rpiv-core/todo-overlay.ts:71` — update() reads getTodos()
- `extensions/rpiv-core/todo-overlay.ts:114` — renderWidget() reads getTodos()
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js:222-233` — loadExtensionModule with jiti moduleCache:false
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js:238-256` — loadExtension calls loadExtensionModule
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/loader.js:284-303` — loadExtensions iterates all extension paths
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:273` — reload() calls loadExtensions
- `/Users/sguslystyi/.nvm/versions/node/v25.1.0/lib/node_modules/@tintinweb/pi-subagents/dist/agent-runner.js:126-132` — Subagent creates new DefaultResourceLoader
- `/Users/sguslystyi/.nvm/versions/node/v25.1.0/lib/node_modules/@tintinweb/pi-subagents/dist/agent-runner.js:170` — loader.reload() triggers fresh extension loading
- `/Users/sguslystyi/.nvm/versions/node/v25.1.0/lib/node_modules/@tintinweb/pi-subagents/dist/agent-runner.js:177` — SessionManager.inMemory() creates empty branch
- `/Users/sguslystyi/.nvm/versions/node/v25.1.0/lib/node_modules/@tintinweb/pi-subagents/dist/agent-runner.js:213` — session.bindExtensions() fires session_start

## Integration Points

### Inbound References
- `agent-runner.js:213` — `session.bindExtensions()` fires `session_start` on child's extension instances (isolated from parent's)
- `index.ts:41-46` — `session_start` handler calls all three state reset functions
- `todo-overlay.ts:71,114` — Overlay reads `getTodos()` at update/render time

### Outbound Dependencies
- `todo.ts:60-61` → `loader.js:222` — Module state depends on jiti's `moduleCache: false` for isolation
- `guidance.ts:59` → `loader.js:222` — Same dependency
- `advisor.ts:114-115` → `loader.js:222` — Same dependency

### Infrastructure Wiring
- `resource-loader.js:273` — `loadExtensions()` called per `DefaultResourceLoader.reload()`
- `agent-runner.js:126-132` — New `DefaultResourceLoader` per subagent → fresh extension loading
- `agent-session.js:1696-1698` — `_bindExtensionCore()` wires `runtime.sendMessage` per session

## Architecture Insights
- Pi's extension loading creates **isolated module instances** per session via jiti `moduleCache: false`
- The module-level singleton pattern in `todo.ts`, `guidance.ts`, `advisor.ts` is safe **only** because of this jiti configuration
- The isolation is an **implicit guarantee** — none of the extension code knows about or asserts it
- If Pi switches to native ESM imports (no jiti) or sets `moduleCache: true`, all three tools would instantly become vulnerable
- Child sessions don't get UI context (`ctx.hasUI === false`), so `todoOverlay` is never created in children
- `sendMessage()` calls are routed to the session that owns the `pi` instance — no cross-session message leaking

## Precedents & Lessons
0 similar past changes found. No prior commits address module-state isolation or subagent state sharing.

Key architectural lesson: The extension code was designed for single-session use (reconstruct from branch on session_start). Multi-session safety depends entirely on Pi's jiti configuration, which is external to the extension. This is a defense-in-depth gap.

## Historical Context (from thoughts/)
- `thoughts/shared/questions/2026-04-13_07-54-32_todo-propagation-into-subagents.md` — Questions artifact that hypothesized the shared-state bug

## Developer Context
**Q (`loader.js:222-233`): Does jiti moduleCache:false provide reliable per-session module isolation?**
A: Developer confirmed — the bug does not exist. The jiti isolation mechanism works correctly.

## Related Research
- Questions source: `thoughts/shared/questions/2026-04-13_07-54-32_todo-propagation-into-subagents.md`

## Open Questions
- Should the extension code add defensive assertions (e.g., verify that module-level state hasn't been modified by another session) as a canary for isolation breakage?
- Is the `code-review` skill's explicit instruction to create todos before spawning subagents an acceptable pattern, or should it be refactored to complete todos before spawning?
