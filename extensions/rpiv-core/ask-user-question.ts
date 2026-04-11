/**
 * ask_user_question tool — replaces Claude Code's AskUserQuestion.
 *
 * Registration function: call registerAskUserQuestionTool(pi) from index.ts.
 */

import { type ExtensionAPI, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, Spacer, Text, type SelectItem } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
	const OptionSchema = Type.Object({
		label: Type.String({ description: "Display label for the option" }),
		description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
	});

	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description:
			"Ask the user a structured question with selectable options. Use when you need user input to proceed — choosing between approaches, confirming scope, resolving ambiguities. The user can also type a custom answer.",
		promptSnippet: "Ask the user a structured question when requirements are ambiguous",
		promptGuidelines: [
			"Use the ask_user_question tool whenever the user's request is underspecified and you cannot proceed without a concrete decision.",
			"Prefer ask_user_question over prose 'please tell me X' — the structured selector gives the user concrete options and records their choice in session history.",
			"This replaces the AskUserQuestion tool from Claude Code. The user can always pick 'Other (type your own answer)' for free-text input.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user" }),
			header: Type.Optional(Type.String({ description: "Section header for the question" })),
			options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
			multiSelect: Type.Optional(
				Type.Boolean({ description: "Allow multiple selections. Default: false", default: false }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
					details: { question: params.question, answer: null },
				};
			}

			if (params.options.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No options provided" }],
					details: { question: params.question, answer: null },
				};
			}

			const headerPrefix = params.header ? `[${params.header}] ` : "";
			const items = params.options.map(
				(o) => `${o.label}${o.description ? ` — ${o.description}` : ""}`,
			);

			// Add "Other (type something)" option
			const allItems = [...items, "Other (type your own answer)"];

			const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();

				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("accent", theme.bold(`${headerPrefix}${params.question}`)), 1, 0));
				container.addChild(new Spacer(1));

				const selectItems: SelectItem[] = allItems.map((item) => ({ value: item, label: item }));
				const selectList = new SelectList(selectItems, Math.min(allItems.length, 10), {
					selectedPrefix: (t) => theme.bg("selectedBg", theme.fg("accent", t)),
					selectedText: (t) => theme.bg("selectedBg", theme.bold(t)),
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);
				container.addChild(selectList);

				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
				container.addChild(new Spacer(1));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); },
				};
			});

			if (!choice) {
				return {
					content: [{ type: "text", text: "User cancelled the selection" }],
					details: { question: params.question, answer: null },
				};
			}

			// If user picked "Other", ask for free-text input
			if (choice === "Other (type your own answer)") {
				const customAnswer = await ctx.ui.input(`${params.question}`, "Type your answer...");
				return {
					content: [{ type: "text", text: `User answered: ${customAnswer ?? "(no input)"}` }],
					details: { question: params.question, answer: customAnswer ?? null, wasCustom: true },
				};
			}

			// Extract just the label (before the " — " description separator)
			const selectedLabel = choice.split(" — ")[0];
			return {
				content: [{ type: "text", text: `User selected: ${selectedLabel}` }],
				details: { question: params.question, answer: selectedLabel, wasCustom: false },
			};
		},
	});
}
