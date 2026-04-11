/**
 * Permissions seed — writes ~/.pi/agent/pi-permissions.jsonc if absent.
 *
 * Pure utility. No ExtensionAPI interactions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { PACKAGE_ROOT } from "./agents.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const BUNDLED_PERMISSIONS_TEMPLATE = join(
	PACKAGE_ROOT,
	"extensions",
	"rpiv-core",
	"templates",
	"pi-permissions.jsonc",
);

const PERMISSIONS_FILE = join(homedir(), ".pi", "agent", "pi-permissions.jsonc");

// ---------------------------------------------------------------------------
// Permissions Seed
// ---------------------------------------------------------------------------

/**
 * Seeds ~/.pi/agent/pi-permissions.jsonc with a rpiv-pi-friendly rule set if
 * the file does not yet exist. The template lives in
 * extensions/rpiv-core/templates/pi-permissions.jsonc and is copied verbatim.
 *
 * Returns true if a file was written, false if the existing file was preserved
 * or the template is missing (silent no-op — users who don't have
 * pi-permission-system installed won't ever see this file's effect).
 */
export function seedPermissionsFile(): boolean {
	if (existsSync(PERMISSIONS_FILE)) {
		return false;
	}
	if (!existsSync(BUNDLED_PERMISSIONS_TEMPLATE)) {
		return false;
	}
	try {
		mkdirSync(dirname(PERMISSIONS_FILE), { recursive: true });
		const template = readFileSync(BUNDLED_PERMISSIONS_TEMPLATE, "utf-8");
		writeFileSync(PERMISSIONS_FILE, template, "utf-8");
		return true;
	} catch {
		// Permissions or filesystem issue — non-fatal, user can seed manually later
		return false;
	}
}
