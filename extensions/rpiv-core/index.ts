/**
 * rpiv-core — Orchestrator extension for the rpiv-pi package
 *
 * Provides:
 * - Guidance injection (replaces inject-guidance.js hook)
 * - Git context injection (replaces !`git ...` shell evaluation in skills)
 * - thoughts/ directory scaffolding on session start
 * - Bundled-agent auto-copy into <cwd>/.pi/agents/
 * - active_agent seed workaround for pi-permission-system@0.4.1
 * - Aggregated session_start warning for missing sibling plugins
 * - /rpiv-update-agents, /rpiv-setup slash commands
 *
 * Tool-owning plugins are siblings: @juicesharp/rpiv-ask-user-question,
 * @juicesharp/rpiv-todo, @juicesharp/rpiv-advisor, @juicesharp/rpiv-web-tools.
 * Install via /rpiv-setup.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { clearInjectionState, handleToolCallGuidance, injectRootGuidance } from "./guidance.js";
import { copyBundledAgents } from "./agents.js";
import {
	hasPiSubagentsInstalled,
	hasPiPermissionSystemInstalled,
	hasRpivAskUserQuestionInstalled,
	hasRpivTodoInstalled,
	hasRpivAdvisorInstalled,
	hasRpivWebToolsInstalled,
} from "./package-checks.js";

export default function (pi: ExtensionAPI) {
	// ── Session Start ──────────────────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		clearInjectionState();
		injectRootGuidance(ctx.cwd, pi);

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

		// Auto-copy bundled agents into <cwd>/.pi/agents/
		const agentResult = copyBundledAgents(ctx.cwd, false);
		if (ctx.hasUI && agentResult.copied.length > 0) {
			ctx.ui.notify(
				`Copied ${agentResult.copied.length} rpiv-pi agent(s) to .pi/agents/`,
				"info",
			);
		}

		// Aggregated warning for any missing sibling plugins
		if (ctx.hasUI) {
			const missing: string[] = [];
			if (!hasPiSubagentsInstalled()) missing.push("@tintinweb/pi-subagents");
			if (!hasRpivAskUserQuestionInstalled()) missing.push("@juicesharp/rpiv-ask-user-question");
			if (!hasRpivTodoInstalled()) missing.push("@juicesharp/rpiv-todo");
			if (!hasRpivAdvisorInstalled()) missing.push("@juicesharp/rpiv-advisor");
			if (!hasRpivWebToolsInstalled()) missing.push("@juicesharp/rpiv-web-tools");
			if (missing.length > 0) {
				ctx.ui.notify(
					`rpiv-pi requires ${missing.length} sibling extension(s): ${missing.join(", ")}. Run /rpiv-setup to install them.`,
					"warning",
				);
			}
		}
	});

	// ── Session Compact — drop injection state, re-inject root guidance ────
	pi.on("session_compact", async (_event, ctx) => {
		clearInjectionState();
		injectRootGuidance(ctx.cwd, pi);
	});

	// ── Session Shutdown ───────────────────────────────────────────────────
	pi.on("session_shutdown", async (_event, _ctx) => {
		clearInjectionState();
	});

	// ── Guidance Injection ─────────────────────────────────────────────────
	pi.on("tool_call", async (event, ctx) => {
		handleToolCallGuidance(event, ctx, pi);
	});

	// ── Git Context Injection ──────────────────────────────────────────────
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

	// ── /rpiv-update-agents Command ────────────────────────────────────────
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
	pi.registerCommand("rpiv-setup", {
		description: "Install rpiv-pi's sibling extension plugins",
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
			if (!hasRpivAskUserQuestionInstalled()) {
				missing.push({
					pkg: "npm:@juicesharp/rpiv-ask-user-question",
					reason: "required — provides the ask_user_question tool",
				});
			}
			if (!hasRpivTodoInstalled()) {
				missing.push({
					pkg: "npm:@juicesharp/rpiv-todo",
					reason: "required — provides the todo tool + /todos command + overlay widget",
				});
			}
			if (!hasRpivAdvisorInstalled()) {
				missing.push({
					pkg: "npm:@juicesharp/rpiv-advisor",
					reason: "required — provides the advisor tool + /advisor command",
				});
			}
			if (!hasRpivWebToolsInstalled()) {
				missing.push({
					pkg: "npm:@juicesharp/rpiv-web-tools",
					reason: "required — provides web_search + web_fetch tools + /web-search-config",
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
