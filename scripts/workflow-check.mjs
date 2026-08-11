#!/usr/bin/env node

/**
 * @typedef {{ currentPhase: string, lastCompletedGate: string, nextAction: string }} LedgerState
 * @typedef {{ code: string, path?: string, message: string }} WorkflowError
 * @typedef {{ status: number | null, stdout: string, stderr: string, error?: string }} CommandObservation
 * @typedef {{ root: string, milestonePath: string, requiredPaths: string[], agentsTracked: boolean, mapping: CommandObservation, specman: CommandObservation, worktreePorcelain: string[], ledgerText: string }} PreflightObservation
 * @typedef {{ state: LedgerState | null, errors: WorkflowError[] }} LedgerParseResult
 * @typedef {{ ok: boolean, milestonePath: string, ledger: LedgerState | null, checks: Record<string, boolean>, errors: WorkflowError[] }} PreflightResult
 * @typedef {{ exitCode: number, stdout: string, stderr: string }} PreflightReport
 */

/** @param {string} markdown @returns {LedgerParseResult} */
export function parseLedger(markdown) {
  throw new Error("workflow-check stub: parseLedger");
}

/** @param {PreflightObservation} observation @returns {PreflightResult} */
export function evaluatePreflight(observation) {
  throw new Error("workflow-check stub: evaluatePreflight");
}

/** @param {{ root: string, milestonePath: string }} request @returns {PreflightObservation} */
export function collectPreflightObservation(request) {
  throw new Error("workflow-check stub: collectPreflightObservation");
}

/** @param {PreflightResult} result @returns {PreflightReport} */
export function formatPreflightResult(result) {
  throw new Error("workflow-check stub: formatPreflightResult");
}

/** @param {string[]} argv @returns {number} */
export function run(argv) {
  throw new Error("workflow-check stub: run");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = run(process.argv.slice(2));
}
