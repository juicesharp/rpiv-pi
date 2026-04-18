/**
 * Declarative registry of rpiv-pi's sibling Pi plugins.
 *
 * Single source of truth for: presence detection (package-checks.ts),
 * session_start "missing plugins" warning (session-hooks.ts), and
 * /rpiv-setup installer (setup-command.ts). Add a sibling here and every
 * consumer picks it up automatically.
 *
 * Detection is filesystem-based via a regex over ~/.pi/agent/settings.json
 * — no runtime import of sibling packages (keeps rpiv-core pure-orchestrator).
 */

export interface SiblingPlugin {
	/** Install spec passed to `pi install`. Prefixed with `npm:` for Pi's installer. */
	readonly pkg: string;
	/** Case-insensitive regex that matches the package in ~/.pi/agent/settings.json. */
	readonly matches: RegExp;
	/** What the sibling provides — shown in /rpiv-setup confirmation and reports. */
	readonly provides: string;
}

export const SIBLINGS: readonly SiblingPlugin[] = [
	{
		pkg: "npm:@tintinweb/pi-subagents",
		matches: /@tintinweb\/pi-subagents/i,
		provides: "Agent / get_subagent_result / steer_subagent tools",
	},
	{
		pkg: "npm:@juicesharp/rpiv-ask-user-question",
		matches: /rpiv-ask-user-question/i,
		provides: "ask_user_question tool",
	},
	{
		pkg: "npm:@juicesharp/rpiv-todo",
		matches: /rpiv-todo/i,
		provides: "todo tool + /todos command + overlay widget",
	},
	{
		pkg: "npm:@juicesharp/rpiv-advisor",
		matches: /rpiv-advisor/i,
		provides: "advisor tool + /advisor command",
	},
	{
		pkg: "npm:@juicesharp/rpiv-btw",
		matches: /rpiv-btw/i,
		provides: "/btw side-question command",
	},
	{
		pkg: "npm:@juicesharp/rpiv-web-tools",
		matches: /rpiv-web-tools/i,
		provides: "web_search + web_fetch tools + /web-search-config",
	},
];
