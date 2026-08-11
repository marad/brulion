#!/usr/bin/env node

/**
 * @typedef {{ command: string, args: string[], status: number | null, stdout: string, stderr: string }} CommandResult
 * @typedef {{ requiresTrailer: boolean, implementationPaths: string[] }} CommitClassification
 * @typedef {{ ok: boolean, requiresTrailer: boolean, hasTrailer: boolean, errors: string[] }} CommitGateResult
 * @typedef {{ root: string, cachedDiff: CommandResult, mappingResult: CommandResult, runner: (command: string, args: string[]) => CommandResult }} FastGateRequest
 * @typedef {{ ok: boolean, checks: Record<string, boolean>, errors: string[], evidence: CommandResult[] }} FastGateResult
 * @typedef {{ root: string, milestonePath: string, mode: "pre-push" | "ci", runner: (command: string, args: string[]) => CommandResult }} FullGateRequest
 * @typedef {{ command: string, args: string[] }} CommandDescriptor
 * @typedef {{ ok: boolean, completed: CommandResult[], failed: CommandResult | null, evidence: CommandResult[] }} FullGateResult
 */

/** @param {string[]} paths @returns {CommitClassification} */
export function classifyStagedPaths(paths) {
  throw new Error("workflow-gate stub: classifyStagedPaths");
}

/** @param {string} message @param {string[]} paths @returns {CommitGateResult} */
export function validateCommitMessage(message, paths) {
  throw new Error("workflow-gate stub: validateCommitMessage");
}

/** @param {FastGateRequest} request @returns {FastGateResult} */
export function runFastGate(request) {
  throw new Error("workflow-gate stub: runFastGate");
}

/** @param {FullGateRequest} request @returns {CommandDescriptor[]} */
export function buildFullGatePlan(request) {
  throw new Error("workflow-gate stub: buildFullGatePlan");
}

/** @param {CommandDescriptor[]} commands @param {(command: string, args: string[]) => CommandResult} runner @returns {FullGateResult} */
export function executeFullGate(commands, runner) {
  throw new Error("workflow-gate stub: executeFullGate");
}

/** @param {string[]} argv @returns {number} */
export function run(argv) {
  throw new Error("workflow-gate stub: run");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = run(process.argv.slice(2));
}
