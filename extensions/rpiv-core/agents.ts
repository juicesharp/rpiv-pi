/**
 * Agent auto-copy — copies bundled agents into <cwd>/.pi/agents/.
 *
 * Pure utility. No ExtensionAPI interactions.
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Package-root resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the rpiv-pi package root from this module's file URL.
 * Walks up from `extensions/rpiv-core/agents.ts` to the repo root.
 */
export const PACKAGE_ROOT = (() => {
	const thisFile = fileURLToPath(import.meta.url);
	// extensions/rpiv-core/agents.ts -> rpiv-pi/
	return dirname(dirname(dirname(thisFile)));
})();

export const BUNDLED_AGENTS_DIR = join(PACKAGE_ROOT, "agents");

// ---------------------------------------------------------------------------
// Agent Auto-Copy
// ---------------------------------------------------------------------------

/**
 * Copies <PACKAGE_ROOT>/agents/*.md into <cwd>/.pi/agents/*.md.
 * Skip-if-exists by default; when `overwrite` is true, re-copies every file
 * and the caller is responsible for reporting the count to the user.
 */
export function copyBundledAgents(cwd: string, overwrite: boolean): {
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
