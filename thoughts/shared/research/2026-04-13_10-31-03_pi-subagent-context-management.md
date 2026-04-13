---
date: 2026-04-13T10:31:03-04:00
researcher: Claude Code
git_commit: 785e09e
branch: master
repository: rpiv-pi
topic: "pi-subagent context management — default behavior, leverage points, improvements for weak models (GLM-4.7)"
tags: [research, codebase, pi-subagents, subagent, context-window, max-turns, guidance-injection, rpiv-core, agents, skills]
status: complete
questions_source: "thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Research: pi-subagent context management for weak models (GLM-4.7)

## Research Question

Current pi-subagents default configuration leads weaker models (GLM-4.7) to generate subagent sessions that blow past 200k tokens (sometimes >1M), triggering compaction. Investigate current default behavior, identify leverage points, and suggest improvements — with focus on the context accumulating **inside subagent conversations**, not parent orchestrator (which the user reports is fine).

## Summary

The 200k–1M subagent bloat is the multiplicative product of **five uncorrelated defaults**, none of which individually look bad:

1. **Unlimited `defaultMaxTurns`** (`agent-runner.ts:28`) — no cap unless set via `/agents → Settings` or frontmatter. Weak models don't self-terminate; GLM-4.7 loops dozens of turns.
2. **Guidance Set is per-subagent-instance** (`guidance.ts:104` + jiti `moduleCache:false` at `loader.js:225`) — every subagent starts with an empty dedup Set, so every `read/edit/write` tool call may re-inject architecture.md files that the parent already delivered. Each injection lives in subagent message history and is **re-tokenized every subsequent turn**.
3. **Full extension tool schemas sent every turn** (`agent-runner.ts:277-293` with `extensions=true` default) — `ask_user_question`, `todo`, `advisor`, `web_search`, `web_fetch` + all MCP tools appended on top of each agent's declared built-ins.
4. **Verbose `## Output Format` templates in `agents/*.md`** — `codebase-pattern-finder.md` ships a **107-line** example with two full code blocks; weak models mimic the template literally as a minimum-output contract.
5. **No return-side cap** (`agent-runner.ts:366`, `index.ts:1022`) — `record.result` is stored and returned uncapped. The only in-band backpressure is `max_turns + graceTurns`.

The question artifact's premise that bundled rpiv-pi agents suffer from `prompt_mode: append` parent-prompt inheritance is **inverted**: `custom-agents.ts:66` defaults omitted `prompt_mode` to `"replace"`. All 9 bundled agents already run in replace mode (`prompts.ts:72-78`) — they do NOT inherit the decorated parent system prompt. Append-mode bloat applies only to `general-purpose` (`default-agents.ts:11-28`) and the unknown-type fallback (`agent-runner.ts:218-228`).

User confirmed (checkpoint): the pain is **inside** the subagent's running conversation. Fix priority therefore stacks on Q1 (turn cap), Q6 (Output Format verbosity), Q4 (tool-schema surface), Q3 (guidance re-injection), Q9 (return-size discipline) — in roughly that impact order for a pure-locator/analyzer workload.

## Detailed Findings

### Turn budget — the single biggest amplifier

- `defaultMaxTurns` declared at `@tintinweb/pi-subagents/src/agent-runner.ts:28` as `undefined` with the comment "undefined = no turn limit".
- `normalizeMaxTurns(n)` at `agent-runner.ts:31-34` treats `undefined` and `0` alike → unlimited.
- Resolution chain at `agent-runner.ts:312`: `options.maxTurns ?? agentConfig?.maxTurns ?? defaultMaxTurns` — `??` only falls through on nullish, so frontmatter wins over the caller-supplied `max_turns` param.
- Soft-limit steer at `agent-runner.ts:321-324`: fires once when `turnCount >= maxTurns`; calls `session.steer("You have reached your turn limit. Wrap up immediately — provide your final answer now.")` — this is a user-role interrupt, does NOT stop generation.
- Hard abort at `agent-runner.ts:325-328`: `turnCount >= maxTurns + graceTurns` → `session.abort()`. `graceTurns` defaults to `5` (`agent-runner.ts:42`).
- Turn counter ticks on `turn_end` events (`agent-runner.ts:318-319`), i.e. per assistant turn — not per tool call. One assistant turn can contain many tool calls.
- Setters exist but are NOT re-exported from `@tintinweb/pi-subagents`'s public `index.ts:197` (only default export). rpiv-core must deep-import `setDefaultMaxTurns` / `setGraceTurns` from `agent-runner.ts:39,47`, guarded by `hasPiSubagentsInstalled()` (`extensions/rpiv-core/index.ts:98`).
- Interactive UI path: `/agents → Settings → "Default max turns"` at `pi-subagents/src/index.ts:1628-1641`; accepts `0 = unlimited`. NOT persisted — module-local `let` resets on restart.
- CHANGELOG v0.4.0 confirms the 50-turn default was removed (was the cap before v0.4.x).

### System-prompt inheritance — not the culprit for bundled agents

- `general-purpose` at `default-agents.ts:11-28` has `promptMode: "append"` + empty `systemPrompt`. `buildAgentPrompt()` at `prompts.ts:49-70` wraps parent prompt in `<inherited_system_prompt>…</inherited_system_prompt>` + `<sub_agent_context>` bridge (10 rules at `prompts.ts:52-63`) + optional `<agent_instructions>`.
- Replace-mode assembly (`prompts.ts:72-78`) drops the whole inheritance — uses only `"You are a pi coding agent sub-agent."` + envBlock + config.systemPrompt.
- **Parser default is `"replace"`**: `custom-agents.ts:66` reads `fm.prompt_mode === "append" ? "append" : "replace"`. Grepping `/Users/sguslystyi/rpiv-pi/agents/*.md` confirms zero `prompt_mode:` keys — all 9 bundled agents run replace-mode by default.
- `/agents` scaffolding writer at `pi-subagents/src/index.ts:1588` also emits `prompt_mode: replace` by default.
- Append-mode cost therefore applies ONLY to (a) the Agent-tool default target `general-purpose`, (b) any user-authored agent that explicitly sets `append`, (c) the unknown-type fallback (`agent-runner.ts:218-228` which uses inline `promptMode: "append"` at line 222).

### Guidance injection — the hidden per-turn amplifier

- `extensions/rpiv-core/index.ts:137` registers `pi.on("tool_call", handleToolCallGuidance)`. Single module-level `Set<string>` `injectedGuidance` at `guidance.ts:103-104`, keyed ONLY on `relativePath`.
- Cleared by `clearInjectionState()` at `guidance.ts:106-108`, wired to `session_start`/`session_compact`/`session_shutdown` (`index.ts:42,109,117`).
- Subagent lifecycle: `agent-runner.ts:236-244` builds a fresh `DefaultResourceLoader` and calls `loader.reload()`. `loadExtensionModule` at `loader.js:223-234` uses `createJiti(import.meta.url, { moduleCache: false, ... })` — so `guidance.ts` is **re-imported per subagent**; the module-level Set is a new object.
- `agent-runner.ts:299-306` calls `session.bindExtensions({ onError })` → `agent-session.js:1644-1662` emits `session_start` (`agent-session.js:1659`), re-firing rpiv-core's `session_start` handler. That calls `clearInjectionState()` + `injectRootGuidance(ctx.cwd, pi)` (`index.ts:42-43`), re-injecting root `.rpiv/guidance/architecture.md` into each subagent.
- Subfolder guidance is lazy: first `read/edit/write` matching a guidance path injects via `pi.sendMessage({ display: false })` at `guidance.ts:187-191`. Entry lands in subagent message history and is re-tokenized every subsequent turn.
- Quantified: locator running 4 subfolder reads → up to 4 architecture.md files injected, each re-sent in every remaining turn. For a 10-turn subagent: 40 re-transmissions per subagent. Multiply by K parallel locators: 4K body copies.
- Also independent: Pi's own resource-loader (`DefaultResourceLoader` at `agent-runner.ts:236-244`) loads `<cwd>/AGENTS.md` or `<cwd>/CLAUDE.md` into the subagent's system-prompt `# Project Context` block on its own, regardless of rpiv-core.
- `ctx` delivered to the handler has no session-id — the handler can't distinguish parent vs subagent origin.
- The `333949d` commit added CLAUDE.md files at every layer (411 insertions), expanding the surface area re-injected per subagent. `74b1cbb` extended the resolver to walk per-depth.

### Tool inheritance — every turn re-ships full tool-schema JSON

- `getToolsForType()` at `agent-runner.ts:186` → `agent-types.ts:139-145` resolves built-ins from `TOOL_FACTORIES` (7 tools: read/bash/edit/write/grep/find/ls) per `config.builtinToolNames`.
- `tools:` frontmatter parsed at `custom-agents.ts:58` via `csvList(fm.tools, BUILTIN_TOOL_NAMES)`; acts as an allowlist over `TOOL_FACTORIES` keys. Unknown names (e.g. `web_search` in `web-search-researcher.md:4`) silently drop at `agent-types.ts:144`.
- `extensions:` parsed at `custom-agents.ts:60` via `inheritField`; **default is `true`** when field is absent (`custom-agents.ts:132-137`). None of the 9 bundled agents set it.
- Active-tool filter at `agent-runner.ts:277-293`, gated by `if (extensions !== false)`: auto-removes only `EXCLUDED_TOOL_NAMES = ["Agent", "get_subagent_result", "steer_subagent"]` (`agent-runner.ts:25`). `disallowedSet` (from `disallowed_tools:` frontmatter — none of the 9 bundled agents set this) further prunes.
- Net: every rpiv-pi locator inherits `ask_user_question`, `todo`, `advisor`, `web_search`, `web_fetch`, plus all MCP tools. Schema JSON for each is sent every model turn.
- `isolated: true` at `invocation-config.ts:33` → `agent-runner.ts:175-176` forces `extensions=false` + `skills=false`. `agent-runner.ts:238` sets `noExtensions: true` so extensions never bind — smallest possible tool schema.

### `inherit_context` — the megabomb that's defused

- `invocation-config.ts:31` default `false`. Only activates on literal YAML `true` (`custom-agents.ts:67`).
- When true: `buildParentContext(ctx)` at `context.ts:20-58` pulls `ctx.sessionManager.getBranch()`; iterates messages, emitting `[User]: …` + `[Assistant]: …` (text-only via `extractText`) + `[Summary]: …` for compactions. `toolResult` messages are skipped (`context.ts:38`).
- Prepended to `prompt` as `effectivePrompt` at `agent-runner.ts:351-356` → becomes the first user message. Lives in message history → re-sent every subsequent turn.
- Audit: zero matches for `inherit_context|inheritContext` in `/Users/sguslystyi/rpiv-pi/agents/*.md` or `skills/*/SKILL.md`. Safe today; no guardrail against accidental future additions.

### Return-side — no size cap anywhere

- `collectResponseText()` at `agent-runner.ts:119-130`: accumulates all `text_delta` events, resetting only on `message_start`. No length cap.
- `getLastAssistantText()` at `agent-runner.ts:132-141`: returns first non-empty assistant text fully.
- `runAgent` returns `responseText` at `agent-runner.ts:366`; `record.result = responseText` at `agent-manager.ts:172` stores it uncapped.
- Foreground return path at `index.ts:961-965`: `textResult(… + record.result?.trim())` — full text into parent conversation.
- `get_subagent_result` at `index.ts:991-1041`: line 1022 appends `record.result?.trim()` uncapped. With `verbose: true` at `index.ts:1032-1037`, also appends `getAgentConversation(record.session)`; only `tool_result` messages are truncated (200 chars at `agent-runner.ts:433`) — user/assistant text is never truncated.
- `formatTaskNotification` at `index.ts:120-134` truncates only the **preview** at `resultMaxLen=500` (individual nudge, `index.ts:285`) or `300` (group join, `index.ts:314`). The stored record and the `get_subagent_result` return are untouched.
- `Agent` tool parameter schema at `index.ts:553-629` exposes `prompt`, `model`, `thinking`, `max_turns`, `run_in_background`, `isolated`, `inherit_context` — no `max_output_tokens` or `max_response_bytes`.
- Only backpressure: `max_turns` + `graceTurns` (turn budget, not size) + agent's own self-limiting system-prompt instructions.

### Concurrency and group join — also uncapped

- `DEFAULT_MAX_CONCURRENT = 4` hard-coded at `agent-manager.ts:20`; mutable via interactive `/agents → Settings` (`pi-subagents/src/index.ts:1617-1623`); no env var, no persistence.
- FIFO queue: `agent-manager.ts:107-111`; `runningBackground` increments only at `startAgent()` (`agent-manager.ts:121`) and decrements in `.then()`/`.catch()` of the run promise (`agent-manager.ts:193,222`) followed by `drainQueue()` (`agent-manager.ts:233-240`). No queue-depth cap.
- **Foreground bypasses the limit**: `spawnAndWait()` at `agent-manager.ts:246-257` calls `spawn()` with `isBackground: false`; the gate at `agent-manager.ts:107` requires `isBackground === true`. A foreground call while 4 background agents run starts a 5th session immediately.
- Group join: `finalizeBatch` at `index.ts:477-508` registers a `GroupJoinManager` when 2+ background agents overlap within the 100 ms debounce (`index.ts:849`); `DEFAULT_TIMEOUT = 30_000` (`group-join.ts:24`). Delivery callback at `index.ts:304-334` maps records through `formatTaskNotification(r, 300)` and `.join('\n\n')` — **concatenates truncated previews**, no LLM summarization step. To actually consume results, parent still calls `get_subagent_result` per agent (full uncapped path at `index.ts:1022`).

### Skill- and agent-level prompt pressure — drives verbose output

- `skills/research/SKILL.md:64,68,75,81`: "thoroughly", "complete analysis", "Focus on DEPTH — trace the actual code". No bullet count, no line budget.
- `skills/research-questions/SKILL.md:42,47`: "spawn 3 locators, each searching exhaustively", "report the key function signatures, exported types, and import chains" — three demands in one prompt.
- `skills/write-test-cases/SKILL.md:98`: single monolithic agent prompt with 5 numbered questions + "read the frontend page components and templates" + "extract exact button labels, form field labels/placeholders, navigation items, table column headers, success/error messages" + "Resolve any i18n translation keys".
- `skills/write-test-cases/SKILL.md:102`: "Find all side effects… domain events published, message handlers invoked, email/notification triggers, external API calls, database cascades, cache invalidations, audit log entries, webhook dispatches" — 8-way enumeration, no cap.
- `skills/code-review/SKILL.md:3,10,47`: three uses of "comprehensive".
- `skills/design/SKILL.md:58`: "Focus on DEPTH (how things work, what patterns to follow)".
- Agent `## Output Format` blocks ship verbose worked examples as implicit minimum-output contracts:
  - `agents/codebase-pattern-finder.md:48-158` — **107 lines** including two full copy-pasteable code blocks (pagination offset + cursor), test block, "Which Pattern to Use?", "Related Utilities".
  - `agents/codebase-analyzer.md:49-101` — 49-line example across 7 sections.
  - `agents/thoughts-analyzer.md:59-97 + :115-135` — 39-line example + 20-line "Example Transformation".
  - `agents/codebase-locator.md:56-86` — 27-line example with 7 sections.
  - `agents/web-search-researcher.md:62-88` — 23-line example.
- Positive outliers: `agents/integration-scanner.md:52` and `agents/precedent-locator.md:86-88` already prefix `CRITICAL: Use EXACTLY this format. Be concise` — reusable pattern for the other 7.

### Bundled-agent frontmatter gap table

All 9 bundled agents under `/Users/sguslystyi/rpiv-pi/agents/*.md` share the same gap — only `name/description/tools` set. Runtime defaults for every unset field:

| Field | Parser default | Runtime effect |
| --- | --- | --- |
| `model` | undefined | Inherits parent model (GLM-4.7 for user) via `agent-runner.ts:247-249` |
| `thinking` | undefined | `sessionOpts.thinkingLevel` never set (`agent-runner.ts:263-265`); whatever session/model defaults |
| `max_turns` | undefined | Unlimited via `defaultMaxTurns` (`agent-runner.ts:312`) |
| `prompt_mode` | `"replace"` (`custom-agents.ts:66`) | Minimal sub-agent header + body (`prompts.ts:72-78`); no parent inheritance |
| `isolated` | `false` (`invocation-config.ts:33`) | Extensions and skills both bind |
| `disallowed_tools` | undefined | No denylist; full extension surface flows through |
| `inherit_context` | `false` (`invocation-config.ts:31`) | `buildParentContext` skipped |
| `extensions` | `true` (`inheritField` at `custom-agents.ts:132-137`) | All ext/MCP tools appended to tool schema |

## Code References

- `@tintinweb/pi-subagents/src/agent-runner.ts:25` — `EXCLUDED_TOOL_NAMES = ["Agent", "get_subagent_result", "steer_subagent"]`
- `@tintinweb/pi-subagents/src/agent-runner.ts:28` — `let defaultMaxTurns: number | undefined = undefined` (unlimited default)
- `@tintinweb/pi-subagents/src/agent-runner.ts:39,47` — `setDefaultMaxTurns`, `setGraceTurns` (not re-exported from package root)
- `@tintinweb/pi-subagents/src/agent-runner.ts:42` — `let graceTurns = 5`
- `@tintinweb/pi-subagents/src/agent-runner.ts:119-141` — `collectResponseText` + `getLastAssistantText` (no size caps)
- `@tintinweb/pi-subagents/src/agent-runner.ts:169,214` — parent prompt capture + `buildAgentPrompt` call
- `@tintinweb/pi-subagents/src/agent-runner.ts:175-176` — `isolated` branch forcing extensions+skills off
- `@tintinweb/pi-subagents/src/agent-runner.ts:256` — `SessionManager.inMemory(effectiveCwd)` per subagent
- `@tintinweb/pi-subagents/src/agent-runner.ts:277-293` — active-tool filter (gated by `extensions !== false`)
- `@tintinweb/pi-subagents/src/agent-runner.ts:299-306` — `session.bindExtensions({ onError })` re-fires session_start
- `@tintinweb/pi-subagents/src/agent-runner.ts:312` — `normalizeMaxTurns(options.maxTurns ?? agentConfig?.maxTurns ?? defaultMaxTurns)`
- `@tintinweb/pi-subagents/src/agent-runner.ts:317-329` — turn counter, soft steer, hard abort
- `@tintinweb/pi-subagents/src/agent-runner.ts:350-356` — `buildParentContext(ctx)` prepended when `inheritContext`
- `@tintinweb/pi-subagents/src/agent-runner.ts:366` — `return { responseText, … }` (uncapped)
- `@tintinweb/pi-subagents/src/agent-runner.ts:403-408` — `steerAgent()` wrapper around `session.steer`
- `@tintinweb/pi-subagents/src/agent-runner.ts:433` — `getAgentConversation` truncates tool_result to 200 chars only
- `@tintinweb/pi-subagents/src/agent-manager.ts:20` — `DEFAULT_MAX_CONCURRENT = 4`
- `@tintinweb/pi-subagents/src/agent-manager.ts:71-75` — `setMaxConcurrent(n)` clamps to `max(1, n)`
- `@tintinweb/pi-subagents/src/agent-manager.ts:107-111` — foreground bypasses concurrency gate
- `@tintinweb/pi-subagents/src/agent-manager.ts:172` — `record.result = responseText` stored uncapped
- `@tintinweb/pi-subagents/src/agent-manager.ts:233-240` — FIFO `drainQueue`
- `@tintinweb/pi-subagents/src/context.ts:8-57` — `extractText` + `buildParentContext` shape
- `@tintinweb/pi-subagents/src/custom-agents.ts:52-74` — frontmatter parser
- `@tintinweb/pi-subagents/src/custom-agents.ts:66` — prompt_mode default `"replace"`
- `@tintinweb/pi-subagents/src/custom-agents.ts:132-137` — `inheritField` default-true
- `@tintinweb/pi-subagents/src/invocation-config.ts:13-36` — merge precedence (agentConfig wins over params)
- `@tintinweb/pi-subagents/src/default-agents.ts:11-28` — `general-purpose` with `promptMode: "append"`
- `@tintinweb/pi-subagents/src/default-agents.ts:67,123` — `Explore`/`Plan` with `promptMode: "replace"`
- `@tintinweb/pi-subagents/src/prompts.ts:49-69` — append-mode assembly with `<inherited_system_prompt>` wrapper
- `@tintinweb/pi-subagents/src/prompts.ts:72-78` — replace-mode assembly
- `@tintinweb/pi-subagents/src/index.ts:120-148` — `formatTaskNotification` preview truncation only
- `@tintinweb/pi-subagents/src/index.ts:285,314` — `resultMaxLen` 500 / 300 (preview only)
- `@tintinweb/pi-subagents/src/index.ts:477-508` — `finalizeBatch` + `GroupJoinManager` registration
- `@tintinweb/pi-subagents/src/index.ts:553-629` — Agent tool registration (no size params)
- `@tintinweb/pi-subagents/src/index.ts:961-965` — foreground return path (uncapped)
- `@tintinweb/pi-subagents/src/index.ts:991-1041` — `get_subagent_result` tool (uncapped)
- `@tintinweb/pi-subagents/src/index.ts:1608-1665` — `/agents → Settings` menu incl. "Default max turns"
- `@tintinweb/pi-subagents/src/group-join.ts:24-107` — `DEFAULT_TIMEOUT=30_000`, `STRAGGLER_TIMEOUT=15_000`
- `extensions/rpiv-core/index.ts:41-43` — session_start wiring + `injectRootGuidance`
- `extensions/rpiv-core/index.ts:44-46` — `active_agent`/`general-purpose` shim (load-bearing)
- `extensions/rpiv-core/index.ts:98-105` — `hasPiSubagentsInstalled()` check
- `extensions/rpiv-core/index.ts:109,117` — `clearInjectionState` on compact/shutdown
- `extensions/rpiv-core/index.ts:137` — `pi.on("tool_call", handleToolCallGuidance)`
- `extensions/rpiv-core/guidance.ts:103-108` — `injectedGuidance` Set + `clearInjectionState`
- `extensions/rpiv-core/guidance.ts:122-152` — `injectRootGuidance`
- `extensions/rpiv-core/guidance.ts:162-192` — `handleToolCallGuidance` dispatch
- `extensions/rpiv-core/agents.ts:36-62` — `copyBundledAgents` (copy-if-missing)
- `extensions/rpiv-core/advisor.ts` — cross-session persistence precedent (`~/.config/rpiv-pi/advisor.json`)
- `agents/codebase-analyzer.md:49-101` — 49-line verbose Output Format example
- `agents/codebase-locator.md:56-86` — 27-line example
- `agents/codebase-pattern-finder.md:48-158` — **107-line** example with two full code blocks
- `agents/integration-scanner.md:52-77` — has `CRITICAL: Use EXACTLY this format` prefix (positive precedent)
- `agents/precedent-locator.md:86-108` — has concise directive (positive precedent)
- `agents/thoughts-analyzer.md:59-135` — 39-line + 20-line examples
- `agents/web-search-researcher.md:62-88` — 23-line example
- `skills/research/SKILL.md:56-82` — agent prompt templates with "thoroughly" / "DEPTH"
- `skills/research-questions/SKILL.md:47` — locator prompts with "search exhaustively"
- `skills/write-test-cases/SKILL.md:82,98,102` — monolithic multi-demand prompts
- `skills/design/SKILL.md:58,73` — "Focus on DEPTH" / "show me the wiring"
- `skills/code-review/SKILL.md:3,10,47` — three "comprehensive"s
- Pi core (coding-agent peer): `agent-session.js:1644-1662` — `bindExtensions` emits `session_start`
- Pi core: `core/extensions/loader.js:223-234` — `jiti(..., { moduleCache: false })` forces per-subagent module re-import
- Pi core: `core/extensions/runner.js:358-378, 396-426, 474-492` — `createContext` + `emit` + `emitToolCall`

## Integration Points

### Inbound References
- Agent tool → `@tintinweb/pi-subagents/src/index.ts:553-629` — parameter schema accepted from parent model; invokes `manager.spawn()` / `manager.spawnAndWait()` at `index.ts:818,926`
- `get_subagent_result` tool → `@tintinweb/pi-subagents/src/index.ts:971-1043` — parent pulls full uncapped `record.result`
- `steer_subagent` tool → `@tintinweb/pi-subagents/src/agent-runner.ts:403-408` — shares code with internal soft-limit steer
- Pi `tool_call` event → `extensions/rpiv-core/index.ts:137` → `handleToolCallGuidance` at `guidance.ts:162-192`
- Pi `session_start` event → `extensions/rpiv-core/index.ts:41-43` → `clearInjectionState()` + `injectRootGuidance()` (re-fires inside every subagent session)
- Pi `session_compact`/`session_shutdown` → `extensions/rpiv-core/index.ts:109,117` → `clearInjectionState()`
- `skills/research/SKILL.md:56-82` → `subagent_type: "codebase-analyzer"` / "codebase-locator" / "precedent-locator" — named dispatch via Agent tool
- `skills/research-questions/SKILL.md:40-52` → parallel locators dispatch
- `skills/write-test-cases/SKILL.md:82-102` → 4 parallel analyzers with monolithic prompts
- `skills/design/SKILL.md`, `skills/write-plan/SKILL.md`, `skills/code-review/SKILL.md`, `skills/outline-test-cases/SKILL.md` — additional subagent dispatch callsites

### Outbound Dependencies
- Peer dep `@tintinweb/pi-subagents@0.5.2` at `~/.nvm/versions/node/v25.1.0/lib/node_modules/@tintinweb/pi-subagents/`
- Peer dep `pi-permission-system` → bundled `@mariozechner/pi-coding-agent` (supplies `agent-session.js`, `core/extensions/{loader,runner}.js`)
- `~/.pi/agent/settings.json` — `defaultThinkingLevel: "high"` (NOT forwarded to subagents unless explicit)
- `~/.config/rpiv-pi/advisor.json` — existing cross-session state precedent

### Infrastructure Wiring
- `extensions/rpiv-core/index.ts:81` — `copyBundledAgents(ctx.cwd)` on session_start (copy-if-missing)
- `extensions/rpiv-core/index.ts:162-176` — `/rpiv-update-agents` command (force-overwrite)
- `package.json` — `"extensions": ["./extensions"]`, `"skills": ["./skills"]` — Pi discovery
- `pi-subagents/src/index.ts:365` — `new AgentManager(onComplete, undefined, onStart)` singleton (always 4 concurrency)
- `pi-subagents/src/index.ts:1617-1623` — interactive max-concurrency setter (process-local)
- `pi-subagents/src/index.ts:1628-1641` — interactive default-max-turns setter (process-local)
- `pi-subagents/src/agent-manager.ts:246-257` — `spawnAndWait` (foreground, bypasses concurrency gate)
- Jiti with `moduleCache: false` at `core/extensions/loader.js:224-225` — causes per-subagent module re-import (root cause of per-subagent guidance Set isolation)

## Architecture Insights

- **Unlimited by default is a design choice, not an oversight.** `defaultMaxTurns = undefined` at `agent-runner.ts:28` + CHANGELOG v0.4.0 ("subagents no longer have a 50-turn default cap") reflect an intentional "let strong models self-terminate" stance. Weak models don't; they need an explicit turn cap.
- **Two-phase turn enforcement.** Soft-steer (user-role nudge) at `maxTurns`, hard-abort at `maxTurns + graceTurns`. This is why `max_turns: 10` with default `graceTurns = 5` actually lets a run go to 15.
- **Resolution precedence inverts Claude Code.** `agent-runner.ts:312` prefers `agentConfig.maxTurns` over `options.maxTurns` — i.e. `.md` frontmatter wins over caller-supplied per-dispatch override. Frontmatter edits are therefore the authoritative knob.
- **Jiti + `moduleCache: false` is load-bearing for extension isolation** (per the `2026-04-13_08-51-45_todo-propagation-subagents.md` research): it's why todo/advisor/guidance state doesn't cross subagents. The same mechanism prevents a cross-session dedup Set from working via module-scoped state.
- **Parser default for `prompt_mode` is `replace`**; the bundled agents therefore do NOT suffer parent-prompt inheritance. The append-mode bloat path is narrow (only `general-purpose` + unknown-type fallback). This inverts the premise of the questions artifact.
- **`<sub_agent_context>` bridge (10 rules at `prompts.ts:52-63`) only exists in append-mode assembly.** Replace-mode agents lose it — which is why `agents/codebase-locator.md` etc. need their own "be concise" instructions in their body.
- **Foreground dispatch silently bypasses `DEFAULT_MAX_CONCURRENT=4`.** `agent-manager.ts:107` gate requires `isBackground === true`. A skill that spawns 4 background analyzers + 1 foreground planner runs 5 concurrent sessions.
- **Group join concatenates previews, not content.** `index.ts:304-334` `.join('\n\n')` on `formatTaskNotification(r, 300)` — no LLM summarization, no content reduction beyond 300-char preview.
- **`verbose: true` on `get_subagent_result` is a footgun.** `index.ts:1032-1037` appends full `getAgentConversation(record.session)` — the entire subagent transcript minus 200-char tool_result snippets. Intended for debugging; would drown parent context if skills used it routinely.
- **Weak-model mimicry of Output Format examples.** `agents/codebase-pattern-finder.md:48-158` at 107 lines with two code blocks is a minimum-output contract to weak models. `integration-scanner.md:52` + `precedent-locator.md:86` show the pattern for discipline: `CRITICAL: Use EXACTLY this format. Be concise.`
- **Auto-copy with copy-if-missing semantics.** `agents.ts:53-56` doesn't overwrite existing files in `<cwd>/.pi/agents/`. Users on old copies won't pick up frontmatter improvements without `/rpiv-update-agents` (`index.ts:162-176`). Consider a version stamp.

## Precedents & Lessons

16 relevant past changes found in `rpiv-pi` git. Closest precedents:

- `7fc4817` — tightened `extensions/rpiv-core/todo.ts` prompt guidelines (8 lines). Prompt-only fix, no follow-up. Template for capping agent output via tool-description edits.
- `9d33a1c` — added mandatory Sources section + year-from-system-date guidance to `web-tools/index.ts` prompts (11 lines). Prompt-only; no type/API churn; no follow-up.
- `bb7e30f` — added `~/.config/rpiv-pi/advisor.json` persistence via `session_start` hook + `restoreAdvisorState`. Reusable pattern for a potential cross-session guidance-dedup registry.
- `33825e2` — follow-up fix to `bb7e30f` for `saveAdvisorConfig` error handling + effort-picker fallback index. **Lesson**: cross-session persistence error-handling is wrong on first pass. Expect one follow-up wave if we add a guidance registry.
- `be0a014` — strip advisor tool from active tools when disabled. Reusable for stripping `ask_user_question`/`todo`/`advisor` from subagent tool schemas.
- `74b1cbb` — extended `resolveGuidance` to per-depth walk (AGENTS.md > CLAUDE.md > architecture.md). Depth 0 skipped (Pi handles `<cwd>`). **No follow-up fix yet; research doc flags it as a latent amplifier.**
- `333949d` — added CLAUDE.md at every layer (411 insertions). Increases text surface injected per subagent via guidance walk; amplifies bloat if dedup isn't cross-session.
- `66eaea3` — bulk replaced 21 SKILL.md files with Pi-native patterns in one commit; smoke test was "subagent self-identifies its type". **Lesson**: bulk prompt edits need canary ONE skill+agent pair first before expanding.
- `7f7f25c` — rewrote `design-feature-iterative` Step 3 from 5-type taxonomy to 6-dimension sweep mapped 1:1 to write-plan sections, eliminating re-asking of already-resolved questions. **Lesson**: orchestrator drift re-asking resolved questions is a direct context-bloat driver.
- `33550c5` — added `session_start`/`session_compact`/`session_shutdown`/`tool_execution_end` listener wiring + `ctx.hasUI` gate. **Lesson**: `ctx.hasUI === false` already discriminates some subagent cases; may be reusable for subagent-origin detection in guidance.
- `8610ae5` — refactored monolithic `index.ts` into modular files. **Load-bearing invariant: the `active_agent`/`general-purpose` shim at `extensions/rpiv-core/index.ts:44-46` must not be renamed** — it's used by pi-permission-system fallback.

Composite lessons:

1. **Zero precedent for frontmatter turn/isolated/thinking knobs** — green-field edit, auto-propagated via `agents.ts:36-62` on session_start. High-impact, low-risk.
2. **Prompt-only fixes (`7fc4817`, `9d33a1c`, `26f9c58`) land cleanly without follow-ups** — the skill-prompt caps and Output Format tightening are in the same class of risk.
3. **Cross-session persistence has a known bug shape** (`33825e2`) — if we add a guidance dedup file, write the error-handling correctly on first pass.
4. **Bulk edits without canary have caused issues** — stage the 9-agent frontmatter rollout on ONE agent first.
5. **`inherit_context: true` is documented as a megabomb** (`2026-04-11_07-16-31_pi-subagents-alt-library.md`). Keep the audit guardrail.
6. **`general-purpose` literal is load-bearing.** When tightening bundled agents, do not attempt to replace the Agent-tool default via a user-authored override without testing the permission-system fallback path.

## Historical Context (from thoughts/)

- `thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md` — source questions artifact (the 10 dense research paragraphs this doc answers)
- `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md` — confirms `moduleCache: false` isolates todo/guidance/advisor module state per subagent; identifies WeakMap-on-SessionManager and `pi.setData`/`pi.getData` as hardening paths
- `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md` — documents `inherit_context: true` as "megabomb"; `general-purpose` literal is load-bearing; tool-name rewrites in skill prose need lockstep canary
- `thoughts/shared/research/2026-04-11_07-47-54_design-iterative-question-subagents.md` — decomposition axis should map 1:1 to downstream consumers (write-plan sections); `ask_user_question.ts:28-35` forces sequential draining (batch-2-4 claim was a CC carryover bug)
- `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md` — Phase 2 DEVIATION documents tool-name double-registration when two subagent libraries coexist

## Developer Context

**Q (`custom-agents.ts:66` + `prompts.ts:72-78` + `agents/*.md`): Parser defaults omitted `prompt_mode` to `"replace"`, so all 9 bundled agents already run in replace mode — they do NOT inherit the parent's decorated system prompt. Append-mode bloat applies only to `general-purpose` / unknown-type fallback. Given that, where is your GLM-4.7 bloat landing — named bundled agent dispatches, or `general-purpose` dispatches?**

A: The pain is **inside subagent conversations** themselves — they often exceed 200k tokens, sometimes >1M, triggering compaction. The parent orchestrator is fine; it steers research subagents and awaits their responses. Scope is general improvements to context management **inside subagents** (turn cap, tool-schema surface, guidance re-injection, Output Format verbosity, return-size discipline) and to a lesser extent the parent orchestrator. The append-mode premise is deprioritized; subagent **turn-loop depth** is the concern.

## Related Research

- Questions source: `thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md`
- `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md`
- `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md`
- `thoughts/shared/research/2026-04-11_07-47-54_design-iterative-question-subagents.md`

## Open Questions

These surfaced during analysis and were not resolved in checkpoint — design phase should address:

1. **How to detect "inside a subagent" from rpiv-core's `tool_call` handler.** `ctx` passed to the handler (from `core/extensions/runner.js:358-378`) exposes `sessionManager` / `cwd` / `modelRegistry` but no session-id or parent-link. Options: (a) capture root `SessionManager` identity at parent `session_start` in `globalThis.__rpivRoot__`, compare in subagent `session_start`; (b) detect via `ctx.sessionManager.constructor.name === "InMemorySessionManager"` (subagents use `SessionManager.inMemory` at `agent-runner.ts:256`); (c) use `ctx.hasUI === false` (precedent: `33550c5`, but may be too broad); (d) upstream PR to `@tintinweb/pi-subagents` exposing `isSubagent` on `ExtensionContext`.
2. **Global vs per-agent turn caps.** Per-agent `max_turns` in frontmatter (`invocation-config.ts:30` precedence) is surgical; global `setDefaultMaxTurns` via deep import from `extensions/rpiv-core/index.ts` is a backstop but requires peer-dep-conditional dynamic import. Which is the primary knob, which is the fallback?
3. **`isolated: true` breaking-change surface on pure-locator agents.** Would strip `ask_user_question`/`todo`/`advisor`/`web_*` plus all MCP tools. Pure locators (`codebase-locator`, `thoughts-locator`, `integration-scanner`, `test-case-locator`) likely don't need them; but is there any silent dependency (e.g. permission-system routing)?
4. **Cross-session guidance dedup registry design.** Options: `globalThis.__rpivInjectedGuidance__` Map<rootCwd, Set>, `~/.config/rpiv-pi/guidance-state.json` per-session file, or `pi.setData`/`pi.getData` (the path `2026-04-13_08-51-45_todo-propagation-subagents.md` research suggests). Jiti `moduleCache: false` defeats plain module state.
5. **Whether `MAX_CONCURRENT` should be lowered or foreground-vs-background semantics should be tightened** to close the foreground-bypass at `agent-manager.ts:107`. Needed if weak-model workloads want predictable concurrency.
6. **`verbose: true` on `get_subagent_result` should probably be explicitly forbidden in weak-model mode** (it appends full transcript via `index.ts:1032-1037`). Is this ever invoked by skills today? Grep shows no — leave as-is but document.
7. **Whether to rewrite or truncate existing `agents/codebase-pattern-finder.md:48-158`** (107 lines including two code blocks) vs. a smaller retrofit — the pattern-finder's output shape is core to its purpose; over-tightening may break utility.
