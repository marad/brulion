import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readFileSync(resolve(root, relativePath), "utf8");
const mappingCheck = resolve(root, "scripts/workflow-mapping-check.mjs");

const skillPaths = {
  goal: ".pi/skills/goal/SKILL.md",
  "code-review": ".pi/skills/code-review/SKILL.md",
  "review-until-clean": ".pi/skills/review-until-clean/SKILL.md",
};

test("project-local workflow command mapping", async (t) => {
  await t.test("defines exact Agent Skills frontmatter", () => {
    for (const [name, path] of Object.entries(skillPaths)) {
      const source = read(path);
      const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);

      assert.ok(frontmatter, `${name} must have frontmatter`);
      assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, "m"));
      assert.match(frontmatter[1], /^description: \S.+$/m);
    }
  });

  await t.test("defines each protocol contract", () => {
    const requirements = {
      goal: [
        "GoalRequest",
        "GoalTransition",
        "missing-mapping",
        "phase-ledger",
        "without a hard wall-clock",
      ],
      "code-review": [
        "ReviewRequest",
        "ReviewResult",
        "discriminating",
        "status",
        "worker",
      ],
      "review-until-clean": [
        "ReviewLoopRequest",
        "/skill:code-review",
        "two consecutive rounds",
        "clean",
        "blocked",
      ],
    };

    for (const [name, markers] of Object.entries(requirements)) {
      const source = read(skillPaths[name]);
      for (const marker of markers) {
        assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} should document ${marker}`);
      }
    }
  });

  await t.test("uses discoverable pi skill command forms in AGENTS.md", () => {
    const agents = read("AGENTS.md");

    assert.match(agents, /\/skill:goal/);
    assert.match(agents, /\/skill:code-review/);
    assert.match(agents, /\/skill:review-until-clean/);
    assert.doesNotMatch(agents, /Kick a milestone off with \*\*`\/goal`\*\*/);
    assert.doesNotMatch(agents, /If `\/goal`, `\/spec`, `\/excavate`,/);
    assert.match(agents, /historical bare labels/);
  });

  await t.test("documents the evidence-first review handoff", () => {
    const agents = read("AGENTS.md");
    const workflow = read("docs/workflow.md");
    const review = read(skillPaths["code-review"]);
    const loop = read(skillPaths["review-until-clean"]);

    for (const marker of ["pre-review", "base SHA", "review ledger", "targeted tests"]) {
      assert.match(agents + workflow + review + loop, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")));
    }
    assert.match(workflow, /one canonical reviewer/);
    assert.match(review, /current HEAD/);
    assert.match(loop, /blocked.*clean|clean.*blocked/s);
  });

  await t.test("requires per-skill recovery and no hard timeout guidance", () => {
    const goal = read(skillPaths.goal);
    const review = read(skillPaths["code-review"]);
    const loop = read(skillPaths["review-until-clean"]);

    assert.match(goal, /needs_attention/);
    assert.match(goal, /Do not claim a skipped gate ran/);
    assert.match(review, /failed or stopped worker/);
    assert.match(review, /hard turn budgets/);
    assert.match(loop, /A blocked or failed worker is not a clean result/);
    assert.match(loop, /restructure/);
  });

  await t.test("passes the mapping check for the repository", () => {
    const result = spawnSync(process.execPath, [mappingCheck, root], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /workflow mapping OK/);
  });

  await t.test("fails closed and names missing paths", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "brulion-workflow-"));

    try {
      const result = spawnSync(process.execPath, [mappingCheck, temporaryRoot], {
        cwd: root,
        encoding: "utf8",
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /workflow mapping missing/);
      assert.match(result.stderr, /\.pi\/skills\/goal\/SKILL\.md/);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
