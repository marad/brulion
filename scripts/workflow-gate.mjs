#!/usr/bin/env node

/**
 * @typedef {{ requiresTrailer: boolean, implementationPaths: string[] }} CommitClassification
 * @typedef {{ ok: boolean, requiresTrailer: boolean, hasTrailer: boolean, errors: string[] }} CommitGateResult
 * @typedef {{ command: string, args: string[] }} CommandDescriptor
 * @typedef {{ command: string, status: number | null, stdout: string, stderr: string }} CommandResult
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

/** @param {string} root @param {(command: string, args: string[]) => CommandResult} runner @returns {FullGateResult} */
export function runFastGate(root, runner) {
  throw new Error("workflow-gate stub: runFastGate");
}

/** @param {{ root: string, milestonePath: string, runner: (command: string, args: string[]) => CommandResult }} request @returns {CommandDescriptor[]} */
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
