/**
 * Cached branch + short commit for injection into every agent turn.
 * Avoids re-spawning git per turn; invalidated on git-mutating Bash calls
 * and session lifecycle events. Single `git rev-parse` call is worktree-safe
 * because git itself resolves gitdir redirection.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type GitContext = { branch: string; commit: string };

// undefined = not loaded yet, null = not a git repo / failed, object = valid
let cache: GitContext | null | undefined = undefined;

export async function getGitContext(pi: ExtensionAPI): Promise<GitContext | null> {
	if (cache !== undefined) return cache;
	cache = await loadGitContext(pi);
	return cache;
}

export function clearGitContextCache(): void {
	cache = undefined;
}

// Detached HEAD emits literal "HEAD" for --abbrev-ref; remap so frontmatter is meaningful.
async function loadGitContext(pi: ExtensionAPI): Promise<GitContext | null> {
	try {
		const r = await pi.exec(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD", "--short", "HEAD"],
			{ timeout: 5000 },
		);
		const [rawBranch = "", commit = ""] = r.stdout.trim().split("\n");
		if (!rawBranch && !commit) return null;
		const branch = rawBranch === "HEAD" ? "detached" : rawBranch;
		return { branch: branch || "no-branch", commit: commit || "no-commit" };
	} catch {
		return null;
	}
}

export function isGitMutatingCommand(cmd: string): boolean {
	return /\bgit\s+(checkout|switch|commit|merge|rebase|pull|reset|revert|cherry-pick|worktree|am|stash)\b/.test(
		cmd,
	);
}
