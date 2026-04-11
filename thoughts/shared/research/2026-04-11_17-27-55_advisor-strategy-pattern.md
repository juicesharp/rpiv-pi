---
date: 2026-04-11T17:27:55+00:00
researcher: Claude Code
git_commit: 7f7f25c
branch: master
repository: rpiv-pi
topic: "Advisor-Strategy Pattern in Pi via custom extension tool"
tags: [research, advisor-strategy, subagent, model-switching, extensions, pi-ai, complete, in-process]
status: complete
questions_source: "thoughts/shared/questions/2026-04-11_13-04-06_advisor-strategy-pattern.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Research: Advisor-Strategy Pattern in Pi via Custom Extension Tool

## Research Question
How to implement the advisor-strategy pattern in Pi — where a faster/cheaper executor model (e.g., Sonnet) can consult a stronger advisor model (e.g., Opus) mid-task via a custom extension tool, using provider-agnostic in-process `complete()` calls with serialized context summaries.

## Summary
The advisor-strategy pattern can be implemented as a Pi extension tool registered via `pi.registerTool()`. When the executor calls the `advisor` tool, it makes an in-process `complete()` call to a stronger model with a curated advisor system prompt and serialized conversation context. Auth is resolved independently per-provider via `ctx.modelRegistry.find()` + `getApiKeyAndHeaders()`, enabling cross-provider advisor calls (e.g., OpenAI executor → Anthropic advisor). Context is curated using the serialized summary pattern from `handoff.ts`: `convertToLlm()` + `serializeConversation()` produces a text blob sent as a single user message. The advisor's response text flows back to the executor as an `AgentToolResult` content array. The `promptSnippet` and `promptGuidelines` fields on the tool definition instruct the executor when to invoke the advisor.

## Detailed Findings

### In-Process `complete()` Call Pattern (Core Mechanism)
- The `handoff.ts` example at `handoff.ts:82-108` demonstrates the exact pattern: import `complete` from `@mariozechner/pi-ai`, resolve auth, construct `Context`, call `complete()`, extract text from response.
- `complete()` is a thin wrapper: `stream(model, context, options).result()` — resolves API provider by `model.api`, calls provider's stream handler, accumulates into `AssistantMessage` (`stream.js:15-18`).
- The `Context` type (`pi-ai/types.d.ts:160-164`): `{ systemPrompt?: string, messages: Message[], tools?: Tool[] }`. No tools = no tool use (exactly what the advisor needs).
- `AssistantMessage` return (`pi-ai/types.d.ts:137-149`): `content: (TextContent | ThinkingContent | ToolCall)[]`, with `usage`, `stopReason`, `errorMessage`.
- Text extraction pattern (used throughout codebase, e.g., `compaction.js:472-475`): `response.content.filter(c => c.type === "text").map(c => c.text).join("\n")`.

### `complete()` vs `completeSimple()`
- `complete()` takes `ProviderStreamOptions` (= `StreamOptions & Record<string, unknown>`) — open, provider-specific.
- `completeSimple()` takes `SimpleStreamOptions` (extends `StreamOptions` with `reasoning?: ThinkingLevel` and `thinkingBudgets?: ThinkingBudgets`) — provider-agnostic.
- Both return `Promise<AssistantMessage>`. Both inherit `apiKey`, `headers`, `signal`, `onPayload` from `StreamOptions` base.
- For the advisor tool, `completeSimple()` is preferred: provider-agnostic, supports `reasoning` for thinking models without provider-specific parameters.

### Model Resolution and Cross-Provider Auth
- `ctx.modelRegistry.find(provider, modelId)` (`model-registry.js:264-266`): Simple `Array.find()` on `m.provider === provider && m.id === modelId`. Returns `Model<Api> | undefined`.
- `ctx.modelRegistry.getApiKeyAndHeaders(model)` (`model-registry.js:278-315`): Resolves auth per `model.provider` independently. Resolution chain: runtime override → auth.json persisted credentials → OAuth token → environment variable → fallback resolver.
- **Cross-provider works**: When executor uses OpenAI and advisor uses Anthropic, `getApiKeyAndHeaders(advisorModel)` resolves Anthropic's key because it uses `model.provider` as the lookup key, not the executor's provider.
- Returns `ResolvedRequestAuth = { ok: true, apiKey?, headers? } | { ok: false, error: string }` (`model-registry.d.ts:5-10`).

### Context Curation with Serialized Summary
- `ctx.sessionManager.getBranch()` returns `SessionEntry[]` — all entries from root to current leaf (`session-manager.d.ts:166`).
- Filter to messages: `branch.filter(e => e.type === "message").map(e => e.message)` produces `AgentMessage[]` (`handoff.ts:72-74`).
- `convertToLlm(messages)` (`messages.js:75-117`): Maps `AgentMessage[]` → `Message[]`. Custom types (bashExecution, custom, branchSummary, compactionSummary) become user messages; base types (user, assistant, toolResult) pass through unchanged.
- `serializeConversation(llmMessages)` (`compaction/utils.js:93-161`): Serializes `Message[]` to plain text with role prefixes (`[User]:`, `[Assistant]:`, `[Tool result]:`).
- The advisor constructs context as a single user message containing question + optional context_summary + serialized conversation, matching the handoff.ts pattern.

### Tool Registration and Prompt Serialization Pipeline
- `pi.registerTool(tool)` stores the `ToolDefinition` in `extension.tools.set(name, { definition, sourceInfo })` and calls `runtime.refreshTools()` (`loader.js:152-160`).
- `_refreshToolRegistry()` (`agent-session.js:1774-1837`): Merges extension tools with builtins, extracts `promptSnippet` into `_toolPromptSnippets` Map, extracts `promptGuidelines` into `_toolPromptGuidelines` Map. Calls `setActiveToolsByName()`.
- `_normalizePromptSnippet()` (`agent-session.js:604-613`): Forces single line, collapses whitespace.
- `_normalizePromptGuidelines()` (`agent-session.js:614-623`): Trims, deduplicates via Set.
- `_rebuildSystemPrompt()` (`agent-session.js:625-655`): Collects snippets + guidelines for active tools only, passes to `buildSystemPrompt()`.
- `buildSystemPrompt()` (`system-prompt.js:40-78`): Renders `promptSnippet` as `- name: snippet` in "Available tools" section. Renders `promptGuidelines` as `- guideline` bullets in "Guidelines" section. Tools WITHOUT `promptSnippet` are excluded from "Available tools" entirely (`system-prompt.js:42`).
- **Critical**: Missing `promptSnippet` = tool invisible to LLM. This was the ask_user_question mistake.

### Subagent Subprocess vs In-Process Comparison
- Subprocess (`subagent/index.ts`): Spawns separate `pi --mode json -p --no-session` process. Full tool suite, isolated context, ~1-2s startup overhead, separate prompt caching.
- In-process (`handoff.ts`): Direct `complete()` call. No tools, curated context, zero startup overhead, single API call.
- **Advisor needs in-process**: No tool access required, lower latency, lower cost, simpler implementation.

### `before_provider_request` (Alternative: Native Anthropic Injection)
- The `before_provider_request` event (`types.d.ts:397-400`) receives the **raw Anthropic HTTP body** — the exact object spread into `client.messages.stream()` at `anthropic.js:161`.
- An extension CAN inject `{ type: "advisor_20260301", name: "advisor", model: "claude-opus-4-6", max_uses: 3 }` into `payload.tools`. No validation blocks this.
- **Rejected for initial scope**: Provider-specific (Anthropic only), no context curation control, depends on undocumented payload shape. May be added later as an optional optimization for Anthropic users.

### Per-Agent Model Frontmatter (Subagent Pattern)
- Agent `.md` files support `model:` in YAML frontmatter, parsed by `agents.ts:28-49` via `parseFrontmatter()`.
- Flows to `--model` CLI flag in subprocess invocation (`subagent/index.ts:162`).
- **Not used for advisor**: In-process `complete()` resolves model directly via `modelRegistry.find()`, bypassing the subagent pipeline entirely.

## Code References
- `pi-ai/dist/stream.js:15-18` — `complete()` implementation (wraps `stream().result()`)
- `pi-ai/dist/stream.js:28-30` — `completeSimple()` implementation (wraps `streamSimple().result()`)
- `pi-ai/dist/types.d.ts:160-164` — `Context` type (`{ systemPrompt?, messages, tools? }`)
- `pi-ai/dist/types.d.ts:137-149` — `AssistantMessage` return type
- `pi-ai/dist/types.d.ts:104-108` — `SimpleStreamOptions` with `reasoning` and `thinkingBudgets`
- `pi-ai/dist/types.d.ts:59-68` — `StreamOptions` base (apiKey, headers, signal, onPayload)
- `pi-ai/dist/providers/simple-options.js:1-15` — `buildBaseOptions()` preserves auth + onPayload
- `pi-coding-agent/examples/extensions/handoff.ts:82-108` — In-process complete() reference implementation
- `pi-coding-agent/examples/extensions/subagent/index.ts:147-225` — Subprocess subagent pattern
- `pi-coding-agent/examples/extensions/subagent/agents.ts:28-49` — Agent discovery with model frontmatter
- `pi-coding-agent/dist/core/extensions/types.d.ts:363-376` — `ToolDefinition` (promptSnippet, promptGuidelines)
- `pi-coding-agent/dist/core/extensions/types.d.ts:180-213` — `ExtensionContext` (modelRegistry, sessionManager, model)
- `pi-coding-agent/dist/core/extensions/loader.js:152-160` — `registerTool()` stores + triggers refresh
- `pi-coding-agent/dist/core/agent-session.js:1774-1837` — `_refreshToolRegistry()` merge + extract snippets/guidelines
- `pi-coding-agent/dist/core/agent-session.js:625-655` — `_rebuildSystemPrompt()` collects per-tool data
- `pi-coding-agent/dist/core/agent-session.js:604-623` — Normalization functions for snippet/guidelines
- `pi-coding-agent/dist/core/system-prompt.js:40-78` — Renders snippets in "Available tools", guidelines in "Guidelines"
- `pi-coding-agent/dist/core/model-registry.js:264-266` — `find()` by provider + modelId
- `pi-coding-agent/dist/core/model-registry.js:278-315` — `getApiKeyAndHeaders()` per-provider auth resolution
- `pi-coding-agent/dist/core/messages.js:75-117` — `convertToLlm()` AgentMessage[] → Message[]
- `pi-coding-agent/dist/core/compaction/utils.js:93-161` — `serializeConversation()` Message[] → text
- `pi-coding-agent/dist/core/extensions/runner.js:549-578` — `emitBeforeProviderRequest()` chains handlers

## Integration Points

### Inbound References
- `pi.registerTool({ name: "advisor", ... })` — Extension API for registering the advisor tool
- `ToolDefinition.promptSnippet` — One-liner in "Available tools" section of system prompt
- `ToolDefinition.promptGuidelines` — Bullet guidelines in "Guidelines" section of system prompt
- `ctx.modelRegistry.find(provider, modelId)` — Resolves the advisor model from registry
- `ctx.modelRegistry.getApiKeyAndHeaders(model)` — Resolves API key/headers for advisor model
- `ctx.sessionManager.getBranch()` — Retrieves current conversation branch for context curation

### Outbound Dependencies
- `complete()` / `completeSimple()` from `@mariozechner/pi-ai` — The actual LLM API call to the advisor model
- `convertToLlm()` from `@mariozechner/pi-coding-agent` — Converts session messages to LLM-compatible format
- `serializeConversation()` from `@mariozechner/pi-coding-agent` — Serializes messages to text for context summary
- `Type` from `@sinclair/typebox` — Schema definition for tool parameters

### Infrastructure Wiring
- Extension loaded via `.pi/extensions/` directory or `settings.json` `extensions` array
- `loader.js` calls `registerTool()` which stores in `extension.tools` Map + triggers `runtime.refreshTools()`
- `agent-session.js:_refreshToolRegistry()` merges into unified tool registry, extracts prompt data
- `agent-session.js:_rebuildSystemPrompt()` renders prompt data into system prompt text
- `tool-definition-wrapper.js:3-11` injects `ExtensionContext` as 5th arg to `execute()`

## Architecture Insights
- **Provider-agnostic design**: `completeSimple()` with `SimpleStreamOptions.reasoning` handles provider differences internally. The advisor tool doesn't need to know which provider the advisor model uses.
- **No tool access = feature**: `complete()` with no `tools` in Context means the advisor cannot call tools — exactly what the pattern requires. No need for explicit restriction.
- **Auth isolation**: `getApiKeyAndHeaders()` resolves per `model.provider`, not the executor's provider. Cross-provider calls (OpenAI executor → Anthropic advisor) work naturally.
- **Tool invisibility risk**: Tools without `promptSnippet` are excluded from the "Available tools" section (`system-prompt.js:42`). This was the ask_user_question mistake. The advisor MUST include both `promptSnippet` and `promptGuidelines`.
- **Tool name collision**: Pi uses a flat name map (`resource-loader.js`). Duplicate tool names produce "Tool X conflicts with..." errors. The advisor tool name must be globally unique across all loaded extensions.
- **Event ordering**: `tool_execution_end` fires BEFORE message persistence (`agent-session.js:438-447` vs `293-303`). Context curation must happen inside `execute()`, not in event hooks.
- **Normalization**: `promptSnippet` is collapsed to a single line. `promptGuidelines` are trimmed and deduplicated.

## Precedents & Lessons
6 similar past changes analyzed. Key commits: `a01a4a3` (initial rpiv-pi), `8610ae5` (rpiv-core refactor).

- **Always include `promptSnippet` + `promptGuidelines`** (`a01a4a3` → `8610ae5`): ask_user_question shipped without these fields and was invisible to the LLM. The `todo` tool is the proven template.
- **Pi has no tool namespacing** (`a01a4a3` → rollback): Flat name map means `pi.registerTool` with a duplicate name produces errors. Check for collisions with user-local extensions.
- **Module extraction from index.ts is inevitable** (`8610ae5`): Monolithic extension file grew past ~370 lines and had to be modularized. Start the advisor in a separate file.
- **Canary before bulk** (`66eaea3` skill migration): Every bulk change hit problems caught only by testing one thing first. Implement advisor standalone, verify with `pi -p`, then wire into skills.
- **`complete()` in-process is simpler than subprocess** (handoff.ts proven): The advisor pattern specifically needs no tool access, making in-process `complete()` the right fit vs. subprocess spawning.
- **`tool_execution_end` ordering**: Context reads from event hooks see stale branches. All curation must happen inside `execute()`.

## Historical Context (from thoughts/)
- `thoughts/shared/questions/2026-04-11_13-04-06_advisor-strategy-pattern.md` — Questions artifact for this research
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — Initial Pi migration research (tool registration, extension loading)
- `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md` — Subagent library comparison (tool inheritance, per-agent model)
- `thoughts/shared/research/2026-04-11_07-05-28_todo-list-overlay-above-input.md` — Todo tool rendering evolution
- `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md` — Pi migration design (promptSnippet/guidelines lesson)
- `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md` — Migration plan (canary pattern, tool collision)

## Developer Context
**Q (approach): Which advisor implementation approach?**
A: Provider-agnostic in-process `complete()` tool. No Anthropic-specific approach. Support all providers. Separate agent "twin" that accepts calls via Tool and advises.

**Q (context curation): Which context curation strategy?**
A: Serialized summary (handoff.ts pattern). Use `serializeConversation(convertToLlm(messages))` to produce text blob, send as single user message.

## Related Research
- Questions source: `thoughts/shared/questions/2026-04-11_13-04-06_advisor-strategy-pattern.md`

## Open Questions
- What advisor model should be the default? (User needs to configure or we pick a reasonable default like the strongest available model from the registry)
- Should the advisor tool support configurable advisor model per-invocation, or fixed at extension config time?
- Should the advisor tool expose usage stats (token count, cost) to the executor in its response?
