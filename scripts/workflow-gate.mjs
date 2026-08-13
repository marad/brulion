#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverMilestonePath } from "./workflow-check.mjs";

/**
 * @typedef {{ command: string, args: string[], status: number | null, stdout: string, stderr: string, error?: string }} CommandResult
 * @typedef {{ requiresTrailer: boolean, implementationPaths: string[] }} CommitClassification
 * @typedef {{ ok: boolean, requiresTrailer: boolean, hasTrailer: boolean, errors: string[] }} CommitGateResult
 * @typedef {{ root: string, cachedDiff: CommandResult, mappingResult: CommandResult, runner: (command: string, args: string[]) => CommandResult }} FastGateRequest
 * @typedef {{ ok: boolean, checks: Record<string, boolean>, errors: string[], evidence: CommandResult[] }} FastGateResult
 * @typedef {{ root: string, milestonePath: string, mode: "pre-push" | "ci", runner: (command: string, args: string[]) => CommandResult }} FullGateRequest
 * @typedef {{ command: string, args: string[] }} CommandDescriptor
 * @typedef {{ ok: boolean, completed: CommandResult[], failed: CommandResult | null, evidence: CommandResult[] }} FullGateResult
 * @typedef {{ code: string, path?: string, message: string }} WorkflowError
 * @typedef {{ root: string, base: string, specId: string, milestonePath?: string }} PreReviewRequest
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
const artifactPairs = [
  ["extension-kit/API.md", "public/api.md"],
  ["extension-kit/api-contract.json", "public/api-contract.json"],
  ["extension-kit/brulion-extension.d.ts", "public/brulion-extension.d.ts"],
];

const verificationSection = (planText) => {
  const start = planText.indexOf("## Verification");
  if (start < 0) return "";
  const after = planText.slice(start + "## Verification".length);
  const nextHeading = after.search(/\n##\s/);
  return nextHeading < 0 ? after : after.slice(0, nextHeading);
};

/** @param {string} planId @param {string} planText @returns {string[]} */
export function findRecursiveVerification(planId, planText) {
  const commandPattern = /\bspecman\s+verify\s+(FEAT-\d+)(?![-\w])/;
  return verificationSection(planText)
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .filter((line) => line.match(commandPattern)?.[1] === planId);
}

/** @param {string} root @returns {WorkflowError[]} */
export function checkVerificationPlans(root) {
  const plansRoot = resolve(root, ".specman", "plans");
  if (!existsSync(plansRoot)) return [];
  const errors = [];
  for (const name of readdirSync(plansRoot).filter((entry) => /^FEAT-\d+\.md$/.test(entry)).sort()) {
    const planId = name.slice(0, -3);
    const path = join(".specman", "plans", name);
    let text;
    try {
      text = readFileSync(join(plansRoot, name), "utf8");
    } catch (error) {
      errors.push({
        code: "plan-unreadable",
        path,
        message: `Verification plan could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (findRecursiveVerification(planId, text).length > 0) {
      errors.push({
        code: "recursive-verification",
        path,
        message: `${path} invokes specman verify ${planId} from its own verification section.`,
      });
    }
  }
  return errors;
}

/** @param {string} root @returns {WorkflowError[]} */
export function checkDerivedArtifacts(root) {
  const errors = [];
  for (const [source, generated] of artifactPairs) {
    const sourcePath = resolve(root, source);
    const generatedPath = resolve(root, generated);
    if (!existsSync(sourcePath) || !existsSync(generatedPath)) {
      errors.push({
        code: "derived-artifact-missing",
        path: generated,
        message: `Derived artifact pair is incomplete: ${source} → ${generated}.`,
      });
      continue;
    }
    if (!readFileSync(sourcePath).equals(readFileSync(generatedPath))) {
      errors.push({
        code: "derived-artifact-drift",
        path: generated,
        message: `Derived artifact differs from its source: ${source} → ${generated}.`,
      });
    }
  }
  return errors;
}

/** @param {string} root @param {string} specId @returns {string | null} */
export function findSpecPath(root, specId) {
  const specsRoot = resolve(root, "specs");
  if (!existsSync(specsRoot)) return null;
  const prefix = `${specId}-`;
  const name = readdirSync(specsRoot)
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".md"))
    .sort()[0];
  return name ? join("specs", name) : null;
}

/** @param {PreReviewRequest} request @returns {CommandDescriptor[]} */
export function buildPreReviewPlan(request) {
  return [
    { command: "git", args: ["rev-parse", "--verify", `${request.base}^{commit}`] },
    { command: "git", args: ["rev-parse", "HEAD"] },
    { command: "git", args: ["diff", `${request.base}...HEAD`, "--check"] },
    { command: "git", args: ["diff", "--check"] },
    { command: "git", args: ["diff", "--name-only", `${request.base}...HEAD`] },
    { command: "git", args: ["diff", "--name-only"] },
    { command: process.execPath, args: ["scripts/workflow-gate.mjs", "spec-check", "--spec", request.specId] },
    { command: "specman", args: ["validate"] },
    { command: "specman", args: ["status", "--verbose"] },
    { command: process.execPath, args: ["scripts/workflow-gate.mjs", "plan-check"] },
    { command: process.execPath, args: ["scripts/workflow-gate.mjs", "artifact-check"] },
  ];
}

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
    { command: process.execPath, args: ["scripts/workflow-gate.mjs", "plan-check"] },
    { command: process.execPath, args: ["scripts/workflow-gate.mjs", "artifact-check"] },
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

/** @param {WorkflowError[]} errors */
const printWorkflowErrors = (errors) => {
  for (const error of errors) {
    console.error(`- [${error.code}] ${error.path ? `${error.path}: ` : ""}${error.message}`);
  }
};

const runInvariantCheck = (label, errors) => {
  if (errors.length > 0) {
    console.error(`${label} blocked:`);
    printWorkflowErrors(errors);
    return 1;
  }
  console.log(`${label} OK.`);
  return 0;
};

const parseValue = (argv, index, option) => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${option}.`);
    return null;
  }
  return value;
};

/** @param {PreReviewRequest} request @returns {number} */
const runPreReview = (request) => {
  const discovery = request.milestonePath
    ? { ok: true, path: request.milestonePath, reason: "explicit" }
    : discoverMilestonePath(request.root);
  if (!discovery.ok) {
    console.error("Pre-review milestone discovery blocked:");
    printWorkflowErrors(discovery.errors);
    return 1;
  }
  if (!existsSync(resolve(request.root, discovery.path))) {
    printWorkflowErrors([
      {
        code: "milestone-missing",
        path: discovery.path,
        message: "Selected milestone ledger does not exist.",
      },
    ]);
    return 1;
  }

  const result = executeFullGate(
    buildPreReviewPlan(request),
    (command, args) => runCommand(request.root, command, args),
  );
  if (!result.ok) {
    if (result.failed?.command === "git" && result.failed.args[0] === "rev-parse" && result.failed.args[1] === "--verify") {
      printWorkflowErrors([
        {
          code: "base-unavailable",
          message: result.failed.stderr || result.failed.stdout || result.failed.error || "Base commit could not be resolved.",
        },
      ]);
    }
    printResult(result);
    return 1;
  }

  const head = result.evidence.find(
    (entry) => entry.command === "git" && entry.args[0] === "rev-parse" && entry.args[1] === "HEAD",
  )?.stdout.trim();
  const committedPaths = result.evidence.find(
    (entry) => entry.command === "git" && entry.args[0] === "diff" && entry.args[1] === "--name-only",
  )?.stdout.trim();
  const workingPaths = result.evidence
    .filter((entry) => entry.command === "git" && entry.args[0] === "diff" && entry.args[1] === "--name-only")
    .at(-1)?.stdout.trim();
  const paths = [...new Set([committedPaths, workingPaths].filter(Boolean).flatMap((value) => value.split(/\r?\n/).filter(Boolean)))];

  console.log(`Workflow pre-review OK: ${discovery.path}`);
  console.log(`base: ${request.base}`);
  console.log(`HEAD: ${head || "unknown"}`);
  console.log(`spec: ${request.specId}`);
  console.log("checks:");
  console.log("- spec status: passed");
  console.log("- verification plans: passed");
  console.log("- derived artifacts: passed");
  console.log("changed paths:");
  for (const path of paths.length > 0 ? paths : ["(none)"]) console.log(`- ${path}`);
  return 0;
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

  if (mode === "plan-check") {
    return runInvariantCheck("Verification plan check", checkVerificationPlans(root));
  }

  if (mode === "artifact-check") {
    return runInvariantCheck("Derived artifact check", checkDerivedArtifacts(root));
  }

  if (mode === "spec-check") {
    const specIndex = argv.indexOf("--spec");
    const specId = specIndex >= 0 ? parseValue(argv, specIndex, "--spec") : null;
    if (!specId) return 2;
    const path = findSpecPath(root, specId);
    return path
      ? (console.log(`Spec check OK: ${specId} (${path})`), 0)
      : (printWorkflowErrors([
          { code: "spec-missing", path: specId, message: `No spec file found for ${specId}.` },
        ]), 1);
  }

  if (mode === "pre-review") {
    const baseIndex = argv.indexOf("--base");
    const specIndex = argv.indexOf("--spec");
    const milestoneIndex = argv.indexOf("--milestone");
    const base = baseIndex >= 0 ? parseValue(argv, baseIndex, "--base") : null;
    const specId = specIndex >= 0 ? parseValue(argv, specIndex, "--spec") : null;
    const milestonePath = milestoneIndex >= 0 ? parseValue(argv, milestoneIndex, "--milestone") : undefined;
    if (!base || !specId) {
      console.error("Usage: workflow-gate pre-review --base <commit> --spec <FEAT-ID> [--milestone <path>]");
      return 2;
    }
    return runPreReview({ root, base, specId, ...(milestonePath ? { milestonePath } : {}) });
  }

  if (mode === "ci" || mode === "pre-push") {
    const milestoneIndex = argv.indexOf("--milestone");
    let milestonePath = milestoneIndex >= 0 ? parseValue(argv, milestoneIndex, "--milestone") : null;
    if (milestoneIndex >= 0 && !milestonePath) return 2;
    if (!milestonePath) {
      const discovery = discoverMilestonePath(root);
      if (!discovery.ok) {
        console.error("Milestone discovery blocked:");
        printWorkflowErrors(discovery.errors);
        return 1;
      }
      milestonePath = discovery.path;
    }
    const result = executeFullGate(
      buildFullGatePlan({ root, milestonePath, mode }),
      (command, args) => runCommand(root, command, args),
    );
    printResult(result);
    return result.ok ? 0 : 1;
  }

  console.error(
    "Usage: workflow-gate <pre-commit|commit-message|pre-push|ci|pre-review|plan-check|artifact-check> [options]",
  );
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
