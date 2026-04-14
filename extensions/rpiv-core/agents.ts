/**
 * Agent auto-copy — copies bundled agents into <cwd>/.pi/agents/.
 *
 * Pure utility. No ExtensionAPI interactions.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	copyFileSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
} from "node:fs";
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
// Types
// ---------------------------------------------------------------------------

export interface SyncError {
	file?: string;
	op: "read-src" | "read-dest" | "copy" | "remove" | "manifest-read" | "manifest-write";
	message: string;
}

export interface SyncResult {
	/** New files copied (present in source, absent from destination). */
	added: string[];
	/** Existing managed files overwritten with updated source content. */
	updated: string[];
	/** Managed files whose destination content matches source exactly. */
	unchanged: string[];
	/** Stale managed files removed (present in manifest but absent from source). */
	removed: string[];
	/** Managed files with different destination content (detected but not applied). */
	pendingUpdate: string[];
	/** Managed files no longer in source (detected but not removed). */
	pendingRemove: string[];
	/** Per-file errors collected during sync. */
	errors: SyncError[];

	// -- Legacy aliases (backward compat for existing callers) --
	/** Alias: added + updated (files written by this run). */
	copied: string[];
	/** Alias: unchanged + pendingUpdate + files that errored during read and were not written. */
	skipped: string[];
}

/** Create an empty SyncResult with all arrays initialized. */
function emptySyncResult(): SyncResult {
	return {
		added: [],
		updated: [],
		unchanged: [],
		removed: [],
		pendingUpdate: [],
		pendingRemove: [],
		errors: [],
		copied: [],
		skipped: [],
	};
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const MANIFEST_FILE = ".rpiv-managed.json";

/**
 * Read the managed-file manifest from the target directory.
 * Returns an empty array on missing/invalid/unreadable manifest.
 * Fail-soft: never throws.
 */
function readManifest(targetDir: string): string[] {
	const manifestPath = join(targetDir, MANIFEST_FILE);
	if (!existsSync(manifestPath)) return [];
	try {
		const raw = readFileSync(manifestPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((e): e is string => typeof e === "string");
	} catch {
		return [];
	}
}

/**
 * Write the managed-file manifest to the target directory.
 * Fail-soft: swallows write errors (permissions, disk full, etc.).
 */
function writeManifest(targetDir: string, filenames: string[]): void {
	const manifestPath = join(targetDir, MANIFEST_FILE);
	try {
		writeFileSync(manifestPath, JSON.stringify(filenames, null, 2) + "\n", "utf-8");
	} catch {
		// non-fatal — sync results will still be correct for this run;
		// next run will re-bootstrap if manifest is missing
	}
}

/**
 * Bootstrap the managed-file manifest on first run after upgrade.
 *
 * When no manifest exists, claims all existing destination files whose
 * names match the current bundled source list as rpiv-managed.
 * Writes the manifest and returns the managed set.
 *
 * If a manifest already exists, returns it as-is.
 */
function bootstrapManifest(targetDir: string, sourceNames: Set<string>): string[] {
	const existing = readManifest(targetDir);
	if (existing.length > 0) return existing;

	const managed: string[] = [];
	try {
		const destEntries = readdirSync(targetDir).filter((f) => f.endsWith(".md"));
		for (const name of destEntries) {
			if (sourceNames.has(name)) {
				managed.push(name);
			}
		}
	} catch {
		// dest dir may not exist yet — that's fine, empty manifest
	}

	writeManifest(targetDir, managed);
	return managed;
}

// ---------------------------------------------------------------------------
// Agent Sync Engine
// ---------------------------------------------------------------------------

/**
 * Synchronize bundled agents from <PACKAGE_ROOT>/agents/ into <cwd>/.pi/agents/.
 *
 * When `apply` is false (session_start): adds new files only.
 * Detects pending updates and removals without applying them.
 * When `apply` is true (/rpiv-update-agents): adds new, overwrites changed
 * managed files, removes stale managed files.
 *
 * Never throws — errors are collected in `result.errors`.
 */
export function syncBundledAgents(cwd: string, apply: boolean): SyncResult {
	const result = emptySyncResult();

	if (!existsSync(BUNDLED_AGENTS_DIR)) {
		return result;
	}

	const targetDir = join(cwd, ".pi", "agents");
	try {
		mkdirSync(targetDir, { recursive: true });
	} catch {
		result.errors.push({ op: "manifest-write", message: "Failed to create target directory" });
		return result;
	}

	// 1. Enumerate source files
	let sourceEntries: string[];
	try {
		sourceEntries = readdirSync(BUNDLED_AGENTS_DIR).filter((f) => f.endsWith(".md"));
	} catch {
		result.errors.push({ op: "read-src", message: "Failed to read bundled agents directory" });
		return result;
	}

	const sourceNames = new Set(sourceEntries);

	// 2. Bootstrap manifest and get managed set
	const managedNames = new Set(bootstrapManifest(targetDir, sourceNames));

	// 3. Process each source file
	for (const entry of sourceEntries) {
		const src = join(BUNDLED_AGENTS_DIR, entry);
		const dest = join(targetDir, entry);

		if (!existsSync(dest)) {
			try {
				copyFileSync(src, dest);
				result.added.push(entry);
			} catch (e) {
				result.errors.push({
					file: entry,
					op: "copy",
					message: e instanceof Error ? e.message : String(e),
				});
			}
			continue;
		}

		let srcContent: Buffer;
		let destContent: Buffer;
		try {
			srcContent = readFileSync(src);
		} catch (e) {
			result.errors.push({
				file: entry,
				op: "read-src",
				message: e instanceof Error ? e.message : String(e),
			});
			result.skipped.push(entry);
			continue;
		}
		try {
			destContent = readFileSync(dest);
		} catch (e) {
			result.errors.push({
				file: entry,
				op: "read-dest",
				message: e instanceof Error ? e.message : String(e),
			});
			result.skipped.push(entry);
			continue;
		}

		if (Buffer.compare(srcContent, destContent) === 0) {
			result.unchanged.push(entry);
			result.skipped.push(entry);
		} else if (apply) {
			try {
				copyFileSync(src, dest);
				result.updated.push(entry);
				result.copied.push(entry);
			} catch (e) {
				result.errors.push({
					file: entry,
					op: "copy",
					message: e instanceof Error ? e.message : String(e),
				});
			}
		} else {
			result.pendingUpdate.push(entry);
			result.skipped.push(entry);
		}
	}

	// 4. Process stale managed files (in manifest but not in source)
	for (const name of managedNames) {
		if (sourceNames.has(name)) continue;

		const destPath = join(targetDir, name);
		if (!existsSync(destPath)) continue;

		if (apply) {
			try {
				unlinkSync(destPath);
				result.removed.push(name);
			} catch (e) {
				result.errors.push({
					file: name,
					op: "remove",
					message: e instanceof Error ? e.message : String(e),
				});
			}
		} else {
			result.pendingRemove.push(name);
		}
	}

	// 5. Update manifest to reflect what's currently managed on disk.
	// apply=true: stale files were removed, so manifest = sourceEntries.
	// apply=false: stale files still exist on disk and must stay tracked
	// so the next apply can remove them.
	const manifestEntries = apply
		? sourceEntries
		: [...sourceEntries, ...result.pendingRemove];
	writeManifest(targetDir, manifestEntries);

	// 6. Populate legacy `copied` alias (added + updated)
	for (const name of result.added) {
		result.copied.push(name);
	}
	// updated files were pushed to `copied` inline in the loop above

	return result;
}

// ---------------------------------------------------------------------------
// Backward-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Legacy entry point — delegates to syncBundledAgents.
 * Kept for backward compatibility; prefer syncBundledAgents for new callers.
 */
export function copyBundledAgents(cwd: string, overwrite: boolean): {
	copied: string[];
	skipped: string[];
} {
	return syncBundledAgents(cwd, overwrite);
}
