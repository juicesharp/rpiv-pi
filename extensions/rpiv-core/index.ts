/**
 * rpiv-core — Orchestrator extension for the rpiv-pi package
 *
 * Provides:
 * - Guidance injection (replaces inject-guidance.js hook)
 * - Git context injection (replaces !`git ...` shell evaluation in skills)
 * - thoughts/ directory scaffolding on session start
 * - Bundled-agent auto-copy into <cwd>/.pi/agents/
 * - Aggregated session_start warning for missing sibling plugins
 * - /rpiv-update-agents, /rpiv-setup slash commands
 *
 * Tool-owning plugins are siblings: @juicesharp/rpiv-ask-user-question,
 * @juicesharp/rpiv-todo, @juicesharp/rpiv-advisor, @juicesharp/rpiv-web-tools.
 * Install via /rpiv-setup.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { clearInjectionState, handleToolCallGuidance, injectRootGuidance } from "./guidance.js";
import {
	clearGitContextCache,
	isGitMutatingCommand,
	resetInjectedMarker,
	takeGitContextIfChanged,
} from "./git-context.js";
import { syncBundledAgents } from "./agents.js";
import { spawnPiInstall } from "./pi-installer.js";
import {
	hasPiSubagentsInstalled,
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

		// Inject git context once into the transcript
		const gitMsg = await takeGitContextIfChanged(pi);
		if (gitMsg) {
			pi.sendMessage({ customType: "rpiv-git-context", content: gitMsg, display: false });
		}

		// Sync bundled agents into <cwd>/.pi/agents/
		// Detect-only mode: adds new files, detects drift, does NOT overwrite or remove.
		const agentResult = syncBundledAgents(ctx.cwd, false);
		if (ctx.hasUI) {
			if (agentResult.added.length > 0) {
				ctx.ui.notify(
					`Copied ${agentResult.added.length} rpiv-pi agent(s) to .pi/agents/`,
					"info",
				);
			}
			const driftCount = agentResult.pendingUpdate.length + agentResult.pendingRemove.length;
			if (driftCount > 0) {
				const parts: string[] = [];
				if (agentResult.pendingUpdate.length > 0) {
					parts.push(`${agentResult.pendingUpdate.length} outdated`);
				}
				if (agentResult.pendingRemove.length > 0) {
					parts.push(`${agentResult.pendingRemove.length} removed from bundle`);
				}
				ctx.ui.notify(
					`${parts.join(", ")} agent(s). Run /rpiv-update-agents to sync.`,
					"info",
				);
			}
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
		clearGitContextCache();
		resetInjectedMarker();
		injectRootGuidance(ctx.cwd, pi);
		const gitMsg = await takeGitContextIfChanged(pi);
		if (gitMsg) {
			pi.sendMessage({ customType: "rpiv-git-context", content: gitMsg, display: false });
		}
	});

	// ── Session Shutdown ───────────────────────────────────────────────────
	pi.on("session_shutdown", async (_event, _ctx) => {
		clearInjectionState();
		clearGitContextCache();
		resetInjectedMarker();
	});

	// ── Guidance Injection + Git Cache Invalidation ────────────────────────
	pi.on("tool_call", async (event, ctx) => {
		handleToolCallGuidance(event, ctx, pi);
		if (isToolCallEventType("bash", event) && isGitMutatingCommand(event.input.command)) {
			clearGitContextCache();
		}
	});

	// ── Git Context Injection (only when cache diverges from transcript) ───
	pi.on("before_agent_start", async (_event, _ctx) => {
		const content = await takeGitContextIfChanged(pi);
		if (!content) return;
		return {
			message: { customType: "rpiv-git-context", content, display: false },
		};
	});

	// ── /rpiv-update-agents Command ────────────────────────────────────────
	pi.registerCommand("rpiv-update-agents", {
		description: "Sync rpiv-pi bundled agents into .pi/agents/: add new, update changed, remove stale",
		handler: async (_args, ctx) => {
			const result = syncBundledAgents(ctx.cwd, true);
			if (!ctx.hasUI) return;

			const totalSynced = result.added.length + result.updated.length + result.removed.length;
			if (totalSynced === 0 && result.errors.length === 0) {
				ctx.ui.notify("All agents already up-to-date.", "info");
				return;
			}

			const parts: string[] = [];
			if (result.added.length > 0) parts.push(`${result.added.length} added`);
			if (result.updated.length > 0) parts.push(`${result.updated.length} updated`);
			if (result.removed.length > 0) parts.push(`${result.removed.length} removed`);

			const summary = parts.length > 0
				? `Synced agents: ${parts.join(", ")}.`
				: "No changes needed.";

			if (result.errors.length > 0) {
				ctx.ui.notify(
					`${summary} ${result.errors.length} error(s): ${result.errors.map((e) => e.message).join("; ")}`,
					"warning",
				);
			} else {
				ctx.ui.notify(summary, "info");
			}
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
					const result = await spawnPiInstall(pkg, 120_000);
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
