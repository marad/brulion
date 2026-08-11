#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ currentPhase: string, lastCompletedGate: string, nextAction: string }} LedgerState
 * @typedef {{ code: string, path?: string, message: string }} WorkflowError
 * @typedef {{ status: number | null, stdout: string, stderr: string, error?: string }} CommandObservation
 * @typedef {{ root: string, milestonePath: string, requiredPaths: string[], paths: Record<string, boolean | null>, agentsTracked: boolean, mapping: CommandObservation, specman: CommandObservation, worktreePorcelain: string[], worktreeCommandOk: boolean, ledgerText: string, ledgerReadable: boolean, collectionErrors: WorkflowError[] }} PreflightObservation
 * @typedef {{ state: LedgerState | null, errors: WorkflowError[] }} LedgerParseResult
 * @typedef {{ ok: boolean, milestonePath: string, ledger: LedgerState | null, checks: Record<string, boolean>, errors: WorkflowError[] }} PreflightResult
 * @typedef {{ exitCode: number, stdout: string, stderr: string }} PreflightReport
 * @typedef {{ ok: true, relativePath: string, absolutePath: string } | { ok: false, error: WorkflowError }} MilestonePathResult
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
const isWithin = (root, candidate) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

const findSymlink = (root, candidate) => {
  const path = relative(root, candidate);
  if (!path || path === ".." || path.startsWith(`..${sep}`)) return null;

  let current = root;
  for (const segment of path.split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return current;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  return null;
};

/** @param {string} root @param {string} requested @returns {MilestonePathResult} */
export function resolveMilestonePath(root, requested) {
  const resolvedRoot = resolve(root);
  if (typeof requested !== "string" || requested.trim() === "") {
    return {
      ok: false,
      error: {
        code: "milestone-missing",
        message: "A non-empty milestone path is required.",
      },
    };
  }

  const absolutePath = resolve(resolvedRoot, requested);
  if (!isWithin(resolvedRoot, absolutePath)) {
    return {
      ok: false,
      error: {
        code: "milestone-outside-root",
        path: requested,
        message: "Milestone path must remain inside the repository root.",
      },
    };
  }

  try {
    const symlink = findSymlink(resolvedRoot, absolutePath);
    if (symlink) {
      return {
        ok: false,
        error: {
          code: "milestone-symlink",
          path: requested,
          message: `Milestone path contains a symlink: ${relative(resolvedRoot, symlink)}.`,
        },
      };
    }
    const realRoot = realpathSync(resolvedRoot);
    const realPath = realpathSync(absolutePath);
    if (!isWithin(realRoot, realPath)) {
      return {
        ok: false,
        error: {
          code: "milestone-outside-root",
          path: requested,
          message: "Milestone path resolves outside the repository root.",
        },
      };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return {
        ok: false,
        error: {
          code: "milestone-unreadable",
          path: requested,
          message: `Milestone path could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  return {
    ok: true,
    relativePath: relative(resolvedRoot, absolutePath),
    absolutePath,
  };
}

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
  const errors = [...observation.collectionErrors];
  const ledgerResult = observation.ledgerReadable
    ? parseLedger(observation.ledgerText)
    : { state: null, errors: [] };
  errors.push(...ledgerResult.errors);

  for (const path of observation.requiredPaths) {
    if (observation.paths[path] === false) {
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
    worktreeClean:
      observation.worktreeCommandOk && observation.worktreePorcelain.length === 0,
    ledgerValid: observation.ledgerReadable && ledgerResult.errors.length === 0,
    milestonePathSafe: errors.every(
      (error) =>
        error.code !== "milestone-outside-root" && error.code !== "milestone-symlink",
    ),
  };

  return {
    ok: errors.length === 0,
    milestonePath: observation.milestonePath,
    ledger: ledgerResult.state,
    checks,
    errors,
  };
}

const inspectPath = (root, path, isMilestone, collectionErrors) => {
  try {
    lstatSync(resolve(root, path));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    collectionErrors.push({
      code: isMilestone ? "milestone-unreadable" : "path-unreadable",
      path,
      message: `Path could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
};

/** @param {{ root: string, milestonePath: string }} request @returns {PreflightObservation} */
export function collectPreflightObservation(request) {
  const root = resolve(request.root);
  const pathResult = resolveMilestonePath(root, request.milestonePath);
  const milestonePath = pathResult.ok
    ? pathResult.relativePath
    : request.milestonePath;
  const requiredPaths = pathResult.ok
    ? requiredPathNames(milestonePath)
    : ["AGENTS.md", "ROADMAP.md", "DECISIONS.md", ...projectSkillPaths];
  const collectionErrors = pathResult.ok ? [] : [pathResult.error];
  const paths = Object.fromEntries(
    requiredPaths.map((path) => [
      path,
      inspectPath(root, path, path === milestonePath, collectionErrors),
    ]),
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
  if (worktreeStatus.status !== 0) {
    collectionErrors.push({
      code: "git-unavailable",
      message: [
        "git status failed.",
        worktreeStatus.stdout,
        worktreeStatus.stderr,
        worktreeStatus.error,
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
    });
  }
  let ledgerText = "";
  let ledgerReadable = false;
  if (pathResult.ok && paths[milestonePath] === true) {
    try {
      ledgerText = readFileSync(pathResult.absolutePath, "utf8");
      ledgerReadable = true;
    } catch (error) {
      collectionErrors.push({
        code: "milestone-unreadable",
        path: milestonePath,
        message: `Milestone file could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

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
    worktreeCommandOk: worktreeStatus.status === 0,
    ledgerText,
    ledgerReadable,
    collectionErrors,
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
    const argument = argv[index];
    if (argument === "--milestone" || argument === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        console.error(`Missing value for ${argument}.`);
        return 2;
      }
      if (argument === "--milestone") milestonePath = value;
      else root = value;
      index += 1;
    } else {
      console.error(`Unknown argument: ${argument}`);
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
