/**
 * Plug-and-play loader for the optional AI Agent plugin suite (src/agent/plugin.js).
 * If src/agent/ is deleted, no agent commands are registered and the bot runs normally.
 */

import fs from "fs";

if (fs.existsSync(new URL("../agent/plugin.js", import.meta.url))) {
  await import("../agent/plugin.js");
}
