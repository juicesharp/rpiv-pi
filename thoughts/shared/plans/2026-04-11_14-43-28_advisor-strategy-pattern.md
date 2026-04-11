---
date: 2026-04-11T14:43:28-04:00
planner: Claude Code
git_commit: 7f7f25c
branch: master
repository: rpiv-pi
topic: "Advisor Tool + /advisor Command for rpiv-core"
tags: [plan, rpiv-core, advisor, extensions, pi-ai]
status: ready
design_source: "thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md"
last_updated: 2026-04-11
last_updated_by: Claude Code
---

# Advisor Tool + /advisor Command Implementation Plan

## Overview

Add an `advisor` extension tool and companion `/advisor` slash command to `rpiv-core`. When called, `advisor()` serializes the executor's current conversation branch, sends it to a stronger user-selected advisor model via in-process `completeSimple()`, and returns the advisor's guidance as the tool result. The `/advisor` command opens a `ctx.ui.custom` selector panel (prose header + dynamic model list from `ctx.modelRegistry.getAvailable()` + "No advisor" sentinel), and materializes the selection by toggling `"advisor"` in `ctx.setActiveTools()`.

Default state: tool registered at load but NOT in the active tool list — the executor LLM doesn't see `advisor` in its system prompt until the user opts in via `/advisor`.

Full architecture, code blocks, and decision rationale live in `thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md`. This plan defers every architectural question to that document.

## Desired End State

From a consumer's perspective:

1. A fresh `pi` session loads `rpiv-core` without errors. `pi -p "list your tools"` does NOT list `advisor` (default OFF).
2. Running `/advisor` in an interactive session opens the selector panel: bordered container with "Advisor Tool" heading, two prose paragraphs describing the pattern, and a dynamic `SelectList` containing every entry from `ctx.modelRegistry.getAvailable()` followed by a "No advisor" sentinel. The currently-selected entry is marked with `✓`.
3. Selecting a model → `ctx.ui.notify("Advisor set to …", "info")`, state updated in-memory, `"advisor"` appended to `ctx.getActiveTools()`. On the executor's next turn, the advisor tool appears in the "Available tools" section of the system prompt (via `promptSnippet`) and the five bullets from `promptGuidelines`.
4. Selecting "No advisor" → state cleared, `"advisor"` filtered out of `ctx.getActiveTools()`, tool disappears from the next system-prompt render.
5. When the executor calls `advisor()`: the tool card shows "Consulting advisor (provider:id)…" (via `onUpdate`), `completeSimple()` runs with the serialized branch as a single user message and the backend `ADVISOR_SYSTEM_PROMPT` as system prompt, the returned text is passed through byte-for-byte as `AgentToolResult.content[0].text`, and the executor resumes on its next turn with the advisor's reply in a `ToolResultMessage`.
6. Cross-provider calls work (OpenAI executor → Anthropic advisor) because auth is resolved via `ctx.modelRegistry.getApiKeyAndHeaders(advisorModel)` which keys on the advisor's provider, not the executor's.
7. User abort (Ctrl+C) during the advisor call propagates cleanly: the `signal` passed into `execute()` is forwarded into `completeSimple()`, and the tool returns a structured "cancelled" result with `stopReason: "aborted"` instead of throwing.
8. All failure modes (no model selected, auth failure, empty response, thrown network error) return structured `AgentToolResult` objects with an `errorMessage` in `details` and a user-facing text content — no uncaught exceptions.

## What We're NOT Doing

From design `## Scope → Not Building`:

- `before_provider_request`-based native Anthropic `advisor_20260301` payload injection (rejected in research; provider-specific, opaque payload, future optimization).
- Per-invocation advisor model override via tool parameters (zero-param design).
- Cross-session persistence of advisor selection (in-memory only; resets each session).
- Tail-truncation or token-budget enforcement on the serialized branch (defer until we observe real-world context blow-up on a long session).
- Advisor chains / recursive advisor (advisor's `Context` has no `tools` field; backend system prompt forbids it).
- Usage-stats streaming widget or footer status (usage lands in `details` only; UX enhancement deferred).
- Additional advisor shortcuts (`opus`, `sonnet` string args to the `/advisor` command) — superseded by the selector-panel UI.
- Web-tools access by advisor — advisor never calls tools at all.

## Phase 1: Advisor Tool + /advisor Command

### Overview

Single worktree session implements both files together. The design's Ordering Constraints note "All slices are strictly sequential — no parallelism" and nothing is reachable until the `index.ts` wire-in lands, so splitting into multiple phases would leave dead code in intermediate states. All 5 design slices (types/state/constants → `executeAdvisor` → `registerAdvisorTool` → `registerAdvisorCommand` → `index.ts` wire-in) collapse into this single phase.

### Changes Required:

#### 1. New file: `extensions/rpiv-core/advisor.ts`
**File**: `extensions/rpiv-core/advisor.ts`
**Changes**: NEW file. Contains the full advisor tool + command implementation: imports, constants (`ADVISOR_TOOL_NAME`, `ADVISOR_SYSTEM_PROMPT`), types (`AdvisorDetails`), module-scoped state (`selectedAdvisor` + `getAdvisorModel`/`setAdvisorModel`), core execute logic (`executeAdvisor`), tool registration (`registerAdvisorTool`) with curated `description` + `promptSnippet` + `promptGuidelines`, and the `/advisor` slash command (`registerAdvisorCommand`) with `ctx.ui.custom` selector panel. ~240 lines.

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

#### 2. Wire-in: `extensions/rpiv-core/index.ts`
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Add one import (grouped with the existing tool-registration imports, after the `todo-overlay` import at line 25) and two call lines inside the "Register Tools & Commands" block (appended after `registerTodosCommand(pi)` at line 34). Both calls take `pi` as their only argument — `registerAdvisorTool` wires the tool into `pi.registerTool()`, and `registerAdvisorCommand` wires the `/advisor` command into `pi.registerCommand()`. Do not touch any other lines of `index.ts`.

Import block (after line 25):
```typescript
import { TodoOverlay } from "./todo-overlay.js";
import { registerAdvisorTool, registerAdvisorCommand } from "./advisor.js";
```

Registration block (after line 34, inside the default-export function):
```typescript
	// ── Register Tools & Commands ──────────────────────────────────────────
	registerAskUserQuestionTool(pi);
	registerTodoTool(pi);
	registerTodosCommand(pi);
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
```

### Success Criteria:

#### Automated Verification:

- [x] `advisor.ts` file exists: `test -f extensions/rpiv-core/advisor.ts`
- [x] Tool name is unique in the extension tree (adapted: tool name uses `ADVISOR_TOOL_NAME` constant; grep for the constant confirms a single tool registration site)
- [x] `promptSnippet` field is present and non-empty in the tool registration: `grep -n 'promptSnippet' extensions/rpiv-core/advisor.ts` returns a line referencing `ADVISOR_PROMPT_SNIPPET`
- [x] `promptGuidelines` array is present: `grep -n 'promptGuidelines' extensions/rpiv-core/advisor.ts` returns a line referencing `ADVISOR_PROMPT_GUIDELINES`
- [x] `ADVISOR_PROMPT_GUIDELINES` has at least 5 entries (6 entries)
- [x] `signal` is forwarded to `completeSimple()` (line 151: `{ apiKey, headers, signal }`)
- [x] `setActiveTools` is called in the command handler on both selection branches (pi.setActiveTools at lines 377 and 392)
- [x] `index.ts` imports the new functions (4 matches: import line + 2 call lines)
- [x] Extension loads successfully — verified via `pi -p` invocation that enumerated `/advisor` as a registered command in `extensions/rpiv-core/advisor.ts`
- [x] Session boot does not log any import errors from `advisor.ts`

#### Manual Verification:

- [ ] **Default OFF state**: Start `pi`, run `/tools` or ask "list your available tools" — `advisor` is NOT in the list.
- [ ] **Selector renders**: Start interactive `pi`, run `/advisor`. Confirm the panel shows: bordered container, "Advisor Tool" title in accent color, two prose paragraphs, a `SelectList` with all models from `ctx.modelRegistry.getAvailable()`, followed by "No advisor ✓" as the last item (since the default is "no advisor selected").
- [ ] **Selection toggles ON**: In the selector, pick an available model (e.g. Claude Opus 4.6). Observe the toast `Advisor set to Claude Opus 4.6 (anthropic)`. Re-open `/advisor` — the picked model now shows a trailing `✓`, and "No advisor" no longer does.
- [ ] **Tool appears in system prompt after selection**: After selecting a model, start a new task and ask "what tools do you have". The executor should list `advisor` among its tools, with the `promptSnippet` text.
- [ ] **Canary end-to-end (same provider)**: With an Anthropic executor and Anthropic advisor selected, prompt the executor to deliberately consult the advisor (e.g. "call the advisor tool about how to approach X"). Observe:
  - Tool card shows "Consulting advisor (anthropic:claude-opus-4-6)…" during the call
  - After the call, the card shows the advisor's reply text
  - Executor's next turn references the advisor's guidance
- [ ] **Cross-provider canary**: Switch the executor model to an OpenAI model (e.g. GPT-5), keep Anthropic Opus as advisor, repeat the end-to-end call. Confirm auth resolves correctly — no "no API key" error even though the executor and advisor are on different providers.
- [ ] **Abort mid-call**: Trigger `advisor()` on a long-context session, press Ctrl+C while the "Consulting advisor…" status is showing. Confirm:
  - The advisor request is cancelled
  - No late tool result appears in the transcript
  - Session returns to the prompt cleanly (no uncaught exception in logs)
  - The tool result (if rendered) shows `stopReason: "aborted"` and an "Advisor call was cancelled…" message
- [ ] **Error path — no advisor selected**: Temporarily call `ctx.setActiveTools(["advisor", ...existing])` without picking a model (or edit state to clear `selectedAdvisor` while keeping the tool active), then trigger `advisor()`. Confirm the tool returns "No advisor model is configured…" with `errorMessage: "no advisor model selected"` in `details`. No thrown exception.
- [ ] **Error path — model with no auth**: Pick an available model that has no API key configured. Trigger `advisor()`. Confirm structured error result, not a crash.
- [ ] **Toggle OFF**: Re-open `/advisor`, select "No advisor". Observe the toast `Advisor disabled`. Confirm the next executor turn no longer lists `advisor` in its tools.
- [ ] **Esc cancels without side effects**: Open `/advisor`, press Esc. Confirm no toast, no state change, previous selection preserved.
- [ ] **Selector list is dynamic**: Add a new model to the Pi config mid-session (or confirm via code inspection that `getAvailable()` is called fresh inside the command handler, not cached at module load). Re-open `/advisor` — new model appears in the list.
- [ ] **Session reset**: Start a new `pi` session after selecting an advisor in the previous session. Confirm advisor state resets to "No advisor" (in-memory only, no persistence).

---

## Testing Strategy

### Automated:

The automated checks above are all grep-based static checks and a runtime load smoke test (`pi -p "…"`). There is no project-level `typecheck`/`lint`/`test` script in `package.json` — this is a pi-extension package loaded by Pi's runtime, and type errors surface at load time via Pi's loader. The `pi -p "…"` invocations serve as the type/import check because Pi refuses to boot a session if any extension fails to load.

If the worktree environment is missing peer dependencies (`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`), the load smoke test will fail with a module-resolution error — in that case, run `pi install .` from the repo root first, then re-run the smoke test.

### Manual Testing Steps:

1. Boot `pi` interactively in this repo's directory.
2. Run `/advisor` — confirm the selector panel renders with prose header + dynamic model list + "No advisor ✓" as current.
3. Pick an advisor model, confirm toast and `✓` move to the picked model on re-open.
4. Ask the executor something that would benefit from advisor consultation, or explicitly ask it to "call the advisor tool". Observe the "Consulting advisor…" status and the resulting tool card content.
5. Run through the cross-provider case: switch executor model to a different provider than the advisor, repeat the call, confirm no auth error.
6. Run through the abort case: trigger `advisor()`, press Ctrl+C during the call, confirm clean cancellation.
7. Run through each error path: no selection, no API key, force a provider error if possible.
8. Run `/advisor` → "No advisor", confirm the tool disappears from the next system-prompt render.
9. Close `pi`, reopen, confirm advisor state has reset (in-memory only).

## Performance Considerations

From design `## Performance Considerations`:

- **Blocking call**: `completeSimple()` to Opus may take 10-30s on large contexts. `onUpdate` emits a "Consulting advisor…" status once at the start of the call so the tool card animates instead of appearing frozen.
- **Serialization cost**: `serializeConversation(convertToLlm(branch))` is O(n) over branch entries; fine for typical session lengths. No caching — called fresh each tool invocation, because the branch changes between calls.
- **Token cost**: every `advisor()` call sends the full branch. On long sessions this is expensive by design — the `promptGuidelines` text enforces the "Call BEFORE substantive work … once before committing … once before declaring done" cadence to keep calls deliberate rather than chatty.
- **No context-window cap**: if the serialized branch exceeds the advisor model's context window, `completeSimple()` will return an error. The structured error path in `executeAdvisor` surfaces this cleanly (as `stopReason: "error"` + `errorMessage`). Acceptable failure mode for the initial scope — tail-truncation is explicitly deferred (see `## What We're NOT Doing`).

## Migration Notes

N/A — net-new tool and command, no existing state to migrate, no schema changes, no data migration, no rollback strategy required. Advisor selection is in-memory only and resets each session, so removing or disabling the feature in a future version is a pure code revert.

## References

- Design: `thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md`
- Research: `thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md`
- Research questions: `thoughts/shared/questions/2026-04-11_13-04-06_advisor-strategy-pattern.md`
- Pattern template (in-process `complete()`): `pi-coding-agent/examples/extensions/handoff.ts:82-108`
- Pattern template (tool registration with `promptSnippet` + `promptGuidelines`): `extensions/rpiv-core/todo.ts:578-630`
- Pattern template (`ctx.ui.custom` panel with DynamicBorder + SelectList): `extensions/rpiv-core/ask-user-question.ts:60-116`
- Pattern reference (`/agents`-style selector command): `@tintinweb/pi-subagents/src/index.ts:1667-1670` + `showAgentsMenu` at `src/index.ts:1110-1159`
- Precedent lessons: commit `a01a4a3` (missing `promptSnippet` makes tool invisible); commit `8610ae5` (rpiv-core module extraction from `index.ts`)
