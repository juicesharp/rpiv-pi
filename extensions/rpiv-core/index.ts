/**
 * rpiv-core — Pure-orchestrator extension for rpiv-pi.
 *
 * Composes session hooks and the two slash commands. All logic lives in the
 * registrar modules; this file is the table of contents.
 *
 * Tool-owning plugins are siblings (see siblings.ts); install via /rpiv-setup.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { FLAG_DEBUG } from "./constants.js";
import { registerSessionHooks } from "./session-hooks.js";
import { registerSetupCommand } from "./setup-command.js";
import { registerUpdateAgentsCommand } from "./update-agents-command.js";

export default function (pi: ExtensionAPI) {
	pi.registerFlag(FLAG_DEBUG, {
		description: "Show injected guidance and git-context messages",
		type: "boolean",
		default: false,
	});
	registerSessionHooks(pi);
	registerUpdateAgentsCommand(pi);
	registerSetupCommand(pi);
}
