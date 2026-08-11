import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  collectPreflightObservation,
  evaluatePreflight,
  formatPreflightResult,
  parseLedger,
  resolveMilestonePath,
  run,
} from "./workflow-check.mjs";

const milestonePath = "milestones/M45.md";
const validLedger = `
## Workflow ledger

- **Current phase:** P1 — read-only preflight and phase-ledger checker
- **Last completed gate:** P0 — FEAT-0095 sealed
- **Next action:** implement FEAT-0096
`;

const validObservation = () => ({
  root: process.cwd(),
  milestonePath,
  paths: {
    "AGENTS.md": true,
    "ROADMAP.md": true,
    "DECISIONS.md": true,
    [milestonePath]: true,
    ".pi/skills/goal/SKILL.md": true,
    ".pi/skills/code-review/SKILL.md": true,
    ".pi/skills/review-until-clean/SKILL.md": true,
  },
  requiredPaths: [
    "AGENTS.md",
    "ROADMAP.md",
    "DECISIONS.md",
    milestonePath,
  ],
  agentsTracked: true,
  mapping: { status: 0, stdout: "workflow mapping OK", stderr: "" },
  specman: { status: 0, stdout: "FEAT-0096 new", stderr: "" },
  worktreePorcelain: [],
  worktreeCommandOk: true,
  ledgerText: validLedger,
  ledgerReadable: true,
  collectionErrors: [],
});

test("parses a valid workflow ledger", () => {
  const result = parseLedger(validLedger);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.state, {
    currentPhase: "P1 — read-only preflight and phase-ledger checker",
    lastCompletedGate: "P0 — FEAT-0095 sealed",
    nextAction: "implement FEAT-0096",
  });
});

test("rejects a missing CLI option operand", () => {
  assert.equal(run(["preflight", "--root"]), 2);
});

test("rejects absolute and symlinked milestone paths outside the root", () => {
  const root = mkdtempSync(join(process.cwd(), "workflow-root-"));
  const outside = mkdtempSync(join(process.cwd(), "workflow-outside-"));
  const outsideFile = join(outside, "secret.md");
  const symlinkPath = join(root, "milestones", "escape.md");
  const danglingPath = join(root, "milestones", "dangling.md");

  try {
    mkdirSync(join(root, "milestones"));
    writeFileSync(outsideFile, "secret");
    symlinkSync(outsideFile, symlinkPath);
    symlinkSync(join(outside, "missing.md"), danglingPath);

    assert.equal(resolveMilestonePath(root, "/etc/hosts").ok, false);
    for (const candidate of ["milestones/escape.md", "milestones/dangling.md"]) {
      const symlinkResult = resolveMilestonePath(root, candidate);
      assert.equal(symlinkResult.ok, false, candidate);
      assert.equal(symlinkResult.error.code, "milestone-symlink", candidate);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("reports an unreadable milestone path instead of throwing", () => {
  const root = mkdtempSync(join(process.cwd(), "workflow-root-"));

  try {
    mkdirSync(join(root, "milestones"));
    const observation = collectPreflightObservation({
      root,
      milestonePath: "milestones",
    });
    const result = evaluatePreflight(observation);

    assert.ok(
      result.errors.some((error) => error.code === "milestone-unreadable"),
    );
    assert.equal(
      result.errors.some((error) => error.code.startsWith("ledger-missing-")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports an unreadable milestone file when permissions allow the probe", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root can bypass file permissions");
    return;
  }

  const root = mkdtempSync(join(process.cwd(), "workflow-root-"));
  const milestone = join(root, "milestones", "blocked.md");

  try {
    mkdirSync(join(root, "milestones"));
    writeFileSync(milestone, validLedger);
    chmodSync(milestone, 0o000);
    const observation = collectPreflightObservation({
      root,
      milestonePath: "milestones/blocked.md",
    });
    const result = evaluatePreflight(observation);

    assert.ok(
      result.errors.some((error) => error.code === "milestone-unreadable"),
    );
    assert.equal(
      result.errors.some(
        (error) => error.code === "missing-path" && error.path === "milestones/blocked.md",
      ),
      false,
    );
  } finally {
    chmodSync(milestone, 0o600);
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports a distinct error for every missing ledger label", () => {
  const cases = [
    ["Current phase", "ledger-missing-current-phase"],
    ["Last completed gate", "ledger-missing-last-completed-gate"],
    ["Next action", "ledger-missing-next-action"],
  ];

  for (const [label, code] of cases) {
    const malformed = validLedger
      .split("\n")
      .filter((line) => !line.includes(`**${label}:**`))
      .join("\n");
    const result = parseLedger(malformed);

    assert.equal(result.state, null, label);
    assert.ok(result.errors.some((error) => error.code === code), label);
  }
});

test("evaluates a valid preflight observation", () => {
  const result = evaluatePreflight(validObservation());

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.milestonePath, milestonePath);
  assert.deepEqual(result.ledger, {
    currentPhase: "P1 — read-only preflight and phase-ledger checker",
    lastCompletedGate: "P0 — FEAT-0095 sealed",
    nextAction: "implement FEAT-0096",
  });
  const report = formatPreflightResult(result);
  assert.equal(report.exitCode, 0);
  assert.match(report.stdout, /Workflow preflight OK/);
});

test("aggregates every missing-path error", () => {
  const observation = validObservation();
  observation.paths = {
    ...observation.paths,
    "ROADMAP.md": false,
    "DECISIONS.md": false,
  };

  const result = evaluatePreflight(observation);
  const missing = result.errors.filter((error) => error.code === "missing-path");

  assert.equal(result.ok, false);
  assert.deepEqual(
    missing.map((error) => error.path),
    ["ROADMAP.md", "DECISIONS.md"],
  );
});

test("blocks a dirty worktree", () => {
  const observation = validObservation();
  observation.worktreePorcelain = [" M src/example.ts", "?? scratch.txt"];

  const result = evaluatePreflight(observation);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "dirty-worktree"));
});

test("blocks an unavailable Git status command", () => {
  const observation = validObservation();
  observation.worktreeCommandOk = false;

  const result = evaluatePreflight(observation);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "git-unavailable"));
  assert.equal(result.checks.worktreeClean, false);
});

test("preserves a failing specman observation as specman-unavailable", () => {
  const observation = validObservation();
  observation.specman = {
    status: 1,
    stdout: "partial output",
    stderr: "specman: command failed",
    error: "exit 1",
  };

  const result = evaluatePreflight(observation);
  const failure = result.errors.find(
    (error) => error.code === "specman-unavailable",
  );

  assert.equal(result.ok, false);
  assert.ok(failure);
  assert.match(failure.message, /partial output/);
  assert.match(failure.message, /specman: command failed/);
});

test("malformed ledger blocks preflight", () => {
  const observation = validObservation();
  observation.ledgerText = "## Workflow ledger\n- **Current phase:** P1\n";

  const result = evaluatePreflight(observation);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(
      (error) => error.code === "ledger-missing-last-completed-gate",
    ),
  );
  assert.ok(
    result.errors.some((error) => error.code === "ledger-missing-next-action"),
  );
});

test("collector and CLI succeed without writing repository state", () => {
  const entriesBefore = readdirSync(process.cwd()).sort();
  const scriptBefore = statSync("scripts/workflow-check.mjs").mtimeMs;
  const ledgerBefore = readFileSync("milestones/M45.md", "utf8");
  const observation = collectPreflightObservation({
    root: process.cwd(),
    milestonePath,
  });
  const result = evaluatePreflight(observation);

  assert.equal("write" in result, false);
  assert.equal("repair" in result, false);
  assert.notEqual(run(["preflight", "--milestone", milestonePath]), 2);
  assert.deepEqual(readdirSync(process.cwd()).sort(), entriesBefore);
  assert.equal(statSync("scripts/workflow-check.mjs").mtimeMs, scriptBefore);
  assert.equal(readFileSync("milestones/M45.md", "utf8"), ledgerBefore);
});
