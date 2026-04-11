import { readStdin } from '../lib/stdin.js';
import { resolveGuidance } from '../lib/resolver.js';
import { isInjected, markInjected } from '../lib/session-state.js';
async function main() {
    const input = await readStdin();
    if (input.hook_event_name !== 'PreToolUse')
        return;
    // Extract file_path from tool_input
    const filePath = input.tool_input.file_path
        ?? input.tool_input.path;
    if (!filePath)
        return; // No file path — nothing to resolve (e.g., Glob with pattern only)
    // Resolve guidance chain
    const resolved = resolveGuidance(filePath, input.cwd);
    if (resolved.length === 0)
        return; // No .rpiv/guidance/ in this project
    // Filter out already-injected files (race-safe marker check)
    const newFiles = resolved.filter((g) => !isInjected(input.session_id, g.relativePath));
    if (newFiles.length === 0)
        return; // Everything already injected
    process.stderr.write(`[rpiv:debug] injecting ${newFiles.length} files: ${newFiles.map(f => f.relativePath).join(', ')}\n`);
    // Build context string
    const contextParts = newFiles.map((g) => {
        const label = g.relativePath
            .replace('.rpiv/guidance/', '')
            .replace(/\/?architecture\.md$/, '') || 'root';
        return `## Architecture Guidance: ${label}\n\n${g.content}`;
    });
    const output = {
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: contextParts.join('\n\n---\n\n'),
        },
    };
    // Output to stdout for Claude Code to consume
    process.stdout.write(JSON.stringify(output));
    // Mark as injected (race-safe marker write)
    for (const g of newFiles) {
        markInjected(input.session_id, g.relativePath);
    }
}
main().catch((err) => {
    process.stderr.write(`[rpiv] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);
});
