---
date: 2026-04-13T12:54:29-04:00
researcher: Claude Code
git_commit: 7525a5d
branch: master
repository: rpiv-pi
topic: "pi-subagent context management — default behavior, leverage points, improvements for weak models (GLM-4.7)"
tags: [research, codebase, pi-subagents, agents, guidance-injection, prompt-mode, max-turns, context-window]
status: complete
questions_source: "/Users/sguslystyi/rpiv-pi/thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Research: pi-subagent context management — default behavior, leverage points, improvements for weak models (GLM-4.7)

## Research Question
How rpiv-pi manages subagent context by default, which knobs actually change prompt growth and tool/menu size, and which repo-side improvements are highest leverage for weak models like GLM-4.7.

## Summary
Upstream `@tintinweb/pi-subagents` starts with an unlimited max-turn default, but rpiv-pi immediately overrides that to `10` at session start via `extensions/rpiv-core/subagent-tuning.ts:14-20` from `extensions/rpiv-core/index.ts:42-52`. The bigger context amplifiers in rpiv-pi are prompt inheritance (`general-purpose` append mode), repeated guidance reinjection across fresh subagent sessions, inherited tool/menu schemas, and verbose skill/agent prompts. Bundled agents are already partially constrained: all nine set `max_turns`, eight set `isolated: true`, and none of them set `model`, `thinking`, `prompt_mode`, `disallowed_tools`, `inherit_context`, or `extensions`, so the remaining high-leverage changes are mostly prompt/shaping and tool pruning rather than turn-limit plumbing. The one notable exception is `agents/web-search-researcher.md:2-5`, which intentionally omits `isolated` so it can keep web tools.

## Detailed Findings

### Turn budget and prompt inheritance
- Upstream default max turns is unlimited: `src/agent-runner.ts:27-47` defines `defaultMaxTurns` as `undefined`, normalizes `0` to unlimited, and provides `setDefaultMaxTurns()` / `setGraceTurns()` helpers.
- rpiv-pi does not leave that upstream default in place. `extensions/rpiv-core/index.ts:42-52` calls `applySubagentTuning(pi)`, and `extensions/rpiv-core/subagent-tuning.ts:14-20` deep-imports `setDefaultMaxTurns()` and sets the global default to `10`.
- The repo UI can still change the same knob at runtime: `extensions/rpiv-core/index.ts:1632-1637` writes the default max-turn setting from `/agents` → Settings.
- Prompt inheritance is driven by config, not by the turn budget. `src/default-agents.ts:21-26` makes `general-purpose` an append-mode parent twin, while `src/default-agents.ts:67-71` and `src/default-agents.ts:123-127` keep `Explore` and `Plan` in replace mode.
- `src/prompts.ts:25-69` is the core prompt compositor: append mode wraps the parent system prompt in `<inherited_system_prompt>`, adds the sub-agent bridge, and appends custom instructions/extras; replace mode emits a standalone prompt.

### Guidance injection and parent-context amplification
- Guidance resolution is per-depth and prefers `AGENTS.md > CLAUDE.md > .rpiv/guidance/<sub>/architecture.md`: `extensions/rpiv-core/guidance.ts:52-80`.
- Guidance is deduped only by a session-scoped `Set`: `extensions/rpiv-core/guidance.ts:103-107`, `115-140`, and `162-180`.
- `extensions/rpiv-core/index.ts:42-52, 113-143` clears that dedup state on session start/compact/shutdown and registers `tool_call` injection, so each new session can inject guidance again.
- Subagents are fresh sessions: `src/agent-runner.ts:255-257` creates `SessionManager.inMemory(effectiveCwd)`, and `src/agent-runner.ts:298-299` calls `session.bindExtensions()`, which re-fires extension session hooks inside the subagent session.
- `inherit_context` is separately gated and defaults false: `src/invocation-config.ts:13-39` resolves `inheritContext` from agent config or tool params, falling back to `false`, and `src/agent-runner.ts:350-366` only prepends `buildParentContext(ctx)` when that flag is true.
- `src/context.ts:20-57` serializes user/assistant history plus compaction summaries, so enabling `inherit_context` is a direct multiplicative blow-up on top of inherited prompts.

### Tool inheritance, allowlists, and return-path size
- Built-in tool menus come from `src/agent-types.ts:139-145`; if `builtinToolNames` is absent, the agent gets all built-ins.
- The default runtime config in `src/agent-types.ts:148-190` still sets `extensions: true`, `skills: true`, and `promptMode: "append"` for the fallback general-purpose config.
- `src/agent-runner.ts:174-176` turns extensions/skills off only when `isolated` is true, and `src/invocation-config.ts:31-33` resolves `isolated` to `false` by default.
- `src/custom-agents.ts:58-70` is the frontmatter parser that consumes `tools`, `disallowed_tools`, `extensions`, `skills`, `model`, `thinking`, `max_turns`, `prompt_mode`, `inherit_context`, `run_in_background`, and `isolated`.
- `src/agent-runner.ts:186-193, 271-299` builds the tool list, applies the denylist, and filters active tools. The only automatic removals are `Agent`, `get_subagent_result`, and `steer_subagent` (`src/agent-runner.ts:24-25`).
- Result size is not capped at the source: `src/agent-runner.ts:119-137` collects full assistant text, `src/agent-runner.ts:346-366` falls back to the full last assistant message, and `src/index.ts:971-1028` returns `record.result` unbounded from `get_subagent_result`.
- User-facing notifications only truncate previews: `src/index.ts:120-134` and `171-193` shorten the display payload, not the stored result.

### Bundled agent presets and skill prompt pressure
- The bundled agent files are already unevenly constrained. `agents/codebase-analyzer.md:2-6`, `codebase-locator.md:2-6`, `integration-scanner.md:2-6`, `precedent-locator.md:2-6`, `test-case-locator.md:2-6`, `thoughts-analyzer.md:2-6`, `thoughts-locator.md:2-6`, and `codebase-pattern-finder.md:2-6` each set `max_turns` and `isolated: true`; `agents/web-search-researcher.md:2-5` sets `max_turns` but intentionally omits `isolated` so it can retain web tools.
- I found no bundled agent frontmatter entries for `model`, `thinking`, `prompt_mode`, `disallowed_tools`, `inherit_context`, or `extensions` anywhere in `agents/*.md`.
- `skills/research/SKILL.md:64-81` explicitly tells spawned analyzers to trace code in depth and answer with exact file:line references; `skills/research-questions/SKILL.md:13-40` says the same for discovery agents, then `116-116` forces developer review before writing questions.
- Those skill prompts, plus the long example output blocks in `agents/codebase-analyzer.md:2-6` and `codebase-locator.md:2-6`, create strong pressure toward verbose, exhaustive responses unless the agent itself self-limits.

### Concurrency and joins
- Background agents are capped at four by default: `src/agent-manager.ts:4-6, 19-20, 62-63`.
- `src/agent-manager.ts:85-113` queues background spawns once that limit is reached, while `117-145` starts them and calls `runAgent()`; foreground agents bypass the queue via `spawnAndWait()` at `246-253`.
- `src/agent-manager.ts:232-238` drains the queue as running agents complete, and `358-390` / `383-390` show the “wait for all” / “abort all” lifecycle hooks for queued and running agents.
- `src/index.ts:467-504` batches background completions for smart join mode, `281-327` formats individual/group notifications, and `382-395` suppresses duplicate notifications when the result has already been consumed.
- The join path still returns the full result payload through `record.result`; only the preview text is truncated before display.

## Code References
- `extensions/rpiv-core/index.ts:42-52` — session_start hook clears guidance state, injects root guidance, reconstructs UI state, and applies subagent tuning.
- `extensions/rpiv-core/index.ts:113-143` — session_compact/session_shutdown reset guidance state and wire `tool_call` guidance injection.
- `extensions/rpiv-core/guidance.ts:52-80` — per-depth guidance resolver with `AGENTS.md > CLAUDE.md > architecture.md` precedence.
- `extensions/rpiv-core/guidance.ts:103-180` — session-scoped dedup Set plus root/tool-call injection.
- `extensions/rpiv-core/subagent-tuning.ts:14-20` — deep-imports upstream `setDefaultMaxTurns()` and sets `10`.
- `src/agent-runner.ts:27-47` — upstream unlimited max-turn default and grace-turn helpers.
- `src/agent-runner.ts:174-193` — isolated mode removes extension/skill inheritance and applies memory-aware tool branching.
- `src/agent-runner.ts:214-228` — builds the effective system prompt via `buildAgentPrompt()`.
- `src/agent-runner.ts:255-299` — creates in-memory sessions and binds extensions, re-firing extension lifecycle hooks.
- `src/agent-runner.ts:312-366` — max-turn enforcement, prompt inheritance via `inherit_context`, and final response collection.
- `src/prompts.ts:25-69` — append vs replace prompt assembly.
- `src/context.ts:20-57` — parent conversation serialization for `inherit_context`.
- `src/invocation-config.ts:13-39` — frontmatter/tool-call precedence for `maxTurns`, `inheritContext`, `runInBackground`, `isolated`, and `isolation`.
- `src/custom-agents.ts:52-70` — frontmatter parser for bundled/project/global agents.
- `src/agent-types.ts:139-190` — built-in tool list, default config, and fallback append-mode general-purpose config.
- `src/agent-manager.ts:20-20, 85-145, 232-238, 358-390` — concurrency cap, queueing, runtime start, and shutdown handling.
- `src/index.ts:120-134, 171-193, 281-327, 818-873, 971-1028` — notification truncation, background join, Agent tool execution, and full `get_subagent_result` return path.
- `agents/codebase-analyzer.md:2-6` — bundled analyzer preset with `max_turns: 15` and `isolated: true`.
- `agents/web-search-researcher.md:2-5` — web-only preset with `max_turns: 10` and no `isolated`.
- `skills/research/SKILL.md:64-81` — dense research-agent prompt template.
- `skills/research-questions/SKILL.md:13-40, 116-116` — discovery-agent orchestration and developer checkpoint.

## Integration Points

### Inbound References
- `skills/research/SKILL.md:64-81` — orchestrates agent-based analysis with dense prompts.
- `skills/research-questions/SKILL.md:13-40` — discovery pipeline that feeds the research artifact.
- `agents/*.md:2-6` — bundled subagent definitions that downstream skills invoke by name.
- `extensions/rpiv-core/index.ts:42-143` — Pi lifecycle hooks that inject guidance, apply tuning, and register tools.

### Outbound Dependencies
- `src/agent-runner.ts:27-47` — upstream max-turn and grace-turn state.
- `src/agent-runner.ts:214-299` — prompt composition, session creation, and extension binding.
- `src/context.ts:20-57` — parent conversation serialization.
- `src/custom-agents.ts:52-70` and `src/invocation-config.ts:13-39` — frontmatter parsing and precedence resolution.
- `@tintinweb/pi-subagents` runtime internals are consumed via deep import in `extensions/rpiv-core/subagent-tuning.ts:14-20`.

### Infrastructure Wiring
- `extensions/rpiv-core/index.ts:42-52` — session_start wiring for tuning and root guidance.
- `extensions/rpiv-core/index.ts:113-143` — session_compact/session_shutdown/tool_call lifecycle hooks.
- `extensions/rpiv-core/index.ts:1632-1637` — `/agents` settings UI for default max turns.
- `src/agent-manager.ts:20, 62, 85-113, 232-238` — background concurrency queue.
- `src/index.ts:467-504, 818-873, 971-1028` — background join notifications and result-return wiring.

## Architecture Insights
- rpiv-pi already treats agent behavior as config-driven; the interesting knobs are frontmatter and runtime wiring, not ad hoc imperative logic.
- `promptMode: "append"` is the biggest prompt-growth multiplier because it inherits the parent system prompt every turn; `promptMode: "replace"` is the principal way to stop that inheritance.
- Guidance injection and `inherit_context` are both session-scoped context amplifiers; when they stack inside a subagent session, the cost grows multiplicatively.
- The repo already contains partial mitigations: default max-turns are clamped to 10, most bundled agents are read-only/isolated, and notification previews are truncated. The remaining gains come from shrinking prompts, pruning tools, and avoiding redundant guidance/context reinjection.
- `web-search-researcher` is intentionally different: it keeps web tools and therefore does not follow the `isolated: true` pattern used by code-reading agents.

## Precedents & Lessons
3 similar past changes analyzed. Key commits: `74b1cbb` (per-depth guidance resolver), `317f24e` (root guidance injection), `49cd79f` (research skill question-pattern hardening).

- `74b1cbb` and `317f24e` split the guidance problem into two commits on the same day: first adding per-depth resolution in `extensions/rpiv-core/guidance.ts`, then adding root session-start injection in `extensions/rpiv-core/index.ts`. No later fix commit showed up in git history for those same paths.
- `49cd79f` shows the repo has already responded to verbose or low-signal research prompts by tightening `skills/research/SKILL.md`; that is the closest precedent for trimming agent/skill prompt pressure instead of only changing runtime code.
- `a763c89` and `785e09e` are the adjacent research-document precedents for guidance-resolution and subagent-propagation topics; they show this repo often captures context-propagation problems as research/design artifacts before code changes land.

## Historical Context (from thoughts/)
- `thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md` — source questions artifact for this research pass.
- `thoughts/shared/questions/2026-04-13_08-20-00_pi-claude-md-subfolder-resolution.md` — earlier guidance-resolution question artifact.
- `thoughts/shared/research/2026-04-13_08-24-28_pi-claude-md-subfolder-resolution.md` — earlier research artifact on guidance resolution.
- `thoughts/shared/designs/2026-04-13_08-38-29_pi-claude-md-subfolder-resolution.md` — design follow-up for guidance resolution.
- `thoughts/shared/plans/2026-04-13_08-47-14_pi-claude-md-subfolder-resolution.md` — planning follow-up for guidance resolution.
- `thoughts/shared/questions/2026-04-13_07-54-32_todo-propagation-into-subagents.md` — earlier subagent propagation question artifact.
- `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md` — earlier subagent propagation research artifact.

## Developer Context
**Q (`agents/codebase-analyzer.md:5-6`, `agents/web-search-researcher.md:5`):** The original premise in the bundled-agent question is contradicted by the repo: several agent files already set `max_turns` and `isolated`, and `web-search-researcher` is the only bundled agent that intentionally omits `isolated`. Should I treat `max_turns`/`isolated` as already-covered defaults and focus on the remaining levers, or still include them in the punch list?
A: Focus on remaining levers (Recommended).

## Related Research
- Questions source: `/Users/sguslystyi/rpiv-pi/thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md`
- `thoughts/shared/research/2026-04-13_08-24-28_pi-claude-md-subfolder-resolution.md`
- `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md`

## Open Questions
- None.
