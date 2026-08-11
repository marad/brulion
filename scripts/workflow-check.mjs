#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ currentPhase: string, lastCompletedGate: string, nextAction: string }} LedgerState
 * @typedef {{ code: string, path?: string, message: string }} WorkflowError
 * @typedef {{ status: number | null, stdout: string, stderr: string, error?: string }} CommandObservation
 * @typedef {{ root: string, milestonePath: string, requiredPaths: string[], paths: Record<string, boolean>, agentsTracked: boolean, mapping: CommandObservation, specman: CommandObservation, worktreePorcelain: string[], ledgerText: string }} PreflightObservation
 * @typedef {{ state: LedgerState | null, errors: WorkflowError[] }} LedgerParseResult
 * @typedef {{ ok: boolean, milestonePath: string, ledger: LedgerState | null, checks: Record<string, boolean>, errors: WorkflowError[] }} PreflightResult
 * @typedef {{ exitCode: number, stdout: string, stderr: string }} PreflightReport
 */

const projectSkillPaths = [
  ".pi/skills/goal/SKILL.md",
  ".pi/skills/code-review/SKILL.md",
  ".pi/skills/review-until-clean/SKILL.md",
];

const requiredPathNames = (milestonePath) => [
  "AGENTS.md",
  "ROADMAP.md",
  "DECISIONS.md",
  milestonePath,
  ...projectSkillPaths,
];

const shellCommand = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error.message } : {}),
  };
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {string} markdown @returns {LedgerParseResult} */
export function parseLedger(markdown) {
  const fields = [
    ["Current phase", "currentPhase", "ledger-missing-current-phase"],
    [
      "Last completed gate",
      "lastCompletedGate",
      "ledger-missing-last-completed-gate",
    ],
    ["Next action", "nextAction", "ledger-missing-next-action"],
  ];
  const errors = [];
  const state = {};

  for (const [label, key, code] of fields) {
    const pattern = new RegExp(
      `^\\s*- \\*\\*${escapeRegExp(label)}:\\*\\*\\s*(.+?)\\s*$`,
      "m",
    );
    const match = markdown.match(pattern);
    if (!match || !match[1].trim()) {
      errors.push({
        code,
        message: `Workflow ledger is missing ${label}.`,
      });
      continue;
    }
    state[key] = match[1].trim();
  }

  return {
    state: errors.length === 0 ? /** @type {LedgerState} */ (state) : null,
    errors,
  };
}

/** @param {PreflightObservation} observation @returns {PreflightResult} */
export function evaluatePreflight(observation) {
  const errors = [];
  const ledgerResult = parseLedger(observation.ledgerText);
  errors.push(...ledgerResult.errors);

  for (const path of observation.requiredPaths) {
    if (observation.paths[path] !== true) {
      errors.push({
        code: "missing-path",
        path,
        message: `Required path is missing: ${path}.`,
      });
    }
  }

  if (!observation.agentsTracked) {
    errors.push({
      code: "agents-untracked",
      path: "AGENTS.md",
      message: "AGENTS.md is not tracked by Git.",
    });
  }

  if (observation.mapping.status !== 0) {
    errors.push({
      code: "mapping-unavailable",
      message: [
        "Project-local workflow mapping check failed.",
        observation.mapping.stdout,
        observation.mapping.stderr,
        observation.mapping.error,
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
    });
  }

  if (observation.specman.status !== 0) {
    errors.push({
      code: "specman-unavailable",
      message: [
        "specman status --verbose failed.",
        observation.specman.stdout,
        observation.specman.stderr,
        observation.specman.error,
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
    });
  }

  if (observation.worktreePorcelain.length > 0) {
    errors.push({
      code: "dirty-worktree",
      message: `Worktree is not clean: ${observation.worktreePorcelain.join("; ")}`,
    });
  }

  const checks = {
    requiredPathsPresent: observation.requiredPaths.every(
      (path) => observation.paths[path] === true,
    ),
    agentsTracked: observation.agentsTracked,
    mappingAvailable: observation.mapping.status === 0,
    specmanAvailable: observation.specman.status === 0,
    worktreeClean: observation.worktreePorcelain.length === 0,
    ledgerValid: ledgerResult.errors.length === 0,
  };

  return {
    ok: errors.length === 0,
    milestonePath: observation.milestonePath,
    ledger: ledgerResult.state,
    checks,
    errors,
  };
}

/** @param {{ root: string, milestonePath: string }} request @returns {PreflightObservation} */
export function collectPreflightObservation(request) {
  const root = resolve(request.root);
  const milestonePath = isAbsolute(request.milestonePath)
    ? relative(root, request.milestonePath)
    : request.milestonePath;
  const requiredPaths = requiredPathNames(milestonePath);
  const paths = Object.fromEntries(
    requiredPaths.map((path) => [path, existsSync(resolve(root, path))]),
  );
  const mapping = shellCommand(
    process.execPath,
    [resolve(root, "scripts/workflow-mapping-check.mjs"), root],
    root,
  );
  const specman = shellCommand("specman", ["status", "--verbose"], root);
  const agentsTracked = shellCommand(
    "git",
    ["ls-files", "--error-unmatch", "AGENTS.md"],
    root,
  ).status === 0;
  const worktreeStatus = shellCommand(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    root,
  );
  const ledgerText = paths[milestonePath]
    ? readFileSync(resolve(root, milestonePath), "utf8")
    : "";

  return {
    root,
    milestonePath,
    requiredPaths,
    paths,
    agentsTracked,
    mapping,
    specman,
    worktreePorcelain: worktreeStatus.stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean),
    ledgerText,
  };
}

/** @param {PreflightResult} result @returns {PreflightReport} */
export function formatPreflightResult(result) {
  if (result.ok) {
    const ledger = result.ledger;
    return {
      exitCode: 0,
      stdout: [
        `Workflow preflight OK: ${result.milestonePath}`,
        `Current phase: ${ledger?.currentPhase}`,
        `Last completed gate: ${ledger?.lastCompletedGate}`,
        `Next action: ${ledger?.nextAction}`,
      ].join("\n") + "\n",
      stderr: "",
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr:
      [
        `Workflow preflight blocked: ${result.milestonePath}`,
        ...result.errors.map(
          (error) => `- [${error.code}] ${error.path ? `${error.path}: ` : ""}${error.message}`,
        ),
      ].join("\n") + "\n",
  };
}

/** @param {string[]} argv @returns {number} */
export function run(argv) {
  if (argv[0] !== "preflight") {
    console.error("Usage: workflow-check preflight --milestone <path> [--root <path>]");
    return 2;
  }

  let milestonePath;
  let root = process.cwd();
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--milestone") milestonePath = argv[++index];
    else if (argv[index] === "--root") root = argv[++index];
    else {
      console.error(`Unknown argument: ${argv[index]}`);
      return 2;
    }
  }

  if (!milestonePath) {
    console.error("Missing required argument: --milestone <path>");
    return 2;
  }

  const result = formatPreflightResult(
    evaluatePreflight(collectPreflightObservation({ root, milestonePath })),
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
