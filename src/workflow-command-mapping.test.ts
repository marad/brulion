import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const read = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), "utf8");

const skillPaths = [
  ".pi/skills/goal/SKILL.md",
  ".pi/skills/code-review/SKILL.md",
  ".pi/skills/review-until-clean/SKILL.md",
] as const;

describe("project-local workflow command mapping", () => {
  it.each([
    ["goal", ".pi/skills/goal/SKILL.md"],
    ["code-review", ".pi/skills/code-review/SKILL.md"],
    ["review-until-clean", ".pi/skills/review-until-clean/SKILL.md"],
  ])("defines valid Agent Skills frontmatter for %s", (name, path) => {
    const source = read(path);
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);

    expect(frontmatter?.[1]).toContain(`name: ${name}`);
    expect(frontmatter?.[1]).toMatch(/^description: .+$/m);
  });

  it("exposes the three workflow contracts", () => {
    expect(read(".pi/skills/goal/SKILL.md")).toContain("GoalRequest");
    expect(read(".pi/skills/code-review/SKILL.md")).toContain("ReviewRequest");
    expect(read(".pi/skills/review-until-clean/SKILL.md")).toContain(
      "ReviewLoopRequest",
    );
  });

  it("uses discoverable pi skill command forms in AGENTS.md", () => {
    const agents = read("AGENTS.md");

    expect(agents).toContain("/skill:goal");
    expect(agents).toContain("/skill:code-review");
    expect(agents).toContain("/skill:review-until-clean");
    expect(agents).not.toContain("Kick a milestone off with **`/goal`**");
    expect(agents).not.toContain(
      "If `/goal`, `/spec`, `/excavate`,",
    );
    expect(agents).toContain("historical bare");
  });

  it("requires recovery and no hard timeout for substantive workers", () => {
    const sources = [read("AGENTS.md"), ...skillPaths.map(read)].join("\n");

    expect(sources).toContain("needs_attention");
    expect(sources).toContain("without a hard");
    expect(sources).toContain("discriminating");
    expect(sources).toContain("worker");
    expect(sources).toContain("failed");
  });
});
