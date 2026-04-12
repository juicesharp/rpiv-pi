---
date: 2026-04-12T12:21:43Z
designer: Claude Code
git_commit: 9d33a1c
branch: master
repository: rpiv-pi
topic: "Persistence of advisor settings between sessions"
tags: [design, advisor, persistence, config, session-lifecycle]
status: complete
research_source: "thoughts/shared/research/2026-04-12_11-57-02_advisor-settings-persistence.md"
last_updated: 2026-04-12T12:25:00Z
last_updated_by: Claude Code
---

# Design: Advisor Settings Persistence

## Summary

Persist the advisor tool's model selection and reasoning effort level across Pi sessions using a file-based config at `~/.config/rpiv-pi/advisor.json`. Follows the proven web-tools `loadConfig()`/`saveConfig()` pattern. Restoration happens in `session_start` after todo state reconstruction; config saves happen at the `/advisor` command's enable/disable points. Also fixes the effort picker to pre-select the stored effort level instead of hardcoded `"high"`.

## Requirements

- Advisor model selection and effort level survive process restarts (new Pi sessions)
- Config file at `~/.config/rpiv-pi/advisor.json` — global scope, no per-project override
- Graceful degradation when stored model is no longer available (silently skip, leave advisor off)
- Save config when user enables or disables advisor via `/advisor` command
- Fix effort picker to pre-select current effort level, not hardcoded `"high"`
- Follow existing web-tools config pattern for consistency
- No changes to `session_compact` handler — module-level state survives compaction

## Current State Analysis

### Key Discoveries

- Module-level `selectedAdvisor` and `selectedAdvisorEffort` variables at `advisor.ts:68-69` are in-memory only — reset every session
- The web-tools extension at `web-tools/index.ts:32-56` defines the only user-settings persistence pattern: `loadConfig()`/`saveConfig()` with `chmod 0o600`, defensive error handling, `{}` on failure
- `ctx.modelRegistry.find(provider, modelId)` at `model-registry.d.ts:60` resolves models without auth filtering — correct for restoration
- The `before_agent_start` strip handler at `advisor.ts:283-290` must see the restored model on turn 1, so restoration must complete in `session_start`
- Effort picker at `advisor.ts:476` hardcodes `setSelectedIndex(baseLevels.indexOf("high") + 1)` — ignores current effort
- The `"off"` effort value is `undefined` at the API level — never store the string `"off"` in config
- `modelKey()` at `advisor.ts:319` produces `"provider:id"` strings — canonical serialization format
- Model IDs may contain `:` — must split with `indexOf(":")` + `slice`, not `split(":")`

## Scope

### Building

- `ADVISOR_CONFIG_PATH`, `AdvisorConfig` interface, `loadAdvisorConfig()`, `saveAdvisorConfig()` in `advisor.ts`
- `restoreAdvisorState(ctx, pi)` export from `advisor.ts` with model resolution and graceful degradation
- Wiring in `index.ts` `session_start` handler to call `restoreAdvisorState`
- `saveAdvisorConfig()` calls at disable path (`advisor.ts:414-415`) and enable path (`advisor.ts:513-514`)
- Effort picker pre-selection fix at `advisor.ts:476`
- Notification on successful restoration

### Not Building

- Per-project advisor config (developer confirmed global-only)
- Environment variable override for advisor model
- Session-entry-based persistence (architecturally bound to single JSONL lifetime)
- `session_compact` handler changes (module state survives compaction without changes)
- Automated tests (no existing test infrastructure for advisor)

## Decisions

### Config file location and format

Simple — `~/.config/rpiv-pi/advisor.json` matching web-tools convention. Schema: `{ modelKey?: string, effort?: string }`. Developer confirmed global-only scope.

Evidence: `web-tools/index.ts:36` (`CONFIG_PATH` pattern), research Q6 resolution.

### Model resolution method

Simple — use `ctx.modelRegistry.find(provider, modelId)` not `getAvailable().find()`. The `find()` method searches all registered models without auth filtering, which is correct for restoration where the model may be available but not yet authenticated.

Evidence: `model-registry.d.ts:60`, research artifact "Model Resolution and Graceful Degradation" section.

### Restoration hook point

Simple — insert in `session_start` handler after `reconstructTodoState(ctx)` (line 43) and before TodoOverlay setup (line 46). `ctx.modelRegistry` is fully initialized at this point. This ensures the `before_agent_start` strip handler sees the restored model on the first turn.

Evidence: `index.ts:41-93`, precedent `be0a014` lesson about tool stripping ordering.

### session_compact: no changes

Simple — module-level `selectedAdvisor` and `selectedAdvisorEffort` survive compaction as JavaScript closure variables. The config file is disk-independent. The `before_agent_start` handler at `advisor.ts:283-290` reads module state directly.

Evidence: research artifact "Session Compact — No Changes Needed" section, `index.ts:104-108`.

### Effort picker: dynamic pre-selection

Simple — replace `selectList.setSelectedIndex(baseLevels.indexOf("high") + 1)` with `effortItems.findIndex(item => item.value === currentEffort)`, falling back to "high" index. Use dynamic findIndex instead of hardcoded `indexOf() + 1` to avoid fragile offset math.

Evidence: precedent `b50fd50` (index math bug when "off" item was added).

### Persistence functions in advisor.ts

Simple — all config functions (`loadAdvisorConfig`, `saveAdvisorConfig`, `restoreAdvisorState`) live in `advisor.ts`. Export only `restoreAdvisorState` for `index.ts`. Follows module extraction pattern where each tool owns its state.

Evidence: precedent `8610ae5` (module extraction pattern), research artifact Architecture Insights.

### Graceful degradation

Simple — if stored model not found via `find()`, silently skip restoration. Optionally notify user via `ctx.ui.notify()`. If model found but no API key, restore anyway — advisor will produce a clear error at call time.

Evidence: research artifact "Model Resolution and Graceful Degradation" section, Pi's own `restoreModelFromSession()` pattern.

## Architecture

### extensions/rpiv-core/advisor.ts — MODIFY

#### New imports (add after existing imports at top of file)
```typescript
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
```

#### Config infrastructure (insert after ADVISOR_SYSTEM_PROMPT constant, before Types section)
```typescript
// ---------------------------------------------------------------------------
// Config file persistence (cross-session)
// ---------------------------------------------------------------------------

interface AdvisorConfig {
	modelKey?: string;
	effort?: ThinkingLevel;
}

const ADVISOR_CONFIG_PATH = join(homedir(), ".config", "rpiv-pi", "advisor.json");

function loadAdvisorConfig(): AdvisorConfig {
	if (!existsSync(ADVISOR_CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(ADVISOR_CONFIG_PATH, "utf-8")) as AdvisorConfig;
	} catch {
		return {};
	}
}

function saveAdvisorConfig(key: string | undefined, effort: ThinkingLevel | undefined): void {
	const config: AdvisorConfig = {};
	if (key) config.modelKey = key;
	if (effort) config.effort = effort;
	mkdirSync(dirname(ADVISOR_CONFIG_PATH), { recursive: true });
	writeFileSync(ADVISOR_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
	try {
		chmodSync(ADVISOR_CONFIG_PATH, 0o600);
	} catch {
		// chmod may fail on some filesystems — best effort only
	}
}

function parseModelKey(key: string): { provider: string; modelId: string } | undefined {
	const idx = key.indexOf(":");
	if (idx < 1) return undefined;
	return { provider: key.slice(0, idx), modelId: key.slice(idx + 1) };
}
```

#### restoreAdvisorState — session restoration (insert after module state getters/setters, before core execute logic)
```typescript
// ---------------------------------------------------------------------------
// Session restoration — called from index.ts session_start handler
// ---------------------------------------------------------------------------

export function restoreAdvisorState(ctx: ExtensionContext, pi: ExtensionAPI): void {
	const config = loadAdvisorConfig();
	if (!config.modelKey) return;

	const parsed = parseModelKey(config.modelKey);
	if (!parsed) return;

	const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
	if (!model) {
		if (ctx.hasUI) {
			ctx.ui.notify(
				`Previously configured advisor model ${config.modelKey} is no longer available`,
				"warning",
			);
		}
		return;
	}

	setAdvisorModel(model);
	if (config.effort) {
		setAdvisorEffort(config.effort);
	}

	const active = pi.getActiveTools();
	if (!active.includes(ADVISOR_TOOL_NAME)) {
		pi.setActiveTools([...active, ADVISOR_TOOL_NAME]);
	}

	if (ctx.hasUI) {
		ctx.ui.notify(
			`Advisor restored: ${model.provider}:${model.id}${config.effort ? `, ${config.effort}` : ""}`,
			"info",
		);
	}
}
```

#### Save-on-change in /advisor command — disable path (after setAdvisorEffort(undefined) at line ~415)
```typescript
				setAdvisorModel(undefined);
				setAdvisorEffort(undefined);
				saveAdvisorConfig(undefined, undefined);  // <-- NEW
```

#### Save-on-change in /advisor command — enable path (after setAdvisorModel(picked) at line ~514)
```typescript
			setAdvisorEffort(effortChoice);
			setAdvisorModel(picked);
			saveAdvisorConfig(modelKey(picked), effortChoice);  // modelKey() is the helper function
```

#### Effort picker pre-selection fix (replaces line ~476)
```typescript
						// BEFORE:
						selectList.setSelectedIndex(baseLevels.indexOf("high") + 1);
						// AFTER:
						const currentEffort = getAdvisorEffort();
						const defaultIdx = currentEffort
							? effortItems.findIndex((item) => item.value === currentEffort)
							: -1;
						selectList.setSelectedIndex(defaultIdx >= 0 ? defaultIdx : baseLevels.indexOf("high") + 1);
```

### extensions/rpiv-core/index.ts — MODIFY

#### Updated import (line 26)
```typescript
// BEFORE:
import { registerAdvisorTool, registerAdvisorCommand, registerAdvisorBeforeAgentStart } from "./advisor.js";
// AFTER:
import { registerAdvisorTool, registerAdvisorCommand, registerAdvisorBeforeAgentStart, restoreAdvisorState } from "./advisor.js";
```

#### Session start handler — insert after reconstructTodoState(ctx) at line 43
```typescript
		// Restore persisted advisor model + effort from previous session
		restoreAdvisorState(ctx, pi);
```

## Desired End State

```typescript
// Session start: advisor auto-restored from config
// User starts Pi, previously configured advisor (e.g., anthropic:claude-opus-4-6, effort: high)
// is automatically restored. The advisor tool is active from turn 1.

// /advisor command: config saved on change
// User picks a new model → config file updated immediately
// User selects "No advisor" → config file cleared

// Effort picker: shows current selection
// User opens /advisor → effort picker pre-selects their stored effort level
// (currently hardcoded to "high", ignores their previous choice)

// Config file example (~/.config/rpiv-pi/advisor.json):
// {
//   "modelKey": "anthropic:claude-opus-4-6",
//   "effort": "high"
// }

// Graceful degradation:
// User removes Anthropic API key → model still in registry, restored successfully
// Model removed from registry → silently skipped, advisor stays off
// Config file deleted → advisor stays off (default behavior unchanged)
// Config file corrupt → loadConfig returns {}, advisor stays off
```

## File Map

```
extensions/rpiv-core/advisor.ts  # MODIFY — add config infrastructure, restoration, save calls, effort picker fix
extensions/rpiv-core/index.ts    # MODIFY — wire restoreAdvisorState into session_start handler
```

## Ordering Constraints

- Slice 1 (config infrastructure) must come first — all other slices depend on it
- Slices 2, 3, 4 are independent of each other but all depend on Slice 1
- Slice 2 (session restoration) is the highest-value slice and should come second

## Verification Notes

- **Manual test**: Set advisor model + effort → quit Pi → restart Pi → confirm advisor is active with correct model/effort
- **Disable test**: Open `/advisor` → select "No advisor" → restart Pi → confirm advisor is off
- **Graceful degradation test**: Set advisor → edit config to use invalid model key `"nonexistent:model"` → restart Pi → confirm advisor stays off without crash
- **Effort picker test**: Set effort to "xhigh" → reopen `/advisor` → confirm effort picker pre-selects "xhigh"
- **Config file check**: `cat ~/.config/rpiv-pi/advisor.json` after setting advisor — should be valid JSON with `modelKey` and `effort` fields
- **No regression**: `grep -n "saveAdvisorConfig\|loadAdvisorConfig\|restoreAdvisorState" extensions/rpiv-core/advisor.ts extensions/rpiv-core/index.ts` — confirm all functions present

## Performance Considerations

- Config file I/O is synchronous and operates on tiny JSON (<100 bytes) — negligible impact
- `loadConfig()` runs once at session start — no hot-path concern
- `saveConfig()` runs only on user-initiated `/advisor` command interactions — no hot-path concern
- `ctx.modelRegistry.find()` is a registry lookup, not a network call — fast

## Migration Notes

Not applicable — this is a new config file. No existing data to migrate. Fresh file created on first `/advisor` enable. Absent file treated as empty config (advisor off, current default behavior).

## Pattern References

- `extensions/web-tools/index.ts:32-56` — Config persistence pattern (loadConfig/saveConfig) — the template to follow
- `extensions/rpiv-core/todo.ts:501-511` — Session-entry reconstruction (what NOT to use — session-bound, not cross-session)
- `extensions/rpiv-core/package-checks.ts:15-30` — Extension reading from `~/.pi/agent/` (proves extensions can access global config paths)

## Developer Context

**Q (config scope): Should advisor config be global, per-project, or layered?**
A: Global only — `~/.config/rpiv-pi/advisor.json`. Matches web-tools pattern, simple, user sets once.

(Earlier checkpoint approved design with zero additional ambiguities — all dimensions resolved as simple decisions from research evidence.)

## Design History

- Slice 1: Config infrastructure — approved as generated
- Slice 2: Session restoration — approved as generated
- Slice 3: Save-on-change — approved as generated
- Slice 4: Effort picker fix — approved as generated

## References

- Research artifact: `thoughts/shared/research/2026-04-12_11-57-02_advisor-settings-persistence.md`
- Research questions: `thoughts/shared/questions/2026-04-12_11-29-50_advisor-settings-persistence.md`
- Original advisor design: `thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md`
