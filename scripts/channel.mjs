/**
 * channel.mjs — Channel resolver utility
 *
 * Finds channel name from --channel=name CLI arg or auto-detects the single
 * channel if only one exists inside the channels/ directory.
 *
 * Exports:
 *   resolveChannel(argv?)  → { name, root, configPath, bgPath, envPath } | null
 *   loadChannelEnv(name)   — loads channels/<name>/.env.channel into process.env
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve }                               from "node:path";
import { fileURLToPath }                         from "node:url";

const PROJECT_ROOT  = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHANNELS_DIR  = resolve(PROJECT_ROOT, "channels");

/**
 * Parse --channel=name from an argv array (defaults to process.argv).
 * Returns the channel name string or null if not present.
 */
export function parseChannelArg(argv = process.argv) {
  const flag = argv.find(a => a.startsWith("--channel="));
  return flag ? flag.split("=")[1].trim() : null;
}

/**
 * List all channel names found under channels/ directory.
 * Returns an empty array if channels/ doesn't exist.
 */
export function listChannels() {
  if (!existsSync(CHANNELS_DIR)) return [];
  return readdirSync(CHANNELS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

/**
 * Build a channel descriptor object for the given channel name.
 * Falls back gracefully to legacy public/ paths.
 */
export function channelDescriptor(name) {
  const root       = resolve(CHANNELS_DIR, name);
  const configPath = resolve(root, "config.json");
  const bgNew      = resolve(root, "bg.png");
  const bgOld      = resolve(PROJECT_ROOT, "public/assets/background.png");
  const bgPath     = existsSync(bgNew) ? bgNew : bgOld;
  const envPath    = resolve(root, ".env.channel");
  return { name, root, configPath, bgPath, envPath };
}

/**
 * Resolve which channel to use.
 *
 * Priority:
 *   1. --channel=name CLI arg
 *   2. Auto-select if exactly one channel exists in channels/
 *   3. Return null → caller should fall back to legacy behaviour
 *
 * @param {string[]} [argv] — defaults to process.argv
 * @returns {{ name, root, configPath, bgPath, envPath } | null}
 */
export function resolveChannel(argv = process.argv) {
  // 1. Explicit --channel=name arg
  const argName = parseChannelArg(argv);
  if (argName) {
    const channels = listChannels();
    if (!channels.includes(argName)) {
      console.warn(`⚠  Channel "${argName}" not found in channels/. Available: ${channels.join(", ") || "(none)"}`);
    }
    return channelDescriptor(argName);
  }

  // 2. Auto-detect single channel
  const channels = listChannels();
  if (channels.length === 1) {
    return channelDescriptor(channels[0]);
  }

  // 3. No channel — use legacy defaults
  return null;
}

/**
 * Load channels/<name>/.env.channel into process.env (non-overwriting).
 * Does nothing if the file doesn't exist.
 */
export function loadChannelEnv(name) {
  const envPath = resolve(CHANNELS_DIR, name, ".env.channel");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
}
