---
date: 2026-04-11T14:10:07+00:00
designer: Claude Code
git_commit: 7f7f25c
branch: master
repository: rpiv-pi
topic: "Advisor-Strategy Pattern in Pi via custom extension tool"
tags: [design, advisor-strategy, subagent, model-switching, extensions, pi-ai, rpiv-core]
status: complete
research_source: "thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Design: Advisor Tool + /advisor Command for rpiv-core

## Summary
Add an `advisor` extension tool to `rpiv-core` that, when called, sends the executor's serialized conversation branch to a stronger advisor model via in-process `completeSimple()` and returns the advisor's guidance as the tool result. A companion `/advisor` slash command opens a selector UI (matching the `/agents` pattern) where the user picks the advisor model from `ctx.modelRegistry.getAvailable()` or turns the advisor off; selection is materialized by toggling `"advisor"` in `ctx.setActiveTools()`.

## Requirements
- Provider-agnostic: executor on any provider can call an advisor on any provider (cross-provider auth resolved per-model).
- Zero-parameter tool: the executor calls `advisor()` with no arguments; the full current branch is auto-forwarded.
- User-selectable advisor model via `/advisor` slash command; dynamic list from `modelRegistry.getAvailable()`; includes a "No advisor" sentinel.
- Default state: advisor tool registered but NOT in the active tool list (invisible to the LLM).
- Advisor can never emit tool calls — Context passed to `completeSimple()` has no `tools` field, and the backend system prompt forbids it.
- Curated `description` + `promptSnippet` + `promptGuidelines` so the executor LLM knows when to call advisor (precedent lesson: missing either field makes a tool invisible in the system prompt).
- Forward `execute()`'s `signal` argument to `completeSimple()` so user aborts propagate cleanly.
- Error paths for: no advisor selected, model resolution failure, auth failure, network error, user abort.

## Current State Analysis

### Key Discoveries
- **`handoff.ts:82-108` is the exact template** for in-process `complete()` from within an extension — resolves auth via `ctx.modelRegistry.getApiKeyAndHeaders(model)`, builds a single-user-message Context with serialized conversation, calls `complete()`, extracts text from `response.content` by filtering `c.type === "text"`. The advisor reuses this pattern almost verbatim.
- **`extensions/rpiv-core/ask-user-question.ts:60-90`** is the template for `ctx.ui.custom()` rendering — Container with DynamicBorder + Text header + SelectList body + Spacer separators. The advisor selector mirrors this shape with different content.
- **`extensions/rpiv-core/todo.ts:578-630`** is the template for `pi.registerTool()` with `promptSnippet`, `promptGuidelines`, TypeBox parameters, and `execute()` returning `AgentToolResult<Details>`.
- **`ctx.setActiveTools()`** (declared at `pi-coding-agent/dist/core/extensions/types.d.ts:771-775`) is the mechanism for on/off toggling — `ctx.setActiveTools([...ctx.getActiveTools(), "advisor"])` to enable, filter it out to disable. System prompt re-renders on refresh, so the tool appears/disappears from the "Available tools" section without unregister/re-register.
- **Signal at tool execute time** (`pi-agent-core/dist/agent-loop.js:335`): `prepared.tool.execute(id, args, signal, onUpdate)` receives the **run-wide** abort signal (same one used for the outer executor stream at `agent-loop.js:160`). Forwarding it directly into `completeSimple(options.signal)` is correct — user abort cancels advisor call too.
- **Tool result byte-for-byte passthrough** (`pi-coding-agent/dist/core/messages.js:113-114`): `convertToLlm()` returns `toolResult` messages unchanged. Whatever string lands in `AgentToolResult.content[0].text` is exactly what the executor LLM sees as the tool's response on its next turn. No wrapping, no truncation.
- **Event ordering** (`pi-agent-core/dist/agent-loop.js:117,383-402`): `tool_execution_end` fires strictly before `currentContext.messages.push(result)`. In-flight assistant message (with the tool call) IS already in the branch when `execute()` runs (`agent-loop.js:168,195`); sibling tool results from the same batch are NOT. Context curation must happen inside `execute()`, not in an event hook.
- **`completeSimple` vs `complete`**: `completeSimple()` (`pi-ai/dist/stream.d.ts:7`) takes `SimpleStreamOptions` with provider-agnostic `reasoning?: ThinkingLevel` and `thinkingBudgets?`. Preferred over `complete()` for provider-portable reasoning support.

### Constraints to work within
- Pi's tool name map is flat (precedent lesson `a01a4a3→rollback`): tool name `"advisor"` must not collide with any user-local extension.
- `promptSnippet` is required to make the tool appear in the "Available tools" section of the system prompt (`pi-coding-agent/dist/core/system-prompt.js:42`). Missing it = invisible tool (precedent lesson `a01a4a3→8610ae5`).
- `promptGuidelines` entries are trimmed and deduplicated via `Set` (`agent-session.js:604-623`). Repeat content collapses.
- Module growth discipline: new tool goes in its own file (`advisor.ts`), not appended to `index.ts` (precedent lesson `8610ae5`).

## Scope

### Building
- `extensions/rpiv-core/advisor.ts` — new tool file containing:
  - Module-level `selectedAdvisor: Model<Api> | undefined` with `getAdvisorModel()` getter and `setAdvisorModel(model)` setter (used by command + tool execute)
  - `ADVISOR_SYSTEM_PROMPT` constant — backend system prompt the advisor (Opus) sees when consulted
  - `ADVISOR_TOOL_NAME` constant (`"advisor"`)
  - `executeAdvisor(ctx, signal, onUpdate)` — core execute logic: read branch, serialize, resolve auth, call `completeSimple()`, extract text, return result. Handles all error paths.
  - `registerAdvisorTool(pi)` — `pi.registerTool()` wiring with empty params schema, `description`, `promptSnippet`, `promptGuidelines` derived from the developer-supplied tool-description text
  - `registerAdvisorCommand(pi)` — `pi.registerCommand("advisor", ...)` opening a `ctx.ui.custom` selector panel with curated prose header + dynamic model list + "No advisor" sentinel; selection updates module state and `ctx.setActiveTools()`
- `extensions/rpiv-core/index.ts` — add two import lines and two call lines to wire the advisor into the extension's default export

### Not Building
- `before_provider_request`-based native Anthropic `advisor_20260301` payload injection (rejected in research; provider-specific, opaque payload, future optimization)
- Per-invocation advisor model override via tool parameters (zero-param design chosen by developer)
- Cross-session persistence of advisor selection (in-memory only; resets each session)
- Tail-truncation or token-budget enforcement on the serialized branch (defer until we see real-world context-blowup on a long session)
- Advisor chains / recursive advisor (advisor has no `tools` in its Context)
- Usage-stats streaming widget or footer status (usage lands in `details` only; UX enhancement deferred)
- Additional advisor shortcuts (`opus`, `sonnet` string args) — superseded by the selector-panel UI
- Web-tools access by advisor — advisor never calls tools at all

## Decisions

### Placement: new file inside rpiv-core, not a new extension
**Ambiguity**: Ship advisor as a new sub-extension (`extensions/rpiv-advisor/`) or as a new tool file inside `rpiv-core`?
**Explored**:
- *Option A*: new file `extensions/rpiv-core/advisor.ts` + two-line wire-in to `index.ts`. Matches the existing pattern — each tool in rpiv-core lives in its own file (`ask-user-question.ts:117`, `todo.ts:630`, `guidance.ts`, `package-checks.ts`). No new `package.json` entry, no new loader path.
- *Option B*: new extension directory `extensions/rpiv-advisor/` with its own `index.ts` default export. Isolates the tool but requires a new entry in `extensions[]` (already `./extensions` in `package.json:8`, so it auto-loads, but adds a second extension's lifecycle hooks).
**Decision**: Option A. The research-flagged precedent lesson "`8610ae5`: Module extraction from `index.ts` is inevitable" already shaped rpiv-core into per-tool files; keep that shape.

### LLM call: `completeSimple()` not `complete()`
**Simple**: `completeSimple()` (`pi-ai/dist/stream.d.ts:7`) accepts provider-agnostic `reasoning?: ThinkingLevel`. Using `complete()` directly (`stream.d.ts:5`) would force provider-specific option plumbing.
**Decision**: `completeSimple()`.

### Context curation: full serialized branch, always
**Simple (inherited from research Developer Context)**: serialized summary via `convertToLlm()` + `serializeConversation()`, single user message, no executor-side filtering. User mandate: "It takes NO parameters — when you call advisor(), your entire conversation history is automatically forwarded."
**Decision**: Zero-param tool. Inside `execute()`, read `ctx.sessionManager.getBranch()` → filter `type === "message"` → `convertToLlm()` → `serializeConversation()` → single user message.

### Signal: forward execute()'s signal directly
**Simple**: `agent-loop.js:335` passes the run-wide abort signal as the 3rd arg to `tool.execute()`. Forwarding it into `completeSimple(opts.signal)` means user aborts cancel the advisor call mid-flight.
**Decision**: `completeSimple(model, context, { apiKey, headers, signal })`.

### Auth: per-model resolution via ModelRegistry
**Simple**: `ctx.modelRegistry.getApiKeyAndHeaders(advisorModel)` resolves auth using `advisorModel.provider` — cross-provider calls (OpenAI executor → Anthropic advisor) work natively because the lookup is keyed on the model's provider, not the executor's.
**Decision**: Standard handoff.ts auth-resolution pattern.

### Selector UI: ctx.ui.custom panel mirroring ask-user-question.ts
**Ambiguity**: Use the simple `ctx.ui.select(title, options[])` primitive (like `@tintinweb/pi-subagents`'s `/agents` at `src/index.ts:1144`) or a richer `ctx.ui.custom` panel with prose header?
**Explored**:
- *Option A*: `ctx.ui.select("Advisor Tool", modelLabels)` — one-line title, no prose. Minimal code.
- *Option B*: `ctx.ui.custom()` with DynamicBorder + Text (multi-paragraph prose header describing the advisor-strategy pattern) + SelectList. Matches the developer-provided mockup ("Advisor Tool" heading + descriptive paragraph + numbered list + `✓` on current selection). Template: `ask-user-question.ts:60-90`.
**Decision**: Option B. Developer explicitly specified the `/agents`-style layout with prose header.

### Default state: "No advisor" (tool registered, not active)
**Ambiguity**: Session starts with advisor ON (pick default model) or OFF (user opts in)?
**Explored**:
- *Option A*: OFF by default. Tool registered at load but `selectedAdvisor === undefined` and `"advisor"` NOT in active tool list. User must open `/advisor` to enable. Executor doesn't see the tool in its system prompt until then.
- *Option B*: ON by default with auto-picked strongest reasoning-capable model.
**Decision**: Option A. Matches the developer's mockup which shows "No advisor ✓" as the selected state. Avoids silently billing advisor tokens without user awareness.

### On/off materialization: ctx.setActiveTools()
**Simple**: `ctx.setActiveTools()` (`extensions/types.d.ts:771-775`) replaces the active tool list. Toggle in with `setActiveTools([...getActiveTools(), "advisor"])` when an advisor model is picked; filter out when "No advisor" is picked. System prompt re-renders so the tool appears/disappears from the "Available tools" section without unregister/re-register.
**Decision**: Use `ctx.setActiveTools()`.

### State: module-scoped, in-memory only
**Simple**: A single module-level `let selectedAdvisor: Model<Api> | undefined` declared inside `advisor.ts`, with `getAdvisorModel()` / `setAdvisorModel()` accessors. Matches `todo.ts:60-65`'s state pattern. No `appendEntry` persistence — session start resets to "No advisor".
**Decision**: Module-scoped, resets each session.

### Tool description surface: curated from developer-provided text
**Simple**: Developer supplied the exact tool-description wording. Mapping into the three slots:
- `description` (shown to LLM for every tool registry lookup) = intro paragraph + "takes NO parameters" mechanism sentence.
- `promptSnippet` (one-liner in "Available tools" section) = condensed summary verb phrase.
- `promptGuidelines` (bullets in "Guidelines" section) = the when/how paragraphs split into natural bullets (before-substantive-work rule, also-call triggers, cadence rule, weight-of-advice rule, reconcile-call rule).
**Decision**: Split developer text across the three slots per above.

### Backend advisor system prompt (what Opus sees when consulted)
**Simple**: Separate from the tool's executor-facing description. Short, role-defining, enforces no-tools/no-user-output/return-plan-or-correction-or-stop. Embedded as `ADVISOR_SYSTEM_PROMPT` constant in advisor.ts.
**Decision**: Fixed constant in advisor.ts, not user-configurable in the initial scope.

### Response envelope: content = bare advisor reply; details = metadata
**Simple**: Matches `todo.ts` pattern. `AgentToolResult.content` holds only the text the executor LLM should read (the advisor's reply verbatim). `AgentToolResult.details` carries `{ advisorModel, advisorProvider, usage, stopReason, errorMessage? }` for debugging/telemetry/UI rendering.
**Decision**: Bare text in content, metadata in details.

### Error handling: isError flag in details + user-visible text
**Simple**: When the advisor call fails (no selection, model not found, auth failed, network error, abort), return an `AgentToolResult` with a text content explaining the failure (so the executor LLM can react) and `details: { errorMessage, ... }`. Do NOT throw. Return shape matches `ask-user-question.ts:39-50` error branch.
**Decision**: Non-throwing, structured error result.

### onUpdate: live "Consulting advisor…" status only
**Simple**: `onUpdate` (`agent-loop.js:335-343`) is UI-only — partial results render on the tool card but are NOT added to `context.messages`. Use it to show "Consulting advisor… (model: X)" during the blocking `completeSimple()` call so users aren't staring at a frozen UI.
**Decision**: Call `onUpdate` once before the network call with a status placeholder.

## Architecture

### extensions/rpiv-core/advisor.ts — NEW
Core tool + command implementation. All exports.

```typescript
/**
 * advisor tool + /advisor command — Advisor-strategy pattern.
 *
 * Lets the executor model consult a stronger advisor model (e.g. Opus) via an
 * in-process completeSimple() call with the full serialized conversation branch
 * as context. Advisor has no tools, never emits user-facing output, and returns
 * guidance (plan, correction, or stop signal) that the executor resumes with.
 *
 * Default state is OFF — the tool is registered at load but not in the active
 * tool list; /advisor opens a selector panel (ctx.ui.custom) to pick an advisor
 * model from ctx.modelRegistry.getAvailable() and toggles the tool in via
 * ctx.setActiveTools(). Selection is in-memory and resets each session.
 */

import { completeSimple, type Message } from "@mariozechner/pi-ai";
import type { Api, Model, StopReason, Usage } from "@mariozechner/pi-ai";
import {
	DynamicBorder,
	convertToLlm,
	serializeConversation,
	type AgentToolResult,
	type AgentToolUpdateCallback,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import {
	Container,
	SelectList,
	Spacer,
	Text,
	type SelectItem,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ADVISOR_TOOL_NAME = "advisor";

export const ADVISOR_SYSTEM_PROMPT = `You are an advisor model in an advisor-strategy pattern. An executor model is running a task end-to-end — calling tools, reading results, iterating toward a solution. When the executor hits a decision it cannot reasonably solve alone, it consults you for guidance.

You read the shared conversation context and return ONE of:
- a plan (concrete next steps the executor should take),
- a correction (the executor is going down a wrong path — redirect it),
- a stop signal (the executor should halt and escalate to the user).

You NEVER call tools. You NEVER produce user-facing output. Be concise, directive, and grounded in the shared context. Name files, functions, and line numbers where possible. No preamble, no apologies, no meta-commentary about being an advisor — just the guidance the executor needs.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdvisorDetails {
	/** Resolved advisor model as "provider:id" when known (undefined on early failures). */
	advisorModel?: string;
	/** Token usage from the advisor call (present on successful and partial responses). */
	usage?: Usage;
	/** completeSimple() stopReason — "stop" | "length" | "toolUse" | "error" | "aborted". */
	stopReason?: StopReason;
	/** Human-readable error description on failure, undefined on success. */
	errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Module state — in-memory, resets each session
// ---------------------------------------------------------------------------

let selectedAdvisor: Model<Api> | undefined;

export function getAdvisorModel(): Model<Api> | undefined {
	return selectedAdvisor;
}

export function setAdvisorModel(model: Model<Api> | undefined): void {
	selectedAdvisor = model;
}

// ---------------------------------------------------------------------------
// Core execute logic — curate context, call advisor, return structured result
// ---------------------------------------------------------------------------

function buildErrorResult(
	advisorLabel: string | undefined,
	userText: string,
	errorMessage: string,
): AgentToolResult<AdvisorDetails> {
	return {
		content: [{ type: "text", text: userText }],
		details: advisorLabel
			? { advisorModel: advisorLabel, errorMessage }
			: { errorMessage },
	};
}

async function executeAdvisor(
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AdvisorDetails> | undefined,
): Promise<AgentToolResult<AdvisorDetails>> {
	const advisor = getAdvisorModel();
	if (!advisor) {
		return buildErrorResult(
			undefined,
			"No advisor model is configured. The user can enable one with the /advisor command.",
			"no advisor model selected",
		);
	}
	const advisorLabel = `${advisor.provider}:${advisor.id}`;

	// Resolve auth for the advisor's provider — may differ from the executor's
	// provider; ModelRegistry looks up per model.provider independently.
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
	if (!auth.ok) {
		return buildErrorResult(
			advisorLabel,
			`Advisor (${advisorLabel}) is misconfigured: ${auth.error}`,
			auth.error,
		);
	}
	if (!auth.apiKey) {
		const msg = `no API key for ${advisor.provider}`;
		return buildErrorResult(
			advisorLabel,
			`Advisor (${advisorLabel}) has no API key available.`,
			msg,
		);
	}

	// Gather the full current branch and serialize it. At this moment the
	// in-flight assistant message (with the tool call that triggered us) is
	// already in the branch; sibling tool results from the same batch are not
	// yet (agent-loop.js:117 pushes results after executeToolCalls returns).
	const branch = ctx.sessionManager.getBranch();
	const agentMessages = branch
		.filter((e): e is SessionEntry & { type: "message" } => e.type === "message")
		.map((e) => e.message);
	const conversationText = serializeConversation(convertToLlm(agentMessages));

	const userMessage: Message = {
		role: "user",
		content: [
			{
				type: "text",
				text: `## Conversation So Far\n\n${conversationText}`,
			},
		],
		timestamp: Date.now(),
	};

	// Live UI-only status — does not land in session history; exists so the
	// user sees "Consulting advisor…" instead of a frozen tool card during
	// the blocking completeSimple call (can take 10-30s on large contexts).
	onUpdate?.({
		content: [{ type: "text", text: `Consulting advisor (${advisorLabel})…` }],
		details: { advisorModel: advisorLabel },
	});

	try {
		const response = await completeSimple(
			advisor,
			{ systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [userMessage] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal },
		);

		if (response.stopReason === "aborted") {
			return {
				content: [
					{ type: "text", text: "Advisor call was cancelled before it completed." },
				],
				details: {
					advisorModel: advisorLabel,
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
				usage: response.usage,
				stopReason: response.stopReason,
			},
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return buildErrorResult(
			advisorLabel,
			`Advisor call threw: ${message}`,
			message,
		);
	}
}

// ---------------------------------------------------------------------------
// Tool registration — zero-param schema, curated description/snippet/guidelines
// ---------------------------------------------------------------------------

const AdvisorParams = Type.Object({});

const ADVISOR_DESCRIPTION =
	"Escalate to a stronger reviewer model for guidance. When Claude needs " +
	"stronger judgment — a complex decision, an ambiguous failure, a problem " +
	"it's circling without progress — it escalates to the advisor model for " +
	"guidance, then resumes. Takes NO parameters — when you call advisor(), " +
	"your entire conversation history is automatically forwarded. The advisor " +
	"sees the task, every tool call you've made, every result you've seen.";

const ADVISOR_PROMPT_SNIPPET =
	"Escalate to a stronger reviewer model for guidance when stuck, before substantive work, or before declaring done";

const ADVISOR_PROMPT_GUIDELINES: string[] = [
	"Call `advisor` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work; writing, editing, and declaring an answer are.",
	"Also call `advisor` when you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.",
	"Also call `advisor` when stuck — errors recurring, approach not converging, results that don't fit — or when considering a change of approach.",
	"On tasks longer than a few steps, call `advisor` at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling — the advisor adds most of its value on the first call, before the approach crystallizes.",
	"Give the advisor's advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the advice is wrong, it's evidence your test doesn't check what the advice is checking.",
	"If you've already retrieved data pointing one way and the advisor points another, don't silently switch — surface the conflict in one more `advisor` call (\"I found X, you suggest Y, which constraint breaks the tie?\"). A reconcile call is cheaper than committing to the wrong branch.",
];

export function registerAdvisorTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ADVISOR_TOOL_NAME,
		label: "Advisor",
		description: ADVISOR_DESCRIPTION,
		promptSnippet: ADVISOR_PROMPT_SNIPPET,
		promptGuidelines: ADVISOR_PROMPT_GUIDELINES,
		parameters: AdvisorParams,

		async execute(_toolCallId, _params, signal, onUpdate, ctx) {
			return executeAdvisor(ctx, signal, onUpdate);
		},
	});
}

// ---------------------------------------------------------------------------
// /advisor slash command — opens selector panel for picking the advisor model
// ---------------------------------------------------------------------------

const ADVISOR_HEADER_TITLE = "Advisor Tool";

const ADVISOR_HEADER_PROSE_1 =
	"When Claude needs stronger judgment — a complex decision, an ambiguous " +
	"failure, a problem it's circling without progress — it escalates to the " +
	"advisor model for guidance, then resumes. The advisor runs server-side " +
	"and uses additional tokens.";

const ADVISOR_HEADER_PROSE_2 =
	"For certain workloads, pairing Sonnet as the main model with Opus as the " +
	"advisor gives you near-Opus performance with reduced token usage.";

const NO_ADVISOR_VALUE = "__no_advisor__";

function modelKey(m: { provider: string; id: string }): string {
	return `${m.provider}:${m.id}`;
}

export function registerAdvisorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("advisor", {
		description: "Configure the advisor model for the advisor-strategy pattern",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/advisor requires interactive mode", "error");
				return;
			}

			const availableModels = ctx.modelRegistry.getAvailable();
			const current = getAdvisorModel();
			const currentKey = current ? modelKey(current) : undefined;

			const items: SelectItem[] = availableModels.map((m) => {
				const key = modelKey(m);
				const check = key === currentKey ? " ✓" : "";
				return { value: key, label: `${m.name}  (${m.provider})${check}` };
			});
			items.push({
				value: NO_ADVISOR_VALUE,
				label: currentKey === undefined ? "No advisor ✓" : "No advisor",
			});

			const choice = await ctx.ui.custom<string | null>(
				(tui, theme, _kb, done) => {
					const container = new Container();

					container.addChild(
						new DynamicBorder((s: string) => theme.fg("accent", s)),
					);
					container.addChild(new Spacer(1));
					container.addChild(
						new Text(
							theme.fg("accent", theme.bold(ADVISOR_HEADER_TITLE)),
							1,
							0,
						),
					);
					container.addChild(new Spacer(1));
					container.addChild(new Text(ADVISOR_HEADER_PROSE_1, 1, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(ADVISOR_HEADER_PROSE_2, 1, 0));
					container.addChild(new Spacer(1));

					const selectList = new SelectList(
						items,
						Math.min(items.length, 10),
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

			if (!choice) {
				return; // user pressed Esc — no change
			}

			const activeTools = ctx.getActiveTools();
			const activeHas = activeTools.includes(ADVISOR_TOOL_NAME);

			if (choice === NO_ADVISOR_VALUE) {
				setAdvisorModel(undefined);
				if (activeHas) {
					ctx.setActiveTools(
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
			setAdvisorModel(picked);
			if (!activeHas) {
				ctx.setActiveTools([...activeTools, ADVISOR_TOOL_NAME]);
			}
			ctx.ui.notify(
				`Advisor set to ${picked.name} (${picked.provider})`,
				"info",
			);
		},
	});
}
```

### extensions/rpiv-core/index.ts:23-34 — MODIFY
Add one import and two registration calls into the existing tool-registration block. Only the modified lines are shown — implement-plan reads the unmodified original from disk.

```typescript
// At the top with the other tool-registration imports (new line between
// the existing todo.js import and the TodoOverlay import):
import { registerAdvisorTool, registerAdvisorCommand } from "./advisor.js";

// Inside the default export, in the "Register Tools & Commands" block,
// appended after the existing todo/todos registrations:
registerAdvisorTool(pi);
registerAdvisorCommand(pi);
```

## Desired End State

Usage from a consumer's perspective:

```
# User enables advisor
> /advisor
┌───────────────────────────────────────────────────────────────┐
│ Advisor Tool                                                  │
│                                                               │
│ When Claude needs stronger judgment — a complex decision, an  │
│ ambiguous failure, a problem it's circling without progress — │
│ it escalates to the advisor model for guidance, then resumes. │
│ The advisor runs server-side and uses additional tokens.      │
│                                                               │
│ For certain workloads, pairing Sonnet as the main model with  │
│ Opus as the advisor gives you near-Opus performance with      │
│ reduced token usage.                                          │
│                                                               │
│ › 1. Claude Opus 4.6           (anthropic)                    │
│   2. Claude Sonnet 4.6         (anthropic)                    │
│   3. GPT-5                     (openai)                       │
│   4. No advisor ✓                                             │
└───────────────────────────────────────────────────────────────┘
[selects Claude Opus 4.6]
✓ Advisor set to Claude Opus 4.6 (anthropic)

# Executor (Sonnet) running a task decides to consult
> advisor()                                                (tool call)
  ⏳ Consulting advisor… (model: anthropic:claude-opus-4-6)
  ✓ Advisor returned 2.1k tokens of guidance

# Executor resumes with advisor reply in its next turn's ToolResultMessage
```

And the executor's view of the tool in its system prompt, rendered via `promptSnippet` + `promptGuidelines`:

```
Available tools:
...
- advisor: Escalate to a stronger reviewer model for guidance when stuck, before substantive work, or before declaring done
...

Guidelines:
...
- Call `advisor` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work.
- Also call `advisor` when you believe the task is complete (make your deliverable durable first — write the file, save the result, commit the change); when stuck (errors recurring, approach not converging); and when considering a change of approach.
- On tasks longer than a few steps, call `advisor` at least once before committing to an approach and once before declaring done. On short reactive tasks dictated by tool output you just read, you don't need to keep calling — the advisor adds most of its value on the first call.
- Give the advisor's guidance serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the advice is wrong.
- If you've already retrieved data pointing one way and the advisor points another, don't silently switch — surface the conflict in one more advisor call: "I found X, you suggest Y, which constraint breaks the tie?"
...
```

## File Map
```
extensions/rpiv-core/advisor.ts    # NEW    — advisor tool + /advisor command (~240 lines)
extensions/rpiv-core/index.ts      # MODIFY — wire registerAdvisorTool + registerAdvisorCommand into default export
```

## Ordering Constraints
- Slice 1 (types/state/constants) must land first — Slices 2-4 all import from it.
- Slice 2 (executeAdvisor) must land before Slice 3 (registerAdvisorTool wraps it).
- Slice 3 (registerAdvisorTool) must land before Slice 4 (command calls `ctx.setActiveTools` which references the tool name — the name is defined in Slice 1's constant, but the tool must exist in the registry for `setActiveTools(["advisor"])` to have meaning).
- Slice 5 (index.ts wire-in) must land last — it imports both `registerAdvisorTool` and `registerAdvisorCommand` from advisor.ts.
- All slices are strictly sequential — no parallelism.

## Verification Notes
Converted into phased success criteria for `write-plan`:

- **Type check passes**: `bun run build` or `bunx tsc --noEmit -p extensions/rpiv-core/tsconfig.json` reports 0 errors after each slice lands.
- **Tool not visible by default**: fresh `pi -p "list your tools"` does NOT list `advisor` (default state is OFF).
- **Selector UI renders**: interactive `pi`, run `/advisor` — panel appears with prose header, dynamic model list from `modelRegistry.getAvailable()`, and "No advisor ✓" marked as current.
- **Toggle-on works**: select Opus from the panel → `ctx.ui.notify` confirms → `pi -p "list your tools"` (new session) won't work since state resets; inside the same interactive session, `/advisor` should show Opus with `✓`, and the LLM's next turn's tool registry includes `advisor`.
- **Tool collision check**: grep the extension tree for other `name: "advisor"` registrations — must be unique. `grep -rn 'name: "advisor"' extensions/` returns only the new file.
- **promptSnippet + promptGuidelines both present**: visible inspection of advisor.ts — both fields non-empty.
- **Canary end-to-end**: in an interactive session, run `/advisor` → pick Opus → ask the executor to deliberately call `advisor()` via a user message like "consult the advisor about X". Observe: "Consulting advisor… (model: anthropic:claude-opus-4-6)" in the tool card, advisor reply appears as a tool result, executor resumes with the reply on its next turn.
- **Cross-provider canary**: set executor model to an OpenAI model, set advisor to Anthropic Opus, repeat the end-to-end call. Confirm auth resolves correctly (no "no API key" error).
- **Abort mid-call**: trigger `advisor()`, then Ctrl+C during the network call. Confirm the advisor request is cancelled (no late tool result appears) and the session is clean.
- **Error path: no advisor selected**: force-call the tool without selecting a model (e.g., via `setActiveTools(["advisor"])` manually). Confirm the tool returns an error result explaining "no advisor model selected" and does NOT crash.
- **Error path: model with no auth**: pick an available model with no API key. Confirm the tool returns a structured error result, not a thrown exception.

## Performance Considerations
- **Blocking call**: `completeSimple()` to Opus may take 10-30s on large contexts. `onUpdate` emits a "Consulting advisor…" status so the tool card animates instead of appearing frozen.
- **Serialization cost**: `serializeConversation(convertToLlm(branch))` is O(n) over branch entries; fine for typical session lengths. No caching — called fresh each tool invocation.
- **Token cost**: every `advisor()` call sends the full branch. On long sessions this is expensive by design — the developer's tool-description text specifies "Call BEFORE substantive work … once before committing … once before declaring done" to keep the cadence deliberate.
- **No context-window cap**: if the serialized branch exceeds the advisor model's context window, `completeSimple()` will return an error. Acceptable failure mode for the initial scope — a tail-truncation strategy is explicitly deferred.

## Migration Notes
N/A — net-new tool, no existing state to migrate.

## Pattern References
- `extensions/rpiv-core/ask-user-question.ts:60-116` — `ctx.ui.custom()` Container + DynamicBorder + SelectList pattern. Advisor selector mirrors this.
- `extensions/rpiv-core/todo.ts:578-630` — `pi.registerTool()` with `promptSnippet` + `promptGuidelines` + `parameters` + `execute()`. Advisor tool mirrors this.
- `pi-coding-agent/examples/extensions/handoff.ts:82-108` — in-process `complete()` from within an extension, with auth resolution and context serialization. Advisor's `executeAdvisor()` mirrors this verbatim, substituting `completeSimple()` for `complete()`.
- `@tintinweb/pi-subagents/src/index.ts:1667-1670` — `pi.registerCommand("agents", ...)` with selector-opening handler. Advisor's `/advisor` command mirrors this shape (with `ctx.ui.custom` instead of `ctx.ui.select` for the richer header).

## Developer Context
**Q (design Step 5 Q1)**: How should the advisor model be configured, and can the executor override it per-invocation? Options offered: env var only / env var + per-call override / hardcoded + env var / settings.json.
**A**: "/advisor command OFF that can allow user to pick a model for adviser out of available inside of Pi's model list." — reframed config as a slash-command selector, not env var. Followed by an image mockup showing a panel titled "Advisor Tool" with prose header and numbered list (Opus 4.6 / Sonnet 4.6 / No advisor ✓).

**Q (design Step 5 Q2)**: How should /advisor resolve its arg and behave with no args? Options offered: fuzzy-id-match shortcuts + selector / hardcoded map / default-ON with auto-pick / explicit provider:id only.
**A**: "User will see the settings like we see when we call /agents command." — explicit match for the `/agents` selector-panel pattern, confirming no arg parsing is needed.

**Inline correction**: "Please notice that the list is dynamic and we have to pull the models that is available for Pi at the specific session." — lock-in that the selector list is built at command invocation from `ctx.modelRegistry.getAvailable()`, not hardcoded.

**Q (design Step 5 Q3 — rejected)**: What should the advisor see as context (executor-curated summary / raw serialized branch / tail-truncated / executor-only)?
**A**: User rejected the question and said "continue" — indicating the inherited research Developer Context decision (serialized summary, handoff.ts pattern) is sufficient and further probing was unwanted.

**Q (design Step 5 Q4 — design-brief confirmation)**: Ready to proceed? Options offered: proceed / adjust advisor system prompt / adjust context composition / change scope.
**A**: Provided the exact tool-description wording (multi-paragraph "# Advisor Tool" text with "takes NO parameters" clause and when/how guidance). This is the **executor-facing** text — splits across `description` + `promptSnippet` + `promptGuidelines`. The backend advisor system prompt (what Opus sees when consulted) stays as a separate constant in advisor.ts.

**Q (design Step 6 — decomposition approval)**: 5 slices approved (foundation → executeAdvisor → registerAdvisorTool → /advisor command → index.ts wire-in).
**A**: Approved (Recommended).

## Design History
- Slice 1: Types, module state, constants — approved as generated
- Slice 2: Context curation + completeSimple() call — approved as generated
- Slice 3: Tool registration (registerAdvisorTool) — approved as generated
- Slice 4: /advisor slash command + selector UI — approved as generated
- Slice 5: Wire into rpiv-core/index.ts — approved as generated

## References
- Research: `thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md`
- Research questions: `thoughts/shared/questions/2026-04-11_13-04-06_advisor-strategy-pattern.md`
- Reference implementation (in-process complete): `pi-coding-agent/examples/extensions/handoff.ts`
- Tool-registration template: `extensions/rpiv-core/todo.ts:578-630`
- UI pattern template: `extensions/rpiv-core/ask-user-question.ts:60-116`
- `/agents` command shape: `@tintinweb/pi-subagents/src/index.ts:1667-1670` + `showAgentsMenu` at `src/index.ts:1110-1159`
- Precedent lessons: `a01a4a3` (initial rpiv-pi, ask_user_question missing promptSnippet), `8610ae5` (rpiv-core module extraction)
