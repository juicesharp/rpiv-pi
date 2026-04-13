/**
 * Package presence checks — detects whether sibling pi packages are installed.
 *
 * Pure utility. No ExtensionAPI interactions.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PI_AGENT_SETTINGS = join(homedir(), ".pi", "agent", "settings.json");

// ---------------------------------------------------------------------------
// Package Detection
// ---------------------------------------------------------------------------

export function readInstalledPackages(): string[] {
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

export function hasPiSubagentsInstalled(): boolean {
	return readInstalledPackages().some((entry) => /@tintinweb\/pi-subagents/i.test(entry));
}

export function hasPiPermissionSystemInstalled(): boolean {
	return readInstalledPackages().some((entry) => /pi-permission-system/i.test(entry));
}

export function hasRpivAskUserQuestionInstalled(): boolean {
	return readInstalledPackages().some((entry) => /rpiv-ask-user-question/i.test(entry));
}

export function hasRpivTodoInstalled(): boolean {
	return readInstalledPackages().some((entry) => /rpiv-todo/i.test(entry));
}

export function hasRpivAdvisorInstalled(): boolean {
	return readInstalledPackages().some((entry) => /rpiv-advisor/i.test(entry));
}

export function hasRpivWebToolsInstalled(): boolean {
	return readInstalledPackages().some((entry) => /rpiv-web-tools/i.test(entry));
}
