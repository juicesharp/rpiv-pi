/**
 * rpiv-core — Main extension for the rpiv-pi package
 *
 * Provides:
 * - ask_user_question tool (replaces Claude Code's AskUserQuestion)
 * - todo tool (replaces Claude Code's TaskCreate/TaskUpdate)
 * - Guidance injection (replaces inject-guidance.js hook)
 * - Git context injection (replaces !`git ...` shell evaluation in skills)
 * - thoughts/ directory scaffolding on session start
 * - Bundled-agent auto-copy into <cwd>/.pi/agents/
 * - Permissions-file seeder for ~/.pi/agent/pi-permissions.jsonc
 * - /rpiv-update-agents slash command
 * - Session lifecycle management (compact cleanup, shutdown)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, relative, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Guidance Injection (ported from scripts/lib/resolver.js + inject-guidance.js)
// ---------------------------------------------------------------------------

/**
 * Resolve architecture.md guidance files for a given file path.
 * Walks from the file's directory up to project root, checking
 * .rpiv/guidance/{dir}/architecture.md at each level.
 * Returns files ordered root-first (general → specific).
 */
function resolveGuidance(filePath: string, projectDir: string) {
	const fileDir = dirname(filePath);
	const relativeDir = relative(projectDir, fileDir);

	// Guard: file is outside project root
	if (relativeDir.startsWith("..") || isAbsolute(relativeDir)) {
		return [];
	}

	const parts = relativeDir ? relativeDir.split(sep) : [];
	const results: { relativePath: string; absolutePath: string; content: string }[] = [];

	for (let depth = 0; depth <= parts.length; depth++) {
		const subPath = parts.slice(0, depth).join(sep);
		const guidanceRelative = subPath
			? join(".rpiv", "guidance", subPath, "architecture.md")
			: join(".rpiv", "guidance", "architecture.md");
		const guidanceAbsolute = join(projectDir, guidanceRelative);

		if (existsSync(guidanceAbsolute)) {
			results.push({
				relativePath: guidanceRelative.split(sep).join("/"),
				absolutePath: guidanceAbsolute,
				content: readFileSync(guidanceAbsolute, "utf-8"),
			});
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Session State (ported from scripts/lib/session-state.js)
// ---------------------------------------------------------------------------

/** In-memory set of injected guidance paths per session */
const injectedGuidance = new Set<string>();

function clearInjectionState() {
	injectedGuidance.clear();
}

// ---------------------------------------------------------------------------
// Package-root resolution (for bundled agent + permissions seed files)
// ---------------------------------------------------------------------------

/**
 * Resolves the rpiv-pi package root from this module's file URL.
 * Walks up from `extensions/rpiv-core/index.ts` to the repo root.
 */
const PACKAGE_ROOT = (() => {
	const thisFile = fileURLToPath(import.meta.url);
	// extensions/rpiv-core/index.ts -> rpiv-pi/
	return dirname(dirname(dirname(thisFile)));
})();

const BUNDLED_AGENTS_DIR = join(PACKAGE_ROOT, "agents");
const BUNDLED_PERMISSIONS_TEMPLATE = join(
	PACKAGE_ROOT,
	"extensions",
	"rpiv-core",
	"templates",
	"pi-permissions.jsonc",
);

// ---------------------------------------------------------------------------
// Agent Auto-Copy (replaces the dead pi.agents manifest field)
// ---------------------------------------------------------------------------

/**
 * Copies <PACKAGE_ROOT>/agents/*.md into <cwd>/.pi/agents/*.md.
 * Skip-if-exists by default; when `overwrite` is true, re-copies every file
 * and the caller is responsible for reporting the count to the user.
 */
function copyBundledAgents(cwd: string, overwrite: boolean): {
	copied: string[];
	skipped: string[];
} {
	const result = { copied: [] as string[], skipped: [] as string[] };

	if (!existsSync(BUNDLED_AGENTS_DIR)) {
		return result;
	}

	const targetDir = join(cwd, ".pi", "agents");
	mkdirSync(targetDir, { recursive: true });

	const entries = readdirSync(BUNDLED_AGENTS_DIR).filter((f) => f.endsWith(".md"));
	for (const entry of entries) {
		const src = join(BUNDLED_AGENTS_DIR, entry);
		const dest = join(targetDir, entry);
		if (!overwrite && existsSync(dest)) {
			result.skipped.push(entry);
			continue;
		}
		copyFileSync(src, dest);
		result.copied.push(entry);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Permissions Seed (writes ~/.pi/agent/pi-permissions.jsonc if absent)
// ---------------------------------------------------------------------------

const PERMISSIONS_FILE = join(homedir(), ".pi", "agent", "pi-permissions.jsonc");

/**
 * Seeds ~/.pi/agent/pi-permissions.jsonc with a rpiv-pi-friendly rule set if
 * the file does not yet exist. The template lives in
 * extensions/rpiv-core/templates/pi-permissions.jsonc and is copied verbatim.
 *
 * Returns true if a file was written, false if the existing file was preserved
 * or the template is missing (silent no-op — users who don't have
 * pi-permission-system installed won't ever see this file's effect).
 */
function seedPermissionsFile(): boolean {
	if (existsSync(PERMISSIONS_FILE)) {
		return false;
	}
	if (!existsSync(BUNDLED_PERMISSIONS_TEMPLATE)) {
		return false;
	}
	try {
		mkdirSync(dirname(PERMISSIONS_FILE), { recursive: true });
		const template = readFileSync(BUNDLED_PERMISSIONS_TEMPLATE, "utf-8");
		writeFileSync(PERMISSIONS_FILE, template, "utf-8");
		return true;
	} catch {
		// Permissions or filesystem issue — non-fatal, user can seed manually later
		return false;
	}
}

// ---------------------------------------------------------------------------
// pi-subagents presence check
// ---------------------------------------------------------------------------
// rpiv-pi depends on @tintinweb/pi-subagents for the Agent/get_subagent_result/
// steer_subagent tools and the /agents command. Pi has no plugin-dependency
// manifest, so we ship it as a recommended sibling and warn at session_start
// if it is missing from the user's global package list.

const PI_AGENT_SETTINGS = join(homedir(), ".pi", "agent", "settings.json");

function readInstalledPackages(): string[] {
	if (!existsSync(PI_AGENT_SETTINGS)) return [];
	try {
		const raw = readFileSync(PI_AGENT_SETTINGS, "utf-8");
		const settings = JSON.parse(raw) as { packages?: unknown };
		if (!Array.isArray(settings.packages)) return [];
		return settings.packages.filter((e): e is string => typeof e === "string");
	} catch {
		return [];
	}
}

function hasPiSubagentsInstalled(): boolean {
	return readInstalledPackages().some((entry) => /@tintinweb\/pi-subagents/i.test(entry));
}

function hasPiPermissionSystemInstalled(): boolean {
	return readInstalledPackages().some((entry) => /pi-permission-system/i.test(entry));
}

// ---------------------------------------------------------------------------
// Main Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// ── Session Start ──────────────────────────────────────────────────────
	// Scaffolds the thoughts/ directory structure and initializes state.
	pi.on("session_start", async (_event, ctx) => {
		clearInjectionState();

		// Seed a root `active_agent` session entry so pi-permission-system's
		// input handler can resolve the root context on the very first user
		// input. Without this, `/skill:<name>` as the first message of a fresh
		// session is blocked with "active agent context is unavailable" —
		// pi-permission-system@0.4.1 calls resolveAgentName(ctx) without
		// systemPrompt in its input handler, so it only checks session entries
		// and a stale cache, both empty before before_agent_start has fired.
		if (hasPiPermissionSystemInstalled()) {
			pi.appendEntry("active_agent", { name: "general-purpose" });
		}

		// Scaffold thoughts/ directory structure (artifact chain)
		const dirs = [
			"thoughts/shared/research",
			"thoughts/shared/questions",
			"thoughts/shared/designs",
			"thoughts/shared/plans",
			"thoughts/shared/handoffs",
		];
		for (const dir of dirs) {
			mkdirSync(join(ctx.cwd, dir), { recursive: true });
		}

		// Auto-copy bundled agents into <cwd>/.pi/agents/ so pi-subagents can
		// discover them. Skip-if-exists to preserve user edits; the
		// /rpiv-update-agents command forces a refresh.
		const agentResult = copyBundledAgents(ctx.cwd, false);
		if (ctx.hasUI && agentResult.copied.length > 0) {
			ctx.ui.notify(
				`Copied ${agentResult.copied.length} rpiv-pi agent(s) to .pi/agents/`,
				"info",
			);
		}

		// Seed ~/.pi/agent/pi-permissions.jsonc with rpiv-pi-friendly rules if
		// no file is present. Users who already have permissions configured
		// keep their existing rules untouched.
		const seeded = seedPermissionsFile();
		if (ctx.hasUI && seeded) {
			ctx.ui.notify(
				"Seeded ~/.pi/agent/pi-permissions.jsonc with rpiv-pi defaults",
				"info",
			);
		}

		// Warn if @tintinweb/pi-subagents is not installed. rpiv-pi's skills
		// dispatch named subagents via the Agent tool which lives ENTIRELY
		// in that package — Pi core ships no built-in subagent system, so
		// without it the Agent tool is simply unregistered and every named
		// dispatch fails with an unknown-tool error. The /rpiv-setup command
		// installs it (and the recommended pi-permission-system) with one
		// interactive confirmation.
		if (ctx.hasUI && !hasPiSubagentsInstalled()) {
			ctx.ui.notify(
				"rpiv-pi needs @tintinweb/pi-subagents for the Agent tool. Run /rpiv-setup to install it.",
				"warning",
			);
		}
	});

	// ── Session Compact ────────────────────────────────────────────────────
	// Clear injection markers so guidance re-injects post-compaction.
	pi.on("session_compact", async (_event, _ctx) => {
		clearInjectionState();
	});

	// ── Session Shutdown ───────────────────────────────────────────────────
	pi.on("session_shutdown", async (_event, _ctx) => {
		clearInjectionState();
	});

	// ── Guidance Injection (replaces PreToolUse hook on Read|Edit|Write) ───
	pi.on("tool_call", async (event, ctx) => {
		if (!["read", "edit", "write"].includes(event.toolName)) return;

		const filePath = (event.input as any).file_path ?? (event.input as any).path;
		if (!filePath) return;

		const resolved = resolveGuidance(filePath, ctx.cwd);
		if (resolved.length === 0) return;

		const newFiles = resolved.filter((g) => !injectedGuidance.has(g.relativePath));
		if (newFiles.length === 0) return;

		// Mark as injected
		for (const g of newFiles) {
			injectedGuidance.add(g.relativePath);
		}

		// Build context and inject as a hidden message
		const contextParts = newFiles.map((g) => {
			const label =
				g.relativePath
					.replace(".rpiv/guidance/", "")
					.replace(/\/?architecture\.md$/, "") || "root";
			return `## Architecture Guidance: ${label}\n\n${g.content}`;
		});

		pi.sendMessage({
			customType: "rpiv-guidance",
			content: contextParts.join("\n\n---\n\n"),
			display: false,
		});
	});

	// ── Git Context Injection ──────────────────────────────────────────────
	// Replaces the !`git ...` shell evaluation that skills used for Git Context.
	pi.on("before_agent_start", async (_event, ctx) => {
		try {
			const branch = await pi.exec("git", ["branch", "--show-current"], { timeout: 5000 });
			const commit = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { timeout: 5000 });

			if (branch.stdout.trim() || commit.stdout.trim()) {
				return {
					message: {
						customType: "rpiv-git-context",
						content: `## Git Context\n- Branch: ${branch.stdout.trim() || "no-branch"}\n- Commit: ${commit.stdout.trim() || "no-commit"}`,
						display: false,
					},
				};
			}
		} catch {
			// Not a git repo — skip silently
		}
	});

	// ── ask_user_question Tool ─────────────────────────────────────────────
	// Replaces Claude Code's AskUserQuestion tool.
	// Wraps ctx.ui.select() as an LLM-callable tool.

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
			multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple selections. Default: false", default: false })),
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

			const choice = await ctx.ui.select(`${headerPrefix}${params.question}`, allItems);

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

	// ── todo Tool ──────────────────────────────────────────────────────────
	// Replaces Claude Code's TaskCreate/TaskUpdate.
	// Based on the Pi todo.ts example pattern.

	interface Todo {
		id: number;
		text: string;
		done: boolean;
	}

	let todos: Todo[] = [];
	let nextId = 1;

	// Reconstruct state from session entries on load
	const reconstructTodoState = (ctx: any) => {
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
	};

	pi.on("session_start", async (_event, ctx) => reconstructTodoState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructTodoState(ctx));

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

	// ── /todos Command ─────────────────────────────────────────────────────
	pi.registerCommand("todos", {
		description: "Show all todos on the current branch",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}
			const lines: string[] = [];
			if (todos.length === 0) {
				ctx.ui.notify("No todos yet. Ask the agent to add some!", "info");
				return;
			}
			const done = todos.filter((t) => t.done).length;
			lines.push(`${done}/${todos.length} completed\n`);
			for (const todo of todos) {
				const check = todo.done ? "✓" : "○";
				lines.push(`  ${check} #${todo.id} ${todo.text}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── /rpiv-update-agents Command ────────────────────────────────────────
	// Force-refresh bundled agents into <cwd>/.pi/agents/ (overwrite mode).
	pi.registerCommand("rpiv-update-agents", {
		description: "Re-copy rpiv-pi's bundled agents into .pi/agents/, overwriting local edits",
		handler: async (_args, ctx) => {
			const result = copyBundledAgents(ctx.cwd, true);
			if (!ctx.hasUI) return;
			if (result.copied.length === 0) {
				ctx.ui.notify("No bundled agents found to copy", "warning");
				return;
			}
			ctx.ui.notify(
				`Refreshed ${result.copied.length} agent(s) in .pi/agents/: ${result.copied.join(", ")}`,
				"info",
			);
		},
	});

	// ── /rpiv-setup Command ────────────────────────────────────────────────
	// Installs the sibling packages rpiv-pi depends on. Pi has no plugin
	// dependency manifest, so we ask the user for one explicit confirmation
	// and then invoke `pi install npm:<pkg>` for each missing package.
	// A session restart is required to actually load the new extensions —
	// we surface that clearly at the end.
	pi.registerCommand("rpiv-setup", {
		description: "Install rpiv-pi's sibling dependencies (pi-subagents, pi-permission-system)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/rpiv-setup requires interactive mode", "error");
				return;
			}

			const missing: Array<{ pkg: string; reason: string }> = [];
			if (!hasPiSubagentsInstalled()) {
				missing.push({
					pkg: "npm:@tintinweb/pi-subagents",
					reason: "required — provides Agent / get_subagent_result / steer_subagent tools",
				});
			}
			if (!hasPiPermissionSystemInstalled()) {
				missing.push({
					pkg: "npm:pi-permission-system",
					reason: "recommended — enforces the rules rpiv-core seeds on first run",
				});
			}

			if (missing.length === 0) {
				ctx.ui.notify(
					"All rpiv-pi sibling dependencies already installed.",
					"info",
				);
				return;
			}

			const lines = [
				"rpiv-pi will install the following Pi packages via `pi install`:",
				"",
				...missing.map((m) => `  • ${m.pkg}  (${m.reason})`),
				"",
				"Each install is a separate `pi install <pkg>` invocation. Your",
				"~/.pi/agent/settings.json will be updated. Proceed?",
			];

			const confirmed = await ctx.ui.confirm("Install rpiv-pi dependencies?", lines.join("\n"));
			if (!confirmed) {
				ctx.ui.notify("/rpiv-setup cancelled", "info");
				return;
			}

			const succeeded: string[] = [];
			const failed: Array<{ pkg: string; error: string }> = [];
			for (const { pkg } of missing) {
				ctx.ui.notify(`Installing ${pkg}…`, "info");
				try {
					const result = await pi.exec("pi", ["install", pkg], { timeout: 120_000 });
					if (result.code === 0) {
						succeeded.push(pkg);
					} else {
						failed.push({
							pkg,
							error: (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 300),
						});
					}
				} catch (err) {
					failed.push({
						pkg,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			const report: string[] = [];
			if (succeeded.length > 0) {
				report.push(`✓ Installed: ${succeeded.join(", ")}`);
			}
			if (failed.length > 0) {
				report.push(`✗ Failed:`);
				for (const { pkg, error } of failed) {
					report.push(`  ${pkg}: ${error}`);
				}
			}
			if (succeeded.length > 0) {
				report.push("");
				report.push("Restart your Pi session to load the newly-installed extensions.");
			}
			ctx.ui.notify(report.join("\n"), failed.length > 0 ? "warning" : "info");
		},
	});
}
