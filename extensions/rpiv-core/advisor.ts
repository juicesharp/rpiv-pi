/**
 * advisor tool + /advisor command — Advisor-strategy pattern.
 *
 * Lets the executor model consult a stronger advisor model (e.g. Opus) via an
 * in-process completeSimple() call with the full serialized conversation branch
 * as context. Advisor has no tools, never emits user-facing output, and returns
 * guidance (plan, correction, or stop signal) that the executor resumes with.
 *
 * Default state is OFF — the tool is registered at load but a before_agent_start
 * handler strips it from the active tool list each turn while no advisor model
 * is selected. /advisor opens a selector panel (ctx.ui.custom) to pick an
 * advisor model from ctx.modelRegistry.getAvailable() and toggles the tool in
 * via pi.setActiveTools(). Selection is in-memory and resets each session.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { completeSimple, supportsXhigh, type Message, type ThinkingLevel } from "@mariozechner/pi-ai";
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
	try {
		mkdirSync(dirname(ADVISOR_CONFIG_PATH), { recursive: true });
		writeFileSync(ADVISOR_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
	} catch {
		// write may fail on disk-full or permission errors — best effort only
	}
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
	advisorModel?: string;
	effort?: ThinkingLevel;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Module state — in-memory, resets each session
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core execute logic — curate context, call advisor, return structured result
// ---------------------------------------------------------------------------

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
	const effort = getAdvisorEffort();

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

	onUpdate?.({
		content: [{ type: "text", text: `Consulting advisor (${advisorLabel}${effort ? `, ${effort}` : ""})…` }],
		details: { advisorModel: advisorLabel, effort },
	});

	try {
		const response = await completeSimple(
			advisor,
			{ systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [userMessage] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort },
		);

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
	"Escalate to a stronger reviewer model for guidance. When you need " +
	"stronger judgment — a complex decision, an ambiguous failure, a problem " +
	"you're circling without progress — escalate to the advisor model for " +
	"guidance, then resume. Takes NO parameters — when you call advisor(), " +
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
// before_agent_start handler — strip advisor from active tools when disabled
// ---------------------------------------------------------------------------

export function registerAdvisorBeforeAgentStart(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async () => {
		if (!getAdvisorModel()) {
			const active = pi.getActiveTools();
			if (active.includes(ADVISOR_TOOL_NAME)) {
				pi.setActiveTools(active.filter((n) => n !== ADVISOR_TOOL_NAME));
			}
		}
	});
}

// ---------------------------------------------------------------------------
// /advisor slash command — opens selector panel for picking the advisor model
// ---------------------------------------------------------------------------

const ADVISOR_HEADER_TITLE = "Advisor Tool";

const ADVISOR_HEADER_PROSE_1 =
	"When the active model needs stronger judgment — a complex decision, an ambiguous " +
	"failure, a problem it's circling without progress — it escalates to the " +
	"advisor model for guidance, then resumes. The advisor runs server-side " +
	"and uses additional tokens.";

const ADVISOR_HEADER_PROSE_2 =
	"For certain workloads, pairing a faster model as the main model with a " +
	"more capable one as the advisor gives near-top-tier performance with " +
	"reduced token usage.";

const NO_ADVISOR_VALUE = "__no_advisor__";

const EFFORT_HEADER_TITLE = "Reasoning Level";

const EFFORT_HEADER_PROSE =
	"Choose the reasoning effort level for the advisor. " +
	"Higher levels produce stronger judgment but use more tokens.";

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
				return;
			}

			const activeTools = pi.getActiveTools();
			const activeHas = activeTools.includes(ADVISOR_TOOL_NAME);

			if (choice === NO_ADVISOR_VALUE) {
				setAdvisorModel(undefined);
				setAdvisorEffort(undefined);
				saveAdvisorConfig(undefined, undefined);
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
				const OFF_VALUE = "__off__";
				const baseLevels: ThinkingLevel[] = ["minimal", "low", "medium", "high"];
				const levels = supportsXhigh(picked)
					? [...baseLevels, "xhigh" as ThinkingLevel]
					: baseLevels;

				const effortItems: SelectItem[] = [
					{ value: OFF_VALUE, label: "off" },
					...levels.map((level) => ({
						value: level,
						label: level === "high" ? `${level}  (recommended)` : level,
					})),
				];

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
						const currentEffort = getAdvisorEffort();
						const defaultIdx = currentEffort
							? effortItems.findIndex((item) => item.value === currentEffort)
							: -1;
						selectList.setSelectedIndex(defaultIdx >= 0 ? defaultIdx : effortItems.findIndex((item) => item.value === "high"));
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
				effortChoice = effortResult === OFF_VALUE ? undefined : effortResult as ThinkingLevel;
			}

			setAdvisorEffort(effortChoice);
			setAdvisorModel(picked);
			saveAdvisorConfig(modelKey(picked), effortChoice);
			if (!activeHas) {
				pi.setActiveTools([...activeTools, ADVISOR_TOOL_NAME]);
			}
			ctx.ui.notify(
				`Advisor: ${picked.provider}:${picked.id}${effortChoice ? `, ${effortChoice}` : ""}`,
				"info",
			);
		},
	});
}
