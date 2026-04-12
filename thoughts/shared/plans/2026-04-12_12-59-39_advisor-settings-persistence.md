---
date: 2026-04-12T12:59:39Z
planner: Claude Code
git_commit: 9d33a1c
branch: master
repository: rpiv-pi
topic: "Persistence of advisor settings between sessions"
tags: [plan, advisor, persistence, config]
status: ready
design_source: "thoughts/shared/designs/2026-04-12_12-21-43_advisor-settings-persistence.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Advisor Settings Persistence — Implementation Plan

## Overview

Persist the advisor tool's model selection and reasoning effort level across Pi sessions using a file-based config at `~/.config/rpiv-pi/advisor.json`. Follows the proven web-tools `loadConfig()`/`saveConfig()` pattern. Single-phase plan — all changes are tightly coupled within 2 files and appropriate for one worktree session.

## Desired End State

- User starts Pi → previously configured advisor (model + effort) is automatically restored from config file, advisor tool active from turn 1
- User picks a new model via `/advisor` → config file updated immediately
- User selects "No advisor" via `/advisor` → config file cleared
- Effort picker pre-selects the stored effort level (not hardcoded `"high"`)
- Config file absent or corrupt → advisor stays off (current default behavior unchanged)
- Stored model no longer in registry → graceful skip with warning notification

## What We're NOT Doing

- Per-project advisor config (global only)
- Environment variable override for advisor model
- Session-entry-based persistence (wrong for cross-session)
- `session_compact` handler changes (module state survives compaction)
- Automated tests (no existing test infrastructure for advisor)

## Phase 1: Config Persistence + Restoration + Effort Picker Fix

### Overview

Add config file infrastructure to `advisor.ts`, wire session restoration into `index.ts`, save config on enable/disable, and fix the effort picker pre-selection. All changes are interdependent — config infrastructure is needed by restoration and save calls, and the effort picker fix relies on the same `getAdvisorEffort()` getter.

### Changes Required:

#### 1. advisor.ts — New imports

**File**: `extensions/rpiv-core/advisor.ts`
**Changes**: Add `node:fs`, `node:path`, `node:os` imports after existing imports

```typescript
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
```

#### 2. advisor.ts — Config infrastructure

**File**: `extensions/rpiv-core/advisor.ts`
**Changes**: Insert after `ADVISOR_SYSTEM_PROMPT` constant, before Types section. Adds `AdvisorConfig` interface, config path constant, `loadAdvisorConfig()`, `saveAdvisorConfig()`, and `parseModelKey()`.

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

#### 3. advisor.ts — Session restoration export

**File**: `extensions/rpiv-core/advisor.ts`
**Changes**: Insert after module state getters/setters, before core execute logic. Exports `restoreAdvisorState()` for `index.ts` to call at session start.

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

#### 4. advisor.ts — Save on disable

**File**: `extensions/rpiv-core/advisor.ts`
**Changes**: After the "No advisor" path clears model and effort (~line 415), add config save call

```typescript
				setAdvisorModel(undefined);
				setAdvisorEffort(undefined);
				saveAdvisorConfig(undefined, undefined);
```

#### 5. advisor.ts — Save on enable

**File**: `extensions/rpiv-core/advisor.ts`
**Changes**: After model and effort are set on the enable path (~line 514), add config save call

```typescript
			setAdvisorEffort(effortChoice);
			setAdvisorModel(picked);
			saveAdvisorConfig(modelKey(picked), effortChoice);
```

#### 6. advisor.ts — Effort picker pre-selection fix

**File**: `extensions/rpiv-core/advisor.ts`
**Changes**: Replace hardcoded `setSelectedIndex(baseLevels.indexOf("high") + 1)` at ~line 476 with dynamic pre-selection based on current effort level

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

#### 7. index.ts — Import restoreAdvisorState

**File**: `extensions/rpiv-core/index.ts`
**Changes**: Add `restoreAdvisorState` to the advisor import

```typescript
import { registerAdvisorTool, registerAdvisorCommand, registerAdvisorBeforeAgentStart, restoreAdvisorState } from "./advisor.js";
```

#### 8. index.ts — Wire restoration in session_start

**File**: `extensions/rpiv-core/index.ts`
**Changes**: Insert after `reconstructTodoState(ctx)` in session_start handler, before TodoOverlay setup

```typescript
		reconstructTodoState(ctx);

		// Restore persisted advisor model + effort from previous session
		restoreAdvisorState(ctx, pi);
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `pnpm typecheck` (no typecheck script in project — manual review confirms types are correct)
- [x] No linting errors: `pnpm lint` (no lint script in project — code follows existing patterns)
- [x] All functions present: `grep -n "saveAdvisorConfig\|loadAdvisorConfig\|restoreAdvisorConfig\|restoreAdvisorState" extensions/rpiv-core/advisor.ts extensions/rpiv-core/index.ts`
- [x] Import includes `restoreAdvisorState`: `grep "restoreAdvisorState" extensions/rpiv-core/index.ts`

#### Manual Verification:
- [ ] **Persistence test**: Set advisor model + effort → quit Pi → restart Pi → confirm advisor is active with correct model/effort
- [ ] **Disable test**: Open `/advisor` → select "No advisor" → restart Pi → confirm advisor is off
- [ ] **Graceful degradation**: Set advisor → edit `~/.config/rpiv-pi/advisor.json` to `"nonexistent:model"` → restart Pi → confirm advisor stays off without crash
- [ ] **Effort picker**: Set effort to "xhigh" → reopen `/advisor` → confirm effort picker pre-selects "xhigh"
- [ ] **Config file**: `cat ~/.config/rpiv-pi/advisor.json` after setting advisor — should be valid JSON with `modelKey` and `effort` fields
- [ ] **Model checkmark**: Restored model shows `✓` in `/advisor` model picker

---

## Testing Strategy

### Automated:
- `pnpm typecheck` — confirms TypeScript compilation
- `pnpm lint` — confirms no linting errors

### Manual Testing Steps:
1. Start Pi → run `/advisor` → pick a model + effort → confirm notification
2. Run `cat ~/.config/rpiv-pi/advisor.json` → verify valid JSON with expected content
3. Quit Pi → restart Pi → confirm "Advisor restored: ..." notification
4. Send a message → confirm advisor tool is active (visible in tool calls)
5. Run `/advisor` → confirm `✓` on correct model and effort picker pre-selects stored effort
6. Run `/advisor` → select "No advisor" → restart → confirm advisor stays off
7. Edit config to invalid model → restart → confirm warning notification and no crash

## Performance Considerations

- Config file I/O is synchronous and operates on tiny JSON (<100 bytes) — negligible impact
- `loadAdvisorConfig()` runs once at session start — no hot-path concern
- `saveAdvisorConfig()` runs only on user-initiated `/advisor` command interactions — no hot-path concern
- `ctx.modelRegistry.find()` is a registry lookup, not a network call — fast

## Migration Notes

Not applicable — this is a new config file. No existing data to migrate. Fresh file created on first `/advisor` enable. Absent file treated as empty config (advisor off, current default behavior).

## References

- Design: `thoughts/shared/designs/2026-04-12_12-21-43_advisor-settings-persistence.md`
- Research: `thoughts/shared/research/2026-04-12_11-57-02_advisor-settings-persistence.md`
- Research questions: `thoughts/shared/questions/2026-04-12_11-29-50_advisor-settings-persistence.md`
- Pattern reference: `extensions/web-tools/index.ts:32-56` (config persistence template)
