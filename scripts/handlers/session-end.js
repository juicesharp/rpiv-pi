import { readStdin } from '../lib/stdin.js';
import { deleteSession, pruneStaleSessionsSync } from '../lib/session-state.js';
async function main() {
    const input = await readStdin();
    deleteSession(input.session_id);
    pruneStaleSessionsSync();
}
main().catch((err) => {
    process.stderr.write(`[rpiv] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);
});
