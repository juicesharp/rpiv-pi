import { readStdin } from '../lib/stdin.js';
import { initSession, pruneStaleSessionsSync } from '../lib/session-state.js';
async function main() {
    const input = await readStdin();
    initSession(input.session_id, input.cwd);
    // Opportunistic cleanup of orphaned sessions
    pruneStaleSessionsSync();
}
main().catch((err) => {
    process.stderr.write(`[rpiv] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);
});
