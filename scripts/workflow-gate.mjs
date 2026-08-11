#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ command: string, args: string[], status: number | null, stdout: string, stderr: string, error?: string }} CommandResult
 * @typedef {{ requiresTrailer: boolean, implementationPaths: string[] }} CommitClassification
 * @typedef {{ ok: boolean, requiresTrailer: boolean, hasTrailer: boolean, errors: string[] }} CommitGateResult
 * @typedef {{ root: string, cachedDiff: CommandResult, mappingResult: CommandResult, runner: (command: string, args: string[]) => CommandResult }} FastGateRequest
 * @typedef {{ ok: boolean, checks: Record<string, boolean>, errors: string[], evidence: CommandResult[] }} FastGateResult
 * @typedef {{ root: string, milestonePath: string, mode: "pre-push" | "ci", runner: (command: string, args: string[]) => CommandResult }} FullGateRequest
 * @typedef {{ command: string, args: string[] }} CommandDescriptor
 * @typedef {{ ok: boolean, completed: CommandResult[], failed: CommandResult | null, evidence: CommandResult[] }} FullGateResult
 */

const implementationPath = (path) =>
  /^(src|e2e|scripts|\.githooks|\.github|\.pi|public|extension-kit)\//.test(path) ||
  new Set([
    "index.html",
    "api.html",
    "workbench.html",
    "vite.config.ts",
    "tsconfig.json",
    "playwright.config.ts",
    "package.json",
    "package-lock.json",
  ]).has(path);

const runCommand = (root, command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    command,
    args,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error.message } : {}),
  };
};

const commandFailed = (result) => result.status !== 0;
const trailerPattern = /^Spec:\s+FEAT-\d+\/AC-\d+\s*$/m;
const formatCommand = (result) => [result.command, ...result.args].join(" ");

/** @param {string[]} paths @returns {CommitClassification} */
export function classifyStagedPaths(paths) {
  const implementationPaths = paths.filter(implementationPath);
  return {
    requiresTrailer: implementationPaths.length > 0,
    implementationPaths,
  };
}

/** @param {string} message @param {string[]} paths @returns {CommitGateResult} */
export function validateCommitMessage(message, paths) {
  const classification = classifyStagedPaths(paths);
  const hasTrailer = trailerPattern.test(message);
  const errors = [];

  if (classification.requiresTrailer && !hasTrailer) {
    errors.push(
      "Implementation/workflow changes require a Spec: FEAT-NNNN/AC-M trailer.",
    );
  }

  return {
    ok: errors.length === 0,
    requiresTrailer: classification.requiresTrailer,
    hasTrailer,
    errors,
  };
}

/** @param {FastGateRequest} request @returns {FastGateResult} */
export function runFastGate(request) {
  const errors = [];
  if (commandFailed(request.cachedDiff)) {
    errors.push(
      `cached diff whitespace check failed: ${request.cachedDiff.stderr || request.cachedDiff.stdout || request.cachedDiff.error || "unknown error"}`,
    );
  }
  if (commandFailed(request.mappingResult)) {
    errors.push(
      `workflow mapping check failed: ${request.mappingResult.stderr || request.mappingResult.stdout || request.mappingResult.error || "unknown error"}`,
    );
  }

  return {
    ok: errors.length === 0,
    checks: {
      cachedDiffClean: !commandFailed(request.cachedDiff),
      mappingAvailable: !commandFailed(request.mappingResult),
    },
    errors,
    evidence: [request.cachedDiff, request.mappingResult],
  };
}

/** @param {FullGateRequest} request @returns {CommandDescriptor[]} */
export function buildFullGatePlan(request) {
  if (request.mode !== "ci" && request.mode !== "pre-push") {
    throw new Error(`Unsupported full gate mode: ${request.mode}`);
  }

  return [
    {
      command: process.execPath,
      args: [
        "scripts/workflow-check.mjs",
        "preflight",
        "--milestone",
        request.milestonePath,
      ],
    },
    { command: "specman", args: ["validate"] },
    { command: "npm", args: ["run", "workflow:test"] },
    { command: "npm", args: ["test", "--", "--run"] },
    { command: "npm", args: ["run", "build"] },
    { command: "npm", args: ["run", "e2e"] },
  ];
}

/** @param {CommandDescriptor[]} commands @param {(command: string, args: string[]) => CommandResult} runner @returns {FullGateResult} */
export function executeFullGate(commands, runner) {
  const completed = [];
  const evidence = [];

  for (const descriptor of commands) {
    const result = runner(descriptor.command, descriptor.args);
    evidence.push(result);
    if (commandFailed(result)) {
      return { ok: false, completed, failed: result, evidence };
    }
    completed.push(result);
  }

  return { ok: true, completed, failed: null, evidence };
}

const stagedPaths = (root) => {
  const result = runCommand(root, "git", [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMRD",
  ]);
  return result.status === 0
    ? result.stdout.split("\n").map((path) => path.trim()).filter(Boolean)
    : [];
};

const printResult = (result) => {
  if (result.errors?.length) {
    for (const error of result.errors) console.error(`- ${error}`);
  }
  if (result.failed) {
    console.error(`Gate failed: ${formatCommand(result.failed)}`);
    if (result.failed.stdout) process.stdout.write(result.failed.stdout);
    if (result.failed.stderr) process.stderr.write(result.failed.stderr);
  }
};

const parseValue = (argv, index, option) => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${option}.`);
    return null;
  }
  return value;
};

/** @param {string[]} argv @returns {number} */
export function run(argv) {
  const mode = argv[0];
  const root = process.cwd();

  if (mode === "pre-commit") {
    const result = runFastGate({
      root,
      cachedDiff: runCommand(root, "git", ["diff", "--cached", "--check"]),
      mappingResult: runCommand(root, process.execPath, [
        "scripts/workflow-mapping-check.mjs",
        root,
      ]),
      runner: (command, args) => runCommand(root, command, args),
    });
    printResult(result);
    return result.ok ? 0 : 1;
  }

  if (mode === "commit-message") {
    const fileIndex = argv.indexOf("--file");
    const messagePath = fileIndex >= 0 ? parseValue(argv, fileIndex, "--file") : null;
    if (!messagePath) return 2;
    let message;
    try {
      message = readFileSync(messagePath, "utf8");
    } catch (error) {
      console.error(`Cannot read commit message: ${error.message}`);
      return 2;
    }
    const result = validateCommitMessage(message, stagedPaths(root));
    printResult(result);
    return result.ok ? 0 : 1;
  }

  if (mode === "ci" || mode === "pre-push") {
    const milestoneIndex = argv.indexOf("--milestone");
    const milestonePath =
      milestoneIndex >= 0
        ? parseValue(argv, milestoneIndex, "--milestone")
        : "milestones/M45.md";
    if (!milestonePath) return 2;
    const result = executeFullGate(
      buildFullGatePlan({ root, milestonePath, mode }),
      (command, args) => runCommand(root, command, args),
    );
    printResult(result);
    return result.ok ? 0 : 1;
  }

  console.error(
    "Usage: workflow-gate <pre-commit|commit-message|pre-push|ci> [options]",
  );
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
