#!/usr/bin/env node

/**
 * @typedef {{ currentPhase: string, lastCompletedGate: string, nextAction: string }} LedgerState
 * @typedef {{ code: string, path?: string, message: string }} WorkflowError
 * @typedef {{ ok: boolean, milestonePath: string, ledger: LedgerState | null, checks: object, errors: WorkflowError[] }} PreflightResult
 */

/** @param {string} markdown */
export function parseLedger(markdown) {
  throw new Error("workflow-check stub: parseLedger");
}

/** @param {object} observation */
export function evaluatePreflight(observation) {
  throw new Error("workflow-check stub: evaluatePreflight");
}

/** @param {{ root: string, milestonePath: string }} request */
export function collectPreflightObservation(request) {
  throw new Error("workflow-check stub: collectPreflightObservation");
}

/** @param {PreflightResult} result */
export function formatPreflightResult(result) {
  throw new Error("workflow-check stub: formatPreflightResult");
}

/** @param {string[]} argv */
export function run(argv) {
  throw new Error("workflow-check stub: run");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2));
}
