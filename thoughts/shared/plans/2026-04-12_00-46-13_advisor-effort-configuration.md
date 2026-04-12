---
date: 2026-04-12T00:46:13-04:00
planner: Claude Code
git_commit: 26f9c58
branch: master
repository: rpiv-pi
topic: "Advisor effort/reasoning level configuration"
tags: [plan, advisor, thinking-level, completeSimple, rpiv-core]
status: ready
design_source: "thoughts/shared/designs/2026-04-12_00-33-33_advisor-effort-configuration.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Advisor Effort/Reasoning Level Configuration — Implementation Plan

## Overview

Wire reasoning-level configuration into the advisor tool so models can use extended thinking. A new module-state variable `selectedAdvisorEffort` is plumbed into `completeSimple()`'s `reasoning` field (currently unfilled). A sequential `ctx.ui.custom` effort-picker panel appears after the model picker in `/advisor`, filtered by model capabilities. Effort defaults to `"high"` and resets on every model change.

Design: `thoughts/shared/designs/2026-04-12_00-33-33_advisor-effort-configuration.md`

## Desired End State

After implementation, the `/advisor` command flow becomes: pick model → pick effort (for reasoning-capable models). The `completeSimple()` call includes the selected effort level. Status text shows `Consulting advisor (provider:model, high)…`. `AdvisorDetails.effort` is populated in every return path. Non-reasoning models skip the effort picker and get `undefined`. "No advisor" resets effort to `undefined`.

## What We're NOT Doing

- Tests (none exist for advisor module — no new test infrastructure)
- Dynamic tool description update (registration is static)
- `ThinkingSelectorComponent` reuse (uses different theme system)
- `"off"` option in effort picker for reasoning-capable models
- Changes to `index.ts` or any other file

## Phase 1: Advisor Effort Configuration

### Overview
All changes in `advisor.ts`: add imports, module state, wire reasoning into `completeSimple()`, populate effort in all return paths, add effort picker UI after model picker.

### Changes Required:

#### 1. Imports
**File**: `extensions/rpiv-core/advisor.ts` (lines 15-16)
**Changes**: Add `supportsXhigh` (value) and `type ThinkingLevel` to existing pi-ai import.

```typescript
import { completeSimple, supportsXhigh, type Message, type ThinkingLevel } from "@mariozechner/pi-ai";
import type { Api, Model, StopReason, Usage } from "@mariozechner/pi-ai";
```

#### 2. AdvisorDetails interface
**File**: `extensions/rpiv-core/advisor.ts` (lines 55-60)
**Changes**: Add `effort?: ThinkingLevel` field after `advisorModel`.

```typescript
export interface AdvisorDetails {
	advisorModel?: string;
	effort?: ThinkingLevel;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}
```

#### 3. Module state
**File**: `extensions/rpiv-core/advisor.ts` (lines 66-74)
**Changes**: Add `selectedAdvisorEffort` variable + exported getter/setter pair after existing model state.

```typescript
let selectedAdvisor: Model<Api> | undefined;
let selectedAdvisorEffort: ThinkingLevel | undefined;

export function getAdvisorModel(): Model<Api> | undefined {
	return selectedAdvisor;
}

export function setAdvisorModel(model: Model<Api> | undefined): void {
	selectedAdvisor = model;
}

export function getAdvisorEffort(): ThinkingLevel | undefined {
	return selectedAdvisorEffort;
}

export function setAdvisorEffort(effort: ThinkingLevel | undefined): void {
	selectedAdvisorEffort = effort;
}
```

#### 4. buildErrorResult
**File**: `extensions/rpiv-core/advisor.ts` (lines 80-91)
**Changes**: Capture effort via `getAdvisorEffort()`, include in both ternary branches of the details object.

```typescript
function buildErrorResult(
	advisorLabel: string | undefined,
	userText: string,
	errorMessage: string,
): AgentToolResult<AdvisorDetails> {
	const effort = getAdvisorEffort();
	return {
		content: [{ type: "text", text: userText }],
		details: advisorLabel
			? { advisorModel: advisorLabel, effort, errorMessage }
			: { effort, errorMessage },
	};
}
```

#### 5. Execute logic — effort local + onUpdate
**File**: `extensions/rpiv-core/advisor.ts` (lines 106, 142-145)
**Changes**: Add `effort` local after `advisorLabel`. Update `onUpdate` status text to include effort label conditionally.

```typescript
	const advisorLabel = `${advisor.provider}:${advisor.id}`;
	const effort = getAdvisorEffort();

	// ... (auth checks and context building unchanged) ...

	onUpdate?.({
		content: [{ type: "text", text: `Consulting advisor (${advisorLabel}${effort ? `, ${effort}` : ""})…` }],
		details: { advisorModel: advisorLabel, effort },
	});
```

#### 6. Execute logic — completeSimple call
**File**: `extensions/rpiv-core/advisor.ts` (lines 148-152)
**Changes**: Add `reasoning: effort` to `completeSimple()` options object.

```typescript
		const response = await completeSimple(
			advisor,
			{ systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [userMessage] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort },
		);
```

#### 7. Execute logic — all 4 return paths
**File**: `extensions/rpiv-core/advisor.ts` (lines 154-210)
**Changes**: Add `effort` to every `details` object in the 4 inline return paths (aborted, error, empty, success).

```typescript
		if (response.stopReason === "aborted") {
			return {
				content: [
					{ type: "text", text: "Advisor call was cancelled before it completed." },
				],
				details: {
					advisorModel: advisorLabel,
					effort,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: response.errorMessage ?? "aborted",
				},
			};
		}

		if (response.stopReason === "error") {
			return {
				content: [
					{
						type: "text",
						text: `Advisor call failed: ${response.errorMessage ?? "unknown error"}`,
					},
				],
				details: {
					advisorModel: advisorLabel,
					effort,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: response.errorMessage,
				},
			};
		}

		const advisorText = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		if (!advisorText) {
			return {
				content: [{ type: "text", text: "Advisor returned no text content." }],
				details: {
					advisorModel: advisorLabel,
					effort,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: "empty response",
				},
			};
		}

		return {
			content: [{ type: "text", text: advisorText }],
			details: {
				advisorModel: advisorLabel,
				effort,
				usage: response.usage,
				stopReason: response.stopReason,
			},
		};
```

#### 8. Effort picker constants + UI panel
**File**: `extensions/rpiv-core/advisor.ts` (lines 279, 375-399)
**Changes**: Add `EFFORT_HEADER_TITLE` and `EFFORT_HEADER_PROSE` constants. In `/advisor` command handler: reset effort on "No advisor", add effort picker panel (sequential await after model picker) with capability filtering, wire state, update notify text.

Constants (after `NO_ADVISOR_VALUE`):

```typescript
const EFFORT_HEADER_TITLE = "Reasoning Level";

const EFFORT_HEADER_PROSE =
	"Choose the reasoning effort level for the advisor. " +
	"Higher levels produce stronger judgment but use more tokens.";
```

Command handler — "No advisor" branch (reset effort):

```typescript
			if (choice === NO_ADVISOR_VALUE) {
				setAdvisorModel(undefined);
				setAdvisorEffort(undefined);
				if (activeHas) {
					pi.setActiveTools(
						activeTools.filter((n) => n !== ADVISOR_TOOL_NAME),
					);
				}
				ctx.ui.notify("Advisor disabled", "info");
				return;
			}
```

Command handler — effort picker after model validation + state wiring + notify:

```typescript
			const picked = availableModels.find((m) => modelKey(m) === choice);
			if (!picked) {
				ctx.ui.notify(`Advisor selection not found: ${choice}`, "error");
				return;
			}

			// Effort picker — only for reasoning-capable models
			let effortChoice: ThinkingLevel | undefined;
			if (picked.reasoning) {
				const baseLevels: ThinkingLevel[] = ["minimal", "low", "medium", "high"];
				const levels = supportsXhigh(picked)
					? [...baseLevels, "xhigh" as ThinkingLevel]
					: baseLevels;

				const effortItems: SelectItem[] = levels.map((level) => ({
					value: level,
					label: level === "high" ? `${level}  (recommended)` : level,
				}));

				const effortResult = await ctx.ui.custom<string | null>(
					(tui, theme, _kb, done) => {
						const container = new Container();

						container.addChild(
							new DynamicBorder((s: string) => theme.fg("accent", s)),
						);
						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								theme.fg("accent", theme.bold(EFFORT_HEADER_TITLE)),
								1,
								0,
							),
						);
						container.addChild(new Spacer(1));
						container.addChild(new Text(EFFORT_HEADER_PROSE, 1, 0));
						container.addChild(new Spacer(1));

						const selectList = new SelectList(
							effortItems,
							Math.min(effortItems.length, 10),
							{
								selectedPrefix: (t) => theme.bg("selectedBg", theme.fg("accent", t)),
								selectedText: (t) => theme.bg("selectedBg", theme.bold(t)),
								description: (t) => theme.fg("muted", t),
								scrollInfo: (t) => theme.fg("dim", t),
								noMatch: (t) => theme.fg("warning", t),
							},
						);
						selectList.onSelect = (item) => done(item.value);
						selectList.onCancel = () => done(null);
						container.addChild(selectList);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
								1,
								0,
							),
						);
						container.addChild(new Spacer(1));
						container.addChild(
							new DynamicBorder((s: string) => theme.fg("accent", s)),
						);

						return {
							render: (w) => container.render(w),
							invalidate: () => container.invalidate(),
							handleInput: (data) => {
								selectList.handleInput(data);
								tui.requestRender();
							},
						};
					},
				);

				if (!effortResult) {
					return;
				}
				effortChoice = effortResult as ThinkingLevel;
			}

			setAdvisorEffort(effortChoice);
			setAdvisorModel(picked);
			if (!activeHas) {
				pi.setActiveTools([...activeTools, ADVISOR_TOOL_NAME]);
			}
			ctx.ui.notify(
				`Advisor set to ${picked.name} (${picked.provider}${effortChoice ? `, ${effortChoice}` : ""})`,
				"info",
			);
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `pnpm typecheck` (no local tsc — verify at runtime)
- [ ] Linting passes: `pnpm lint` (no local lint — verify at runtime)
- [x] `grep -c 'effort' extensions/rpiv-core/advisor.ts` returns matches for all wiring points (24 matches)
- [x] `grep 'reasoning:' extensions/rpiv-core/advisor.ts` confirms completeSimple receives the effort

#### Manual Verification:
- [ ] Run `/advisor`, select a reasoning-capable model → effort picker appears with levels filtered by capability
- [ ] Select a non-reasoning model → effort picker does NOT appear
- [ ] Select "No advisor" → effort resets to undefined
- [ ] During advisor call, `onUpdate` text includes effort label (e.g., "Consulting advisor (anthropic:claude-opus-4-6, high)…")
- [ ] `AdvisorDetails.effort` is populated in tool result details
- [ ] All new strings are model-agnostic (lesson from commit `26f9c58`)
- [ ] Cancel at effort picker step aborts the entire flow (no model change)

---

## Testing Strategy

### Automated:
- `pnpm typecheck` — confirms ThinkingLevel import, effort field on AdvisorDetails, getter/setter types
- `pnpm lint` — confirms code style compliance

### Manual Testing Steps:
1. Run `/advisor` and select a reasoning-capable model (e.g., Opus 4.6) — verify effort picker appears with levels up to `"xhigh"`
2. Select `"high"` effort → verify notify text shows model and effort
3. Trigger advisor tool call → verify status text includes effort label
4. Run `/advisor` again, select a model without xhigh support → verify `"xhigh"` is not listed
5. Run `/advisor`, select a non-reasoning model → verify effort picker is skipped entirely
6. Run `/advisor`, select "No advisor" → verify advisor is disabled and effort is cleared
7. Run `/advisor`, pick model, then press Esc at effort picker → verify flow aborts cleanly (no model change)

## Performance Considerations

No client-side performance concerns. The effort setting is a one-time selection, not a hot path. Provider-side implications: `"high"` on Anthropic Opus uses adaptive thinking (model-controlled budget); on Google Gemini 2.5 Pro uses 32k-token budget (vs 8k for `"medium"`). These are expected cost trade-offs aligned with the advisor's purpose.

## Migration Notes

None — no persisted schema, no backwards compatibility concerns. Module state is in-memory and resets each session.

## References

- Design: `thoughts/shared/designs/2026-04-12_00-33-33_advisor-effort-configuration.md`
- Research: `thoughts/shared/research/2026-04-12_00-10-57_advisor-effort-configuration.md`
- Questions: `thoughts/shared/questions/2026-04-11_23-32-53_advisor-effort-configuration.md`
- Precedent commits: `e4e03ab` (advisor creation), `26f9c58` (model-agnostic strings), `e7e5d20` (custom overlay), `33550c5` (todo Details pattern)
