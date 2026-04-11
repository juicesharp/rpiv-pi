/**
 * todo tool + /todos command — replaces Claude Code's TaskCreate/TaskUpdate.
 *
 * Registration functions: call registerTodoTool(pi) and registerTodosCommand(pi)
 * from index.ts. State is owned here and exposed via getTodos().
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Todo {
	id: number;
	text: string;
	done: boolean;
}

let todos: Todo[] = [];
let nextId = 1;

export function getTodos(): readonly Todo[] {
	return todos;
}

/**
 * Reconstruct todo state from session entries.
 * Call on session_start and session_tree.
 */
export function reconstructTodoState(ctx: any) {
	todos = [];
	nextId = 1;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
		const details = msg.details as any;
		if (details?.todos) {
			todos = details.todos;
			nextId = details.nextId ?? todos.length + 1;
		}
	}
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerTodoTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Manage a task list for tracking multi-step progress. Actions: list (show all), add (create task), toggle (mark done/pending by id), clear (remove all). Use this to create and track task lists during research, planning, and implementation.",
		promptSnippet: "Manage a task list to track multi-step progress",
		promptGuidelines: [
			"Use the todo tool (add action) to create a task list when starting multi-step work like research, planning, or implementation.",
			"Use the todo tool (toggle action) to mark tasks as completed as you finish each step.",
			"This replaces TaskCreate/TaskUpdate from other systems.",
		],
		parameters: Type.Object({
			action: StringEnum(["list", "add", "toggle", "clear"] as const),
			text: Type.Optional(Type.String({ description: "Task text (for add)" })),
			id: Type.Optional(Type.Number({ description: "Task ID (for toggle)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "list":
					return {
						content: [
							{
								type: "text",
								text: todos.length
									? todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
									: "No todos",
							},
						],
						details: { action: "list", todos: [...todos], nextId },
					};

				case "add": {
					if (!params.text) {
						return {
							content: [{ type: "text", text: "Error: text required for add" }],
							details: { action: "add", todos: [...todos], nextId, error: "text required" },
						};
					}
					const newTodo: Todo = { id: nextId++, text: params.text, done: false };
					todos.push(newTodo);
					return {
						content: [{ type: "text", text: `Added todo #${newTodo.id}: ${newTodo.text}` }],
						details: { action: "add", todos: [...todos], nextId },
					};
				}

				case "toggle": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text", text: "Error: id required for toggle" }],
							details: { action: "toggle", todos: [...todos], nextId, error: "id required" },
						};
					}
					const todo = todos.find((t) => t.id === params.id);
					if (!todo) {
						return {
							content: [{ type: "text", text: `Todo #${params.id} not found` }],
							details: { action: "toggle", todos: [...todos], nextId, error: `#${params.id} not found` },
						};
					}
					todo.done = !todo.done;
					return {
						content: [{ type: "text", text: `Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}` }],
						details: { action: "toggle", todos: [...todos], nextId },
					};
				}

				case "clear": {
					const count = todos.length;
					todos = [];
					nextId = 1;
					return {
						content: [{ type: "text", text: `Cleared ${count} todos` }],
						details: { action: "clear", todos: [], nextId: 1 },
					};
				}
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerTodosCommand(pi: ExtensionAPI): void {
	pi.registerCommand("todos", {
		description: "Show all todos on the current branch",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}
			if (todos.length === 0) {
				ctx.ui.notify("No todos yet. Ask the agent to add some!", "info");
				return;
			}
			const done = todos.filter((t) => t.done).length;
			const lines: string[] = [`${done}/${todos.length} completed\n`];
			for (const todo of todos) {
				const check = todo.done ? "✓" : "○";
				lines.push(`  ${check} #${todo.id} ${todo.text}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
