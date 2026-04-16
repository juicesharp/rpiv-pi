/**
 * Session lifecycle wiring for rpiv-core.
 *
 * Each handler body is a named helper; pi.on(...) lines are pure wiring.
 * Ordering and invariants preserved verbatim from the pre-refactor index.ts.
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
import { syncBundledAgents, type SyncResult } from "./agents.js";
import { findMissingSiblings } from "./package-checks.js";

const THOUGHTS_DIRS = [
	"thoughts/shared/research",
	"thoughts/shared/questions",
	"thoughts/shared/designs",
	"thoughts/shared/plans",
	"thoughts/shared/handoffs",
] as const;

const msgAgentsAdded = (n: number) => `Copied ${n} rpiv-pi agent(s) to .pi/agents/`;
const msgAgentsDrift = (parts: string[]) =>
	`${parts.join(", ")} agent(s). Run /rpiv-update-agents to sync.`;
const msgMissingSiblings = (n: number, list: string) =>
	`rpiv-pi requires ${n} sibling extension(s): ${list}. Run /rpiv-setup to install them.`;

type UI = { notify: (msg: string, sev: "info" | "warning" | "error") => void };

export function registerSessionHooks(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		resetInjectionState();
		injectRootGuidance(ctx.cwd, pi);
		scaffoldThoughtsDirs(ctx.cwd);
		await injectGitContext(pi, (msg) =>
			pi.sendMessage({ customType: "rpiv-git-context", content: msg, display: !!pi.getFlag("rpiv-debug") }),
		);
		const agents = syncBundledAgents(ctx.cwd, false);
		if (ctx.hasUI) {
			notifyAgentSyncDrift(ctx.ui, agents);
			warnMissingSiblings(ctx.ui);
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		resetInjectionState();
		clearGitContextCache();
		resetInjectedMarker();
		injectRootGuidance(ctx.cwd, pi);
		await injectGitContext(pi, (msg) =>
			pi.sendMessage({ customType: "rpiv-git-context", content: msg, display: !!pi.getFlag("rpiv-debug") }),
		);
	});

	pi.on("session_shutdown", async () => {
		resetInjectionState();
		clearGitContextCache();
		resetInjectedMarker();
	});

	pi.on("tool_call", async (event, ctx) => {
		handleToolCallGuidance(event, ctx, pi);
		if (isToolCallEventType("bash", event) && isGitMutatingCommand(event.input.command)) {
			clearGitContextCache();
		}
	});

	pi.on("before_agent_start", async () => {
		const content = await takeGitContextIfChanged(pi);
		if (!content) return;
		return { message: { customType: "rpiv-git-context", content, display: !!pi.getFlag("rpiv-debug") } };
	});
}

function resetInjectionState(): void {
	clearInjectionState();
}

function scaffoldThoughtsDirs(cwd: string): void {
	for (const dir of THOUGHTS_DIRS) {
		mkdirSync(join(cwd, dir), { recursive: true });
	}
}

async function injectGitContext(
	pi: ExtensionAPI,
	send: (msg: string) => void,
): Promise<void> {
	const msg = await takeGitContextIfChanged(pi);
	if (msg) send(msg);
}

function notifyAgentSyncDrift(ui: UI, result: SyncResult): void {
	if (result.added.length > 0) {
		ui.notify(msgAgentsAdded(result.added.length), "info");
	}
	const parts: string[] = [];
	if (result.pendingUpdate.length > 0) parts.push(`${result.pendingUpdate.length} outdated`);
	if (result.pendingRemove.length > 0) parts.push(`${result.pendingRemove.length} removed from bundle`);
	if (parts.length > 0) {
		ui.notify(msgAgentsDrift(parts), "info");
	}
}

function warnMissingSiblings(ui: UI): void {
	const missing = findMissingSiblings();
	if (missing.length === 0) return;
	ui.notify(
		msgMissingSiblings(missing.length, missing.map((m) => m.pkg.replace(/^npm:/, "")).join(", ")),
		"warning",
	);
}
