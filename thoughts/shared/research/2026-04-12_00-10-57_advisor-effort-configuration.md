---
date: 2026-04-12T00:10:57-04:00
researcher: Claude Code
git_commit: 26f9c58
branch: master
repository: rpiv-pi
topic: "Advisor effort/reasoning level configuration"
tags: [research, codebase, advisor, thinking-level, completeSimple, rpiv-core]
status: complete
questions_source: "thoughts/shared/questions/2026-04-11_23-32-53_advisor-effort-configuration.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Research: Advisor Effort/Reasoning Level Configuration

## Research Question
The advisor tool calls `completeSimple()` with no `reasoning` field, effectively disabling thinking on every call regardless of model capability. Questions: (a) which effort is set by default, (b) how to change the effort of the selected model.

## Summary

The advisor's `completeSimple()` call at `advisor.ts:148-152` passes `{ apiKey, headers, signal }` with no `reasoning` field. Every pi-ai provider interprets this as "disable thinking": Anthropic sets `thinking: { type: "disabled" }`, OpenAI sets `reasoning: { effort: "none" }`, Google sets `thinking: { enabled: false }`. This was a silently-unfilled slot — the original design chose `completeSimple()` specifically for its `reasoning?: ThinkingLevel` support but never wired it in. There is no mechanism to configure or change the effort level.

The fix requires: (1) a companion module-state variable `selectedAdvisorEffort: ThinkingLevel | undefined`, (2) plumbing it into the `reasoning` field of the `completeSimple()` options, and (3) a UI step in the `/advisor` command to select effort after model selection.

## Detailed Findings

### Current Default: Thinking Disabled

When `completeSimple()` is called without `reasoning`, the dispatch at `stream.js:19-21` forwards `undefined` to each provider's `streamSimple*` function:

- **Anthropic** (`anthropic.js:387`): `!options?.reasoning` guard sends `thinkingEnabled: false` → `buildParams` at line 512 sets `thinking: { type: "disabled" }`. Opus 4.6 loses all extended thinking capability.
- **OpenAI Responses** (`openai-responses.js:100`): `reasoningEffort` resolves to `undefined` → `buildParams` at line 164 sets `reasoning: { effort: "none" }`.
- **Google** (`google.js:222`): sends `thinking: { enabled: false }` → Gemini 2.x gets `thinkingBudget: 0`; Gemini 3 Pro/Flash get `thinkingLevel: "LOW"/"MINIMAL"` (cannot fully disable).
- **Mistral** (`mistral.js:66-69`): `promptMode` becomes `undefined`, no reasoning mode at all.

### Module State Design

The advisor module state at `advisor.ts:66` is a single `let selectedAdvisor: Model<Api> | undefined` with getter/setter at lines 68-74. Adding effort requires a parallel variable:

```
let selectedAdvisorEffort: ThinkingLevel | undefined
```

The type must be `ThinkingLevel | undefined` (from `pi-ai/types.d.ts:7`: `"minimal" | "low" | "medium" | "high" | "xhigh"`), **not** including `"off"`. The `"off"` string is an agent-session UI concept (at `agent-session.js:54`) that is translated to `undefined` at `agent.js:278` before reaching pi-ai. The advisor calls `completeSimple` directly, bypassing that translation layer, so `undefined` serves the "no thinking" role.

### Provider Cost Implications of `"high"`

When `reasoning: "high"` is passed:
- **Anthropic Opus 4.6**: `mapThinkingLevelToEffort("high")` at `anthropic.js:373` → `thinking: { type: "adaptive" }, output_config: { effort: "high" }`. Adaptive thinking — model self-allocates tokens.
- **Google Gemini 2.5 Pro**: `getGoogleBudget` at `google.js:359` → 32768-token thinking budget. Fixed ceiling.
- **Google Gemini 2.5 Flash**: `google.js:369` → 24576-token thinking budget.
- **OpenAI**: `reasoning: { effort: "high" }` passed directly.

Compared to `"medium"`: Google budgets are 8192 tokens (4x less for Pro, 3x less for Flash). Anthropic difference is model-controlled and not precisely predictable but "high" produces substantially more thinking tokens on complex prompts.

### UI Selector: Inline SelectList Panel

The effort selector should be a second `ctx.ui.custom` panel (sequential-await pattern after the model picker at `advisor.ts:308`), using an inline `SelectList` matching the existing model-picker's theme:

- Uses `theme` parameter from `ctx.ui.custom` (DynamicBorder with `theme.fg("accent")`, SelectList with `selectedBg` background)
- `ThinkingSelectorComponent` from pi-coding-agent (`thinking-selector.js:19`) was considered but rejected: it uses `getSelectListTheme()` from pi-coding-agent's internal theme (no `selectedBg`, uses `fg("border")` for borders), producing visual inconsistency with the model-picker panel

### Capability Filtering for the Effort Picker

The effort picker must filter levels per-model:
- Check `model.reasoning: boolean` (`types.d.ts:282`) — if false, skip the effort picker entirely
- Check `supportsXhigh(model)` (`models.js:37-45`, checks for `gpt-5.2`/`gpt-5.3`/`gpt-5.4` or `opus-4-6`/`opus-4.6`) — if true, include `"xhigh"` in the list

`getAvailableThinkingLevels()` at `agent-session.js:1161` only reads the executor model (bound to `this.model`), not arbitrary models. The advisor must import `supportsXhigh` directly from `@mariozechner/pi-ai` (already a dependency at `advisor.ts:15-16`).

### Surfacing Effort

- **onUpdate text** at `advisor.ts:142-145`: change to `Consulting advisor (${advisorLabel}, ${effortLabel})…`
- **AdvisorDetails** at `advisor.ts:55-60`: add `effort?: ThinkingLevel` field, populate in every result path (success, error, abort, empty)
- **Tool description**: `ADVISOR_DESCRIPTION` and `ADVISOR_PROMPT_SNIPPET` are static strings set at registration time — pi's `registerTool` accepts `string`, not functions. Cannot dynamically reflect effort. The effort is surfaced via the result text (which goes back to the executor) and the `AdvisorDetails` field.

## Code References

- `extensions/rpiv-core/advisor.ts:148-152` — completeSimple call with no reasoning field
- `extensions/rpiv-core/advisor.ts:66-74` — module state: selectedAdvisor + getter/setter
- `extensions/rpiv-core/advisor.ts:55-60` — AdvisorDetails interface (no effort field)
- `extensions/rpiv-core/advisor.ts:142-145` — onUpdate status text
- `extensions/rpiv-core/advisor.ts:227-233` — ADVISOR_DESCRIPTION (static)
- `extensions/rpiv-core/advisor.ts:284-400` — /advisor command handler with ctx.ui.custom panel
- `extensions/rpiv-core/advisor.ts:308-366` — model-picker panel (template for effort picker)
- `pi-ai/dist/types.d.ts:7` — ThinkingLevel type (no "off")
- `pi-ai/dist/types.d.ts:65-69` — SimpleStreamOptions with reasoning?: ThinkingLevel
- `pi-ai/dist/stream.js:19-26` — completeSimple → streamSimple dispatch
- `pi-ai/dist/providers/simple-options.js:15-16` — clampReasoning (xhigh→high)
- `pi-ai/dist/providers/simple-options.js:18-34` — adjustMaxTokensForThinking with budget table
- `pi-ai/dist/providers/anthropic.js:381-407` — streamSimpleAnthropic reasoning gate
- `pi-ai/dist/providers/anthropic.js:365-380` — mapThinkingLevelToEffort
- `pi-ai/dist/providers/anthropic.js:354-358` — supportsAdaptiveThinking
- `pi-ai/dist/providers/openai-responses.js:94-105` — streamSimpleOpenAIResponses
- `pi-ai/dist/providers/google.js:216-243` — streamSimpleGoogle reasoning gate
- `pi-ai/dist/providers/google.js:315-326` — getDisabledThinkingConfig
- `pi-ai/dist/providers/google.js:350-373` — getGoogleBudget
- `pi-ai/dist/providers/mistral.js:60-71` — streamSimpleMistral
- `pi-ai/dist/models.js:37-45` — supportsXhigh
- `pi-coding-agent/dist/core/agent-session.js:54-56` — THINKING_LEVELS / THINKING_LEVELS_WITH_XHIGH
- `pi-coding-agent/dist/core/agent-session.js:1161-1164` — getAvailableThinkingLevels (executor-only)
- `pi-coding-agent/dist/core/extensions/types.d.ts:780-781` — ExtensionAPI.getThinkingLevel()
- `pi-agent-core/dist/agent.js:278` — "off"→undefined translation boundary

## Integration Points

### Inbound References
- `extensions/rpiv-core/advisor.ts:148-152` — the completeSimple call is the single point where reasoning enters the pi-ai layer
- `extensions/rpiv-core/advisor.ts:256` — tool execute closure where pi (ExtensionAPI) is in lexical scope

### Outbound Dependencies
- `@mariozechner/pi-ai` completeSimple at `stream.js:23` — dispatches to provider.streamSimple
- `@mariozechner/pi-ai` supportsXhigh at `models.js:37` — needed for capability filtering (new import)
- `@mariozechner/pi-ai` ThinkingLevel at `types.d.ts:7` — type for the effort state variable (new import)

### Infrastructure Wiring
- `extensions/rpiv-core/index.ts:36-37` — registerAdvisorTool(pi) and registerAdvisorCommand(pi) calls (no changes needed)
- `advisor.ts:247-259` — pi.registerTool() with static description/snippet (no dynamic update mechanism)

## Architecture Insights

1. **Provider reasoning is a "simple-layer-only" concern**: `buildBaseOptions` at `simple-options.js:1-14` strips `reasoning` — it's consumed only by each provider's `streamSimple*` wrapper. Providers see translated options (`thinkingEnabled`/`effort` for Anthropic, `thinking.enabled`/`budgetTokens` for Google, `reasoningEffort` for OpenAI).

2. **Two type systems for thinking levels**: pi-ai's `ThinkingLevel` (`"minimal"|"low"|"medium"|"high"|"xhigh"`) is the API layer; agent-session's `THINKING_LEVELS` adds `"off"` for UI cycling, translated to `undefined` at `agent.js:278`. The advisor bypasses the agent loop, so it must use pi-ai's type directly.

3. **Provider-level clamping is the safety net**: `clampReasoning` converts xhigh→high for non-xhigh models. `mapThinkingLevelToEffort` does similar for Anthropic. Callers don't need their own clamping, but the effective level may differ from the requested level (silent downgrade).

4. **Tool registration is static**: `pi.registerTool()` accepts `string` for description/promptSnippet. No mechanism for dynamic update after registration. Effort information must be conveyed via result text and AdvisorDetails, not tool metadata.

## Precedents & Lessons
5 similar past changes analyzed. Key commits: `e4e03ab` (advisor creation), `26f9c58` (model-agnostic strings), `e7e5d20` (custom overlay pattern), `8610ae5` (module extraction), `33550c5` (todo tool state machine).

- The reasoning field was designed-in but never wired — this effort configuration completes the original intent, not an afterthought (`e4e03ab`)
- Same-day follow-up `26f9c58` fixed hardcoded model names — all new strings must be model-agnostic from the start
- Sequential `await ctx.ui.custom()` is the idiomatic multi-step selector pattern in rpiv-core (`e7e5d20`)
- All changes should stay inside `advisor.ts` — no new files or index.ts changes needed (`8610ae5`)
- When adding fields to a Details interface, populate in every return path: success, error, abort, empty (`33550c5`)

## Historical Context (from thoughts/)
- `thoughts/shared/questions/2026-04-11_23-32-53_advisor-effort-configuration.md` — 7 research questions driving this analysis
- `thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md` — original advisor design noting completeSimple chosen for reasoning support
- `thoughts/shared/plans/2026-04-11_14-43-28_advisor-strategy-pattern.md` — implementation plan that never included a step to wire reasoning in

## Developer Context
**Q (`advisor.ts:148-152`): completeSimple() has no reasoning field — thinking is disabled on every call. What should the default effort be for a newly-selected reasoning-capable advisor?**
A: "high" — aligns with the advisor's purpose of stronger judgment.

**Q (`simple-options.js:15`, `advisor.ts:284-400`): When user switches advisor model, should effort reset or carry over (with silent clamping of xhigh→high)?**
A: Reset to "high" on every model change. Clean slate, predictable, no silent downgrades.

**Q (`advisor.ts:308-366`): Should the /advisor command show a second panel for effort after model pick?**
A: Yes — sequential await pattern: pick model → pick effort. Inline SelectList matching model-picker theme.

**Q (`advisor.ts:142-145`, `advisor.ts:55-60`): Should effort appear in onUpdate status text and/or AdvisorDetails?**
A: Both — status text shows effort (e.g., "Consulting advisor (anthropic:claude-opus-4-6, high)…") and new `effort?: ThinkingLevel` field on AdvisorDetails populated in every result path. Tool description stays static.

## Related Research
- Questions source: `thoughts/shared/questions/2026-04-11_23-32-53_advisor-effort-configuration.md`

## Open Questions
None — all questions resolved during checkpoint.
