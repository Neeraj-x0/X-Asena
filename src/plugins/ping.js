/**
 * Ping Command — single-message response
 */

import { command } from "../plugins.js";
import { reply } from "../utils/message.js";

command(
  {
    pattern: "ping",
    fromMe: false,
    desc: "Check bot response time",
    usage: "#ping",
    params: { argsRequired: false, requiresQuoted: false, format: "", description: "Measures round-trip latency in milliseconds." },
    type: "info",
  },
  async (message, conn) => {
    const start = Date.now();
    await reply(conn, message, `Pong · ${Date.now() - start}ms`);
  }
);
