/**
 * Guidance injection — resolves and injects architecture.md guidance files.
 *
 * Pure logic + in-memory state. No ExtensionAPI interactions.
 * Called from index.ts tool_call handler.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, sep, isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Guidance Resolution (ported from scripts/lib/resolver.js + inject-guidance.js)
// ---------------------------------------------------------------------------

/**
 * Resolve architecture.md guidance files for a given file path.
 * Walks from the file's directory up to project root, checking
 * .rpiv/guidance/{dir}/architecture.md at each level.
 * Returns files ordered root-first (general → specific).
 */
export function resolveGuidance(filePath: string, projectDir: string) {
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
// Session State
// ---------------------------------------------------------------------------

/** In-memory set of injected guidance paths per session */
const injectedGuidance = new Set<string>();

export function clearInjectionState() {
	injectedGuidance.clear();
}

// ---------------------------------------------------------------------------
// Tool-call Handler
// ---------------------------------------------------------------------------

/**
 * Handle guidance injection on tool_call events for read/edit/write.
 * Sends hidden messages via pi.sendMessage as a side effect.
 */
export function handleToolCallGuidance(
	event: { toolName: string; input: Record<string, unknown> },
	ctx: { cwd: string },
	pi: ExtensionAPI,
): void {
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
}
