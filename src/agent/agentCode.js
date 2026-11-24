/**
 * Safe Code Execution Sandbox for AI Agent
 * Enables the autonomous agent to solve complex math, parse structured data,
 * and test algorithmic solutions in an isolated VM sandbox.
 *
 * @module agent/agentCode
 */

import vm from "node:vm";

/**
 * Execute JavaScript code safely in a bounded sandbox
 *
 * @param {string} code - The JS code snippet to run
 * @param {object} [contextVars] - Optional variables injected into the execution context
 * @param {number} [timeoutMs=2000] - Execution timeout in ms
 */
export async function executeSandboxCode(code, contextVars = {}, timeoutMs = 2000) {
  const cleanCode = String(code || "").trim();
  if (!cleanCode) return { error: "No code provided to execute." };

  const logs = [];
  const sandbox = {
    ...contextVars,
    console: {
      log: (...args) => logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")),
      error: (...args) => logs.push("[ERROR] " + args.join(" ")),
      warn: (...args) => logs.push("[WARN] " + args.join(" ")),
    },
    Math,
    Date,
    JSON,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  };

  const context = vm.createContext(sandbox);

  try {
    // Wrap in IIFE if multiple statements, or direct eval
    const wrappedCode = cleanCode.includes("return ")
      ? `(function() { ${cleanCode} })()`
      : cleanCode;

    const script = new vm.Script(wrappedCode);
    const result = script.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: true,
    });

    return {
      success: true,
      result: result !== undefined ? result : (logs.length ? logs.join("\n") : "Execution completed successfully (undefined return)."),
      logs: logs.length ? logs : undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: err?.message || String(err),
      logs: logs.length ? logs : undefined,
    };
  }
}
