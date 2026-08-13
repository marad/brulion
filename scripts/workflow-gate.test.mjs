import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildFullGatePlan,
  buildPreReviewPlan,
  checkDerivedArtifacts,
  checkVerificationPlans,
  classifyStagedPaths,
  findRecursiveVerification,
  executeFullGate,
  runFastGate,
  validateCommitMessage,
} from "./workflow-gate.mjs";

const root = resolve(process.cwd());
const read = (relativePath) =>
  readFileSync(resolve(root, relativePath), "utf8");
const commandResult = (command, args, status = 0, stdout = "", stderr = "") => ({
  command,
  args,
  status,
  stdout,
  stderr,
});

test("only flags same-spec verification commands, not prose mentions", () => {
  assert.deepEqual(
    findRecursiveVerification(
      "FEAT-0108",
      "The approach mentions `specman verify FEAT-0108`.\n\n## Verification\n- `npm test -- --run`\n",
    ),
    [],
  );
  assert.deepEqual(
    findRecursiveVerification(
      "FEAT-0108",
      "## Verification\n- `specman verify FEAT-0108`\n",
    ),
    ["- `specman verify FEAT-0108`"],
  );
});

test("reports recursive plans and preserves matching artifact pairs", () => {
  const root = mkdtempSync(join(process.cwd(), "workflow-gate-"));

  try {
    mkdirSync(join(root, ".specman", "plans"), { recursive: true });
    mkdirSync(join(root, "extension-kit"));
    mkdirSync(join(root, "public"));
    writeFileSync(
      join(root, ".specman", "plans", "FEAT-0108.md"),
      "## Verification\n- `specman verify FEAT-0108`\n",
    );
    for (const [source, generated] of [
      ["API.md", "api.md"],
      ["api-contract.json", "api-contract.json"],
      ["brulion-extension.d.ts", "brulion-extension.d.ts"],
    ]) {
      writeFileSync(join(root, "extension-kit", source), `${source}\n`);
      writeFileSync(join(root, "public", generated), `${source}\n`);
    }

    const plans = checkVerificationPlans(root);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].code, "recursive-verification");
    assert.deepEqual(checkDerivedArtifacts(root), []);

    writeFileSync(join(root, "public", "api.md"), "drift\n");
    const artifacts = checkDerivedArtifacts(root);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].code, "derived-artifact-drift");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compares derived artifacts as raw bytes", () => {
  const root = mkdtempSync(join(process.cwd(), "workflow-gate-bytes-"));

  try {
    mkdirSync(join(root, "extension-kit"));
    mkdirSync(join(root, "public"));
    const pairs = [
      ["API.md", "api.md"],
      ["api-contract.json", "api-contract.json"],
      ["brulion-extension.d.ts", "brulion-extension.d.ts"],
    ];
    for (const [source, generated] of pairs) {
      writeFileSync(join(root, "extension-kit", source), Buffer.from([0xff]));
      writeFileSync(join(root, "public", generated), Buffer.from([0xff]));
    }
    writeFileSync(join(root, "public", "api.md"), Buffer.from([0xfe]));

    const errors = checkDerivedArtifacts(root);
    assert.deepEqual(errors.map((error) => error.code), ["derived-artifact-drift"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-review plan is observational and excludes the full browser suite", () => {
  const commands = buildPreReviewPlan({
    root,
    base: "abc123",
    specId: "FEAT-0108",
    milestonePath: "milestones/M45.md",
  });
  const rendered = commands.map(({ command, args }) => [command, ...args].join(" ")).join("\n");

  assert.match(rendered, /git diff abc123\.\.\.HEAD --check/);
  assert.match(rendered, /FEAT-0108/);
  assert.doesNotMatch(rendered, /npm run e2e/);
});

test("pre-review CLI reports the owned range without mutating or running E2E", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/workflow-gate.mjs", "pre-review", "--base", "HEAD~1", "--spec", "FEAT-0108", "--milestone", "milestones/M45.md"],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /base:/);
  assert.match(result.stdout, /HEAD:/);
  assert.match(result.stdout, /FEAT-0108/);
  assert.match(result.stdout, /changed paths:/);
  assert.match(result.stdout, /spec status: passed/);
  assert.match(result.stdout, /verification plans: passed/);
  assert.match(result.stdout, /derived artifacts: passed/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /npm run e2e/);
});

test("pre-review rejects an unknown base commit", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/workflow-gate.mjs", "pre-review", "--base", "does-not-exist", "--spec", "FEAT-0108", "--milestone", "milestones/M45.md"],
    { cwd: root, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /base-unavailable/);
});

test("classifies implementation and workflow paths separately from documentation", () => {
  const implementation = classifyStagedPaths([
    "src/main.ts",
    "scripts/workflow-gate.mjs",
    ".githooks/pre-push",
    ".github/workflows/quality.yml",
    "index.html",
    "vite.config.ts",
    "public/icons/icon.svg",
    "extension-kit/api-contract.json",
    "package.json",
  ]);
  const docs = classifyStagedPaths([
    "ROADMAP.md",
    "DECISIONS.md",
    "specs/FEAT-0097-commit-push-and-ci-workflow-gates.md",
    "milestones/M45.md",
  ]);

  assert.equal(implementation.requiresTrailer, true);
  assert.deepEqual(implementation.implementationPaths, [
    "src/main.ts",
    "scripts/workflow-gate.mjs",
    ".githooks/pre-push",
    ".github/workflows/quality.yml",
    "index.html",
    "vite.config.ts",
    "public/icons/icon.svg",
    "extension-kit/api-contract.json",
    "package.json",
  ]);
  assert.equal(docs.requiresTrailer, false);
  assert.deepEqual(docs.implementationPaths, []);
});

test("requires and accepts spec trailers for implementation commits", () => {
  const paths = ["src/main.ts"];
  const missing = validateCommitMessage("fix: change behavior", paths);
  const valid = validateCommitMessage(
    "fix: change behavior\n\nSpec: FEAT-0097/AC-1",
    paths,
  );

  assert.equal(missing.ok, false);
  assert.match(missing.errors.join("\n"), /Spec: FEAT-NNNN\/AC-M/);
  assert.equal(valid.ok, true);
  assert.equal(valid.hasTrailer, true);
});

test("allows documentation-only commits without a trailer", () => {
  const result = validateCommitMessage("docs: update roadmap", [
    "ROADMAP.md",
    "DECISIONS.md",
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.requiresTrailer, false);
});

test("fast gate rejects cached whitespace errors and mapping failures", () => {
  const calls = [];
  const whitespace = runFastGate({
    root,
    cachedDiff: commandResult("git", ["diff"], 2, "", "trailing whitespace"),
    mappingResult: commandResult("node", ["mapping"], 0, "workflow mapping OK"),
    runner: (command, args) => {
      calls.push([command, args]);
      return commandResult(command, args);
    },
  });
  const mapping = runFastGate({
    root,
    cachedDiff: commandResult("git", ["diff"], 0),
    mappingResult: commandResult("node", ["mapping"], 1, "", "missing mapping"),
    runner: (command, args) => commandResult(command, args),
  });

  assert.equal(whitespace.ok, false);
  assert.match(whitespace.errors.join("\n"), /whitespace/);
  assert.equal(mapping.ok, false);
  assert.match(mapping.errors.join("\n"), /mapping/);
  assert.equal(calls.length, 0);
});

const expectedFullCommands = (milestonePath) => [
  [process.execPath, ["scripts/workflow-check.mjs", "preflight", "--milestone", milestonePath]],
  [process.execPath, ["scripts/workflow-gate.mjs", "plan-check"]],
  [process.execPath, ["scripts/workflow-gate.mjs", "artifact-check"]],
  ["specman", ["validate"]],
  ["npm", ["run", "workflow:test"]],
  ["npm", ["test", "--", "--run"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "e2e"]],
];

test("builds the exact ordered full plan for ci and pre-push", () => {
  const request = { root, milestonePath: "milestones/M45.md", mode: "ci" };
  const ci = buildFullGatePlan(request);
  const push = buildFullGatePlan({ ...request, mode: "pre-push" });

  assert.deepEqual(
    ci.map(({ command, args }) => [command, args]),
    expectedFullCommands(request.milestonePath),
  );
  assert.deepEqual(push, ci);
});

test("stops the full gate at the first failure and preserves evidence", () => {
  const calls = [];
  const commands = expectedFullCommands("milestones/M45.md").map(([command, args]) => ({
    command,
    args,
  }));
  const result = executeFullGate(commands, (command, args) => {
    calls.push([command, args]);
    return command === "npm" && args[0] === "test"
      ? commandResult(command, args, 1, "test output", "test failure")
      : commandResult(command, args, 0, `${command} passed`);
  });

  assert.equal(result.ok, false);
  assert.equal(result.completed.length, 5);
  assert.equal(result.failed.command, "npm");
  assert.equal(result.failed.stderr, "test failure");
  assert.equal(calls.length, 6);
  assert.equal(result.evidence.at(-1).stdout, "test output");
});

test("hook shims and installer delegate to the checked-in gate", () => {
  assert.match(read(".githooks/pre-commit"), /workflow-gate\.mjs/);
  assert.match(read(".githooks/pre-commit"), /pre-commit/);
  assert.match(read(".githooks/commit-msg"), /workflow-gate\.mjs/);
  assert.match(read(".githooks/commit-msg"), /commit-message/);
  assert.match(read(".githooks/pre-push"), /workflow-gate\.mjs/);
  assert.match(read(".githooks/pre-push"), /pre-push/);
  assert.match(read("scripts/install-hooks.sh"), /core\.hooksPath/);
  assert.match(read("scripts/install-hooks.sh"), /\.githooks/);
});

test("quality workflow invokes ci and deploy waits for quality", () => {
  const quality = read(".github/workflows/quality.yml");
  const deploy = read(".github/workflows/deploy.yml");

  assert.match(quality, /workflow-gate\.mjs|workflow:gate/);
  assert.match(quality, /ci/);
  assert.match(quality, /setup-deno/);
  assert.match(quality, /install-specman\.sh/);
  assert.match(deploy, /quality/);
  assert.match(deploy, /needs:\s*quality/);
  assert.match(deploy, /setup-deno/);
  assert.match(deploy, /install-specman\.sh/);
  assert.match(read("scripts/install-specman.sh"), /8c9b5fc/);
});

test("gate adapters contain no hard timeout controls", () => {
  const sources = [
    "scripts/workflow-gate.mjs",
    ".githooks/pre-commit",
    ".githooks/commit-msg",
    ".githooks/pre-push",
    ".github/workflows/quality.yml",
  ].map(read).join("\n");

  assert.doesNotMatch(sources, /timeoutMs|maxRuntimeMs|turnBudget|toolBudget/);
  assert.match(read("scripts/workflow-gate.mjs"), /--diff-filter=ACMRD/);
});
