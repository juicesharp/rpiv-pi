---
date: 2026-04-12T15:57:14Z
researcher: Claude Code
git_commit: 9d33a1c
branch: master
repository: rpiv-pi
topic: "Persistence of advisor settings between sessions"
tags: [research, advisor, persistence, config, session-lifecycle, model-registry]
status: complete
questions_source: "thoughts/shared/questions/2026-04-12_11-29-50_advisor-settings-persistence.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Research: Persistence of Advisor Settings Between Sessions

## Research Question
How should the advisor tool's model selection and reasoning effort level persist across Pi sessions? Currently both are in-memory module-level variables that reset on every session restart.

## Summary
The web-tools extension's `loadConfig()`/`saveConfig()` pattern at `extensions/web-tools/index.ts:41-56` is the correct template for cross-session advisor persistence. The advisor config will be a new file at `~/.config/rpiv-pi/advisor.json` storing `{ advisorModel?: string, advisorEffort?: string }` in `"provider:id"` / ThinkingLevel format. Restoration happens in the `session_start` handler at `index.ts:43` (after `reconstructTodoState`, before TodoOverlay setup), resolving the stored key via `ctx.modelRegistry.find(provider, modelId)`. The `session_compact` handler needs no changes — module-level state survives compaction, and the config file is disk-independent. The effort picker at `advisor.ts:476` must be updated to pre-select the stored effort level instead of hardcoded `"high"`.

## Detailed Findings

### File-Based Config Pattern (Web-Tools Template)
- The web-tools extension defines the only user-settings persistence pattern in the codebase (`extensions/web-tools/index.ts:32-56`)
- `loadConfig()` (`web-tools/index.ts:41-47`): reads JSON with `readFileSync`, returns `{}` on missing/error — never throws
- `saveConfig()` (`web-tools/index.ts:50-56`): writes JSON with `writeFileSync`, creates parent dirs with `mkdirSync({ recursive: true })`, sets `chmod 0o600` in best-effort try/catch
- Config path: `~/.config/rpiv-pi/web-tools.json` — the `~/.config/rpiv-pi/` directory already exists
- Resolution pattern (`web-tools/index.ts:59-64`): env var first, then file config — the advisor would use file-only (no env override needed)

### Advisor Config Schema
- `advisorModel?: string` — stored as `"provider:id"` format matching the `modelKey()` helper at `advisor.ts:319`
- `advisorEffort?: string` — stored as a ThinkingLevel literal: `"minimal"|"low"|"medium"|"high"|"xhigh"`
- Absent/empty file or missing fields → advisor stays off (current default behavior)
- File path: `~/.config/rpiv-pi/advisor.json` (global scope, matching web-tools convention)

### Session-Start Restoration Hook Point
- The `session_start` handler at `index.ts:41-93` executes sequentially
- Restoration should happen between `reconstructTodoState(ctx)` (line 43) and TodoOverlay setup (line 46)
- `ctx.modelRegistry` is fully initialized at `session_start` time — the registry is populated during `createAgentSessionServices()` at `agent-session-services.js:53-96`, which completes before the `AgentSession` is constructed
- `ctx.modelRegistry.find(provider, modelId)` (`model-registry.d.ts:59`) is the correct lookup method — it searches all models without auth filtering, unlike `getAvailable()` which requires configured auth

### Model Resolution and Graceful Degradation
- The stored `"provider:id"` string is split on `:` to get `(provider, modelId)` — care needed for IDs containing `:` (use `split(":")` with `rest.join(":")`)
- `ctx.modelRegistry.find(provider, modelId)` returns `Model<Api> | undefined`
- If model not found: silently skip restoration, leave advisor off, optionally notify user via `ctx.ui.notify("Previously configured advisor model ... is no longer available", "warning")`
- If model found but no API key: restore the model but warn — the advisor will produce a clear error at call time (`advisor.ts:126-131`)
- Pi's own `restoreModelFromSession()` at `model-resolver.js:433-481` follows the same pattern

### Session Compact — No Changes Needed
- `session_compact` handler at `index.ts:104-108` calls `clearInjectionState()` and `reconstructTodoState(ctx)` but does NOT touch advisor state
- Module-level `selectedAdvisor` and `selectedAdvisorEffort` survive compaction unchanged (JavaScript closure variables, not derived from session entries)
- `session_compact` does NOT reload extensions or reset module state — the `ExtensionRunner` instance persists throughout the process lifetime
- The `before_agent_start` handler at `advisor.ts:283-290` checks `getAdvisorModel()` which returns the module variable — so the advisor tool remains in the active set after compaction
- Config file on disk is completely independent of the session store

### Why Session-Entry Pattern Is Wrong for Cross-Session
- The todo tool's `reconstructTodoState()` at `todo.ts:501-511` walks `ctx.sessionManager.getBranch()` to rebuild state from JSONL entries
- This survives compaction (entries not deleted) but NOT new sessions (fresh JSONL file, `getBranch()` returns `[]`)
- Cross-session persistence requires file-based config — the session-entry approach is architecturally bound to a single JSONL lifetime

### `/advisor` Command UI Impact
- Model picker `✓` marker at `advisor.ts:339` works automatically — it compares `modelKey(getAdvisorModel())`, so a restored model gets the checkmark with zero UI changes
- Effort picker at `advisor.ts:476` **must be fixed** — currently hardcoded to `selectList.setSelectedIndex(baseLevels.indexOf("high") + 1)`, ignoring the current effort level. With persistence, it should pre-select `getAdvisorEffort()` if set, falling back to `"high"`
- A `ctx.ui.notify("Advisor restored: ...")` notification at session start (after successful restoration) would inform the user — consistent with existing notifications for bundled agents (`index.ts:62-66`) and permissions seeding (`index.ts:69-72`)

### Interaction with Pi's Global Settings
- Pi's `~/.pi/agent/settings.json` stores `defaultProvider`, `defaultModel`, `defaultThinkingLevel` — extensions can read this (`package-checks.ts:21-30`)
- Advisor config should store **explicit `"provider:id"` keys**, not reference Pi's default — the advisor is semantically "a stronger model than the executor," so tying it to the default would collapse the advisor/executor gap when the user changes defaults
- Pi's own `restoreModelFromSession()` at `model-resolver.js:433-481` stores explicit provider/modelId pairs, not sentinels

### Security Considerations
- Advisor config stores only preference data (model name + effort level) — no API keys or credentials
- `chmod 0o600` recommended for consistency with web-tools pattern, even though the data isn't strictly sensitive
- Model identifiers reveal which AI service the user subscribes to — minimal concern on single-user systems
- Global scope (`~/.config/rpiv-pi/`) is appropriate — `~/.config` is normally `0o700` on Unix, providing directory-level protection

## Code References
- `extensions/rpiv-core/advisor.ts:68-69` — Module-level `selectedAdvisor` and `selectedAdvisorEffort` variables (in-memory only)
- `extensions/rpiv-core/advisor.ts:71-84` — Getter/setter exports for advisor state
- `extensions/rpiv-core/advisor.ts:283-290` — `before_agent_start` handler that strips advisor when no model selected
- `extensions/rpiv-core/advisor.ts:319` — `modelKey()` helper producing `"provider:id"` strings
- `extensions/rpiv-core/advisor.ts:336-345` — Model selector with `✓` marker logic
- `extensions/rpiv-core/advisor.ts:414-415` — Save point: "No advisor" clears both values
- `extensions/rpiv-core/advisor.ts:424-426` — Model reverse-lookup from key string
- `extensions/rpiv-core/advisor.ts:476` — Hardcoded effort picker default (needs fix)
- `extensions/rpiv-core/advisor.ts:513-514` — Save point: model+effort selection
- `extensions/rpiv-core/index.ts:41-93` — `session_start` handler (restoration hook point at line ~44)
- `extensions/rpiv-core/index.ts:104-108` — `session_compact` handler (no changes needed)
- `extensions/web-tools/index.ts:32-56` — Config persistence pattern (loadConfig/saveConfig template)
- `extensions/web-tools/index.ts:36` — CONFIG_PATH constant at `~/.config/rpiv-pi/web-tools.json`
- `extensions/rpiv-core/todo.ts:501-511` — `reconstructTodoState()` (session-entry pattern, NOT suitable for cross-session)
- `extensions/rpiv-core/package-checks.ts:15-30` — `readInstalledPackages()` proves extensions can read `~/.pi/agent/settings.json`
- `model-registry.d.ts:59` — `find(provider, modelId)` method for model resolution

## Integration Points

### Inbound References
- `extensions/rpiv-core/index.ts:41` — `session_start` handler calls advisor restoration (new)
- `extensions/rpiv-core/advisor.ts:283-290` — `before_agent_start` handler reads `getAdvisorModel()` to decide tool stripping
- `extensions/rpiv-core/advisor.ts:332-345` — `/advisor` command reads `getAdvisorModel()` for `✓` marker
- `extensions/rpiv-core/advisor.ts:476` — Effort picker should read `getAdvisorEffort()` for pre-selection

### Outbound Dependencies
- `ctx.modelRegistry.find(provider, modelId)` — resolves stored `"provider:id"` to `Model<Api>`
- `pi.setActiveTools()` — adds `"advisor"` to active tool set on restoration
- `ctx.ui.notify()` — informs user of restored state

### Infrastructure Wiring
- `extensions/rpiv-core/index.ts:41-93` — `session_start` handler: restoration call inserted after `reconstructTodoState(ctx)` at line 43
- `extensions/rpiv-core/advisor.ts:414-415` — `/advisor` command disable path: must also save config (clear `advisorModel`/`advisorEffort`)
- `extensions/rpiv-core/advisor.ts:513-514` — `/advisor` command enable path: must also save config (write `advisorModel`/`advisorEffort`)
- `~/.config/rpiv-pi/advisor.json` — new config file, same directory as `web-tools.json`

## Architecture Insights
- **File-based config is the correct cross-session pattern** — the web-tools `loadConfig()`/`saveConfig()` at `web-tools/index.ts:41-56` is the proven template. Session-entry reconstruction (`todo.ts:501-511`) cannot survive new sessions.
- **Module-scoped state with getter/setter API is the right abstraction boundary** — persistence adds `loadAdvisorConfig()`/`saveAdvisorConfig()` alongside existing `getAdvisorModel()`/`setAdvisorModel()`. The `index.ts` orchestrator only needs one new call: `restoreAdvisorState(ctx)`.
- **`"provider:id"` is the universal model key** — used identically by `modelKey()` (`advisor.ts:319`), `AdvisorDetails.advisorModel` (`advisor.ts:118`), and Pi's `restoreModelFromSession()` (`model-resolver.js:434`). This is the canonical serialization format.
- **`before_agent_start` handler ordering is critical** — commit `be0a014` revealed that `pi-permission-system` rebuilds active tools every turn. The advisor's `before_agent_start` handler at `advisor.ts:283-290` runs after permission-system's and correctly preserves the advisor when `getAdvisorModel()` returns a value. Restoration in `session_start` ensures the handler sees the restored model on the first turn.
- **Global scope chosen** — advisor config at `~/.config/rpiv-pi/advisor.json` (global only, no per-project override). User sets once, applies everywhere.

## Precedents & Lessons
5 relevant precedents analyzed. Key commits: `e4e03ab` (advisor creation), `be0a014` (tool stripping fix), `a01a4a3` (web-tools config pattern).

- **`be0a014`** — `pi-permission-system` rebuilds active tools on every `before_agent_start`, overwriting prior `setActiveTools()` calls. Advisor restoration must happen in `session_start` (before any `before_agent_start`), so the strip handler sees the restored model and preserves the tool.
- **`b50fd50`** — Adding the "off" option to effort picker shifted `setSelectedIndex` indices by +1, requiring an offset fix. The effort picker's index math is fragile — persistence must use `levels.indexOf(currentEffort) + 1` (accounting for the "off" item at index 0).
- **`8610ae5`** — Module extraction pattern: each tool owns its state in its own file. Persistence functions (`loadAdvisorConfig`, `saveAdvisorConfig`, `restoreAdvisorState`) should live in `advisor.ts`, not `index.ts`.

## Historical Context (from thoughts/)
- `thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md` — Original advisor design doc (explicitly scoped out cross-session persistence)
- `thoughts/shared/questions/2026-04-12_11-29-50_advisor-settings-persistence.md` — Research questions artifact (8 questions driving this research)

## Developer Context
**Q (config scope): Should advisor config be global, per-project, or layered?**
A: Global only — `~/.config/rpiv-pi/advisor.json`. Matches web-tools pattern, simple, user sets once.

## Related Research
- Questions source: `thoughts/shared/questions/2026-04-12_11-29-50_advisor-settings-persistence.md`

## Open Questions
None — all research questions resolved. Developer confirmed global-only config scope.
