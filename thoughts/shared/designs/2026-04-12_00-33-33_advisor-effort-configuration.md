---
date: 2026-04-12T00:33:33-04:00
designer: Claude Code
git_commit: 26f9c58
branch: master
repository: rpiv-pi
topic: "Advisor effort/reasoning level configuration"
tags: [design, advisor, thinking-level, completeSimple, rpiv-core]
status: complete
research_source: "thoughts/shared/research/2026-04-12_00-10-57_advisor-effort-configuration.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Design: Advisor Effort/Reasoning Level Configuration

## Summary

Add effort/reasoning-level configuration to the advisor tool. A new module-state variable `selectedAdvisorEffort: ThinkingLevel | undefined` is plumbed into `completeSimple()`'s `reasoning` field (currently unfilled, disabling thinking on every call). A sequential `ctx.ui.custom` effort-picker panel appears after the model picker in the `/advisor` command, filtered by model capabilities (`model.reasoning`, `supportsXhigh`). Effort defaults to `"high"` and resets on every model change.

## Requirements

- Wire reasoning level into the `completeSimple()` call so advisor models can use extended thinking
- Default to `"high"` effort for reasoning-capable models (aligns with advisor's purpose of stronger judgment)
- Reset effort to `"high"` on every model change (clean slate, no silent downgrades)
- Show effort picker UI after model selection (sequential-await pattern)
- Filter available effort levels per-model: skip picker if `!model.reasoning`, include `"xhigh"` only if `supportsXhigh(model)`
- Surface effort in `onUpdate` status text and `AdvisorDetails` interface
- Keep all changes within `advisor.ts` — no new files, no `index.ts` changes

## Current State Analysis

The advisor's `completeSimple()` call at `advisor.ts:148-152` passes `{ apiKey, headers, signal }` with no `reasoning` field. Every pi-ai provider interprets this as "disable thinking." The original design chose `completeSimple()` specifically for its `reasoning?: ThinkingLevel` support but never wired it in — a silently-unfilled slot.

### Key Discoveries

- `completeSimple` options accept `reasoning?: ThinkingLevel` at `types.d.ts:65-69` — slot exists, just not filled
- `ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh"` at `types.d.ts:7` — no `"off"` value; `undefined` serves that role
- `supportsXhigh` re-exported from `@mariozechner/pi-ai` main entry via `index.d.ts:5 → models.js:37-45`
- `Model.reasoning: boolean` at `types.d.ts:282` — required boolean capability flag
- Module state pattern at `advisor.ts:66-74`: `let selectedAdvisor` + exported getter/setter
- Sequential-await panel pattern at `ask-user-question.ts:60-106` and `advisor.ts:308-366`
- `buildErrorResult` at `advisor.ts:80-91` is the centralized error helper — must include effort field
- Provider-level clamping (`clampReasoning` at `simple-options.js:15`) silently downgrades xhigh→high for non-xhigh models
- Tool registration is static (`pi.registerTool` accepts `string`) — cannot dynamically reflect effort

## Scope

### Building

- Module-state variable `selectedAdvisorEffort` with getter/setter
- `reasoning: getAdvisorEffort()` plumbed into `completeSimple()` options
- `effort?: ThinkingLevel` field on `AdvisorDetails`, populated in every return path
- Updated `onUpdate` status text: `Consulting advisor (${advisorLabel}, ${effortLabel})…`
- Effort picker UI panel (sequential await after model picker) with capability filtering
- Effort reset to `"high"` on model change; `undefined` on "No advisor" or non-reasoning model

### Not Building

- Tests (none exist for advisor module — no new test infrastructure)
- Dynamic tool description update (registration is static)
- `ThinkingSelectorComponent` reuse (uses different theme system, visual inconsistency)
- `"off"` option in effort picker for reasoning-capable models (advisor purpose = stronger judgment; minimum is "minimal")
- Changes to `index.ts` or any other file

## Decisions

### Default effort level

The advisor's purpose is stronger judgment. `"high"` aligns with this — model self-allocates thinking tokens (Anthropic adaptive mode) or gets a generous budget (Google 32k tokens). Developer confirmed during research checkpoint.

### Carry-over on model change

Reset to `"high"` on every model change. Clean slate, predictable, no silent downgrades. Avoids the edge case where `"xhigh"` from Opus carries to a Sonnet model that doesn't support it. Provider clamping exists as a safety net but the UI should not rely on it.

### UI pattern — sequential await

Pick model → pick effort. Second `await ctx.ui.custom()` call using identical `Container` + `DynamicBorder` + `SelectList` skeleton as the model picker. Cancel at either step aborts the entire flow.

### Surfacing effort

`onUpdate` status text includes effort label. `AdvisorDetails.effort` field populated in every return path (success, error, abort, empty). Tool description stays static — effort conveyed via result text that goes back to the executor.

### No "off" for reasoning-capable models

The effort picker for reasoning-capable models shows `"minimal"` through `"high"` (+ `"xhigh"` if supported). No explicit "off" option. If a model supports reasoning, the advisor uses it. Non-reasoning models get `undefined` automatically.

### Import strategy

`supportsXhigh` (value import) and `ThinkingLevel` (type import) from `@mariozechner/pi-ai`. Both confirmed re-exported from the main entry point. Added to existing import lines.

## Architecture

### extensions/rpiv-core/advisor.ts:15-16 — MODIFY

Import additions: add `supportsXhigh` (value) and `type ThinkingLevel` to existing pi-ai import.

```typescript
import { completeSimple, supportsXhigh, type Message, type ThinkingLevel } from "@mariozechner/pi-ai";
import type { Api, Model, StopReason, Usage } from "@mariozechner/pi-ai";
```

### extensions/rpiv-core/advisor.ts:55-60 — MODIFY

AdvisorDetails interface: add `effort?: ThinkingLevel` field after `advisorModel`.

```typescript
export interface AdvisorDetails {
	advisorModel?: string;
	effort?: ThinkingLevel;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}
```

### extensions/rpiv-core/advisor.ts:66-74 — MODIFY

Module state: add `selectedAdvisorEffort` variable + exported getter/setter pair after existing model state.

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

### extensions/rpiv-core/advisor.ts:80-91 — MODIFY

buildErrorResult: capture effort via `getAdvisorEffort()`, include in both ternary branches.

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

### extensions/rpiv-core/advisor.ts:106+142-145 — MODIFY

Add `effort` local after `advisorLabel`. Update onUpdate status text to include effort label conditionally.

```typescript
	const advisorLabel = `${advisor.provider}:${advisor.id}`;
	const effort = getAdvisorEffort();

	// ... (auth checks and context building unchanged) ...

	onUpdate?.({
		content: [{ type: "text", text: `Consulting advisor (${advisorLabel}${effort ? `, ${effort}` : ""})…` }],
		details: { advisorModel: advisorLabel, effort },
	});
```

### extensions/rpiv-core/advisor.ts:148-152 — MODIFY

completeSimple call: add `reasoning: effort` to options object.

```typescript
		const response = await completeSimple(
			advisor,
			{ systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [userMessage] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort },
		);
```

### extensions/rpiv-core/advisor.ts:154-210 — MODIFY

All 4 inline return paths in executeAdvisor: add `effort` to every `details` object.

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

### extensions/rpiv-core/advisor.ts:279 — MODIFY

New constants for the effort picker panel, added after `NO_ADVISOR_VALUE`.

```typescript
const EFFORT_HEADER_TITLE = "Reasoning Level";

const EFFORT_HEADER_PROSE =
	"Choose the reasoning effort level for the advisor. " +
	"Higher levels produce stronger judgment but use more tokens.";
```

### extensions/rpiv-core/advisor.ts:375-399 — MODIFY

/advisor command: reset effort on "No advisor", add effort picker after model validation, wire state, update notify text.

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

## Desired End State

After this change, the `/advisor` command flow becomes:

```typescript
// User runs /advisor
// Panel 1: Pick advisor model (existing)
// Panel 2: Pick effort level (new — only for reasoning-capable models)

// The advisor tool now uses thinking:
const response = await completeSimple(
  advisor,
  { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [userMessage] },
  { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: "high" },
);

// Status text shows effort:
// "Consulting advisor (anthropic:claude-opus-4-6, high)…"

// AdvisorDetails includes effort:
// { advisorModel: "anthropic:claude-opus-4-6", effort: "high", usage: {...}, stopReason: "end_turn" }
```

## File Map

```
extensions/rpiv-core/advisor.ts  # MODIFY — effort state, UI picker, completeSimple wiring, details population
```

## Ordering Constraints

- Slice 1 (types & state) must come before Slice 2 (execute logic) and Slice 3 (UI)
- Slice 2 and Slice 3 are independent of each other but both depend on Slice 1
- All slices modify the same file — sequential generation required

## Verification Notes

- After implementation, run `/advisor` and select a reasoning-capable model → effort picker should appear with levels filtered by capability
- Select a non-reasoning model → effort picker should NOT appear
- Select "No advisor" → effort should reset to undefined
- Check `onUpdate` text during advisor call includes effort label
- Verify `AdvisorDetails.effort` is populated in tool result details
- All new strings must be model-agnostic (lesson from commit `26f9c58`)

## Performance Considerations

No client-side performance concerns. The effort setting is a one-time selection, not a hot path. Provider-side implications: `"high"` on Anthropic Opus uses adaptive thinking (model-controlled budget); on Google Gemini 2.5 Pro uses 32k-token budget (vs 8k for `"medium"`). These are expected cost trade-offs aligned with the advisor's purpose.

## Migration Notes

None — no persisted schema, no backwards compatibility concerns. Module state is in-memory and resets each session.

## Pattern References

- `extensions/rpiv-core/advisor.ts:66-74` — module state getter/setter pattern (model after for effort state)
- `extensions/rpiv-core/advisor.ts:308-366` — model-picker ctx.ui.custom panel (template for effort picker)
- `extensions/rpiv-core/advisor.ts:80-91` — buildErrorResult centralized error helper (extend with effort field)
- `extensions/rpiv-core/ask-user-question.ts:60-106` — sequential-await precedent (ctx.ui.custom then follow-up)

## Developer Context

**Research checkpoint (inherited)**:
**Q (`advisor.ts:148-152`): completeSimple() has no reasoning field — thinking is disabled on every call. What should the default effort be for a newly-selected reasoning-capable advisor?**
A: "high" — aligns with the advisor's purpose of stronger judgment.

**Q (`simple-options.js:15`, `advisor.ts:284-400`): When user switches advisor model, should effort reset or carry over (with silent clamping of xhigh→high)?**
A: Reset to "high" on every model change. Clean slate, predictable, no silent downgrades.

**Q (`advisor.ts:308-366`): Should the /advisor command show a second panel for effort after model pick?**
A: Yes — sequential await pattern: pick model → pick effort. Inline SelectList matching model-picker theme.

**Q (`advisor.ts:142-145`, `advisor.ts:55-60`): Should effort appear in onUpdate status text and/or AdvisorDetails?**
A: Both — status text shows effort and new `effort?: ThinkingLevel` field on AdvisorDetails populated in every result path. Tool description stays static.

**Design checkpoint**: Approved design summary and 3-slice decomposition without changes.

## Design History

- Slice 1: Types & State — approved as generated
- Slice 2: Execute Logic — approved as generated
- Slice 3: UI Effort Picker — approved as generated

## References

- Research: `thoughts/shared/research/2026-04-12_00-10-57_advisor-effort-configuration.md`
- Questions: `thoughts/shared/questions/2026-04-11_23-32-53_advisor-effort-configuration.md`
- Original advisor design: `thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md`
- Precedent commits: `e4e03ab` (advisor creation), `26f9c58` (model-agnostic strings), `e7e5d20` (custom overlay), `33550c5` (todo Details pattern)
