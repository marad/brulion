#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const requiredPaths = [
  "AGENTS.md",
  ".pi/skills/goal/SKILL.md",
  ".pi/skills/code-review/SKILL.md",
  ".pi/skills/review-until-clean/SKILL.md",
];
const missing = requiredPaths.filter((relativePath) =>
  !existsSync(resolve(root, relativePath)),
);

if (missing.length > 0) {
  console.error("workflow mapping missing:");
  for (const relativePath of missing) {
    console.error(`- ${relativePath}`);
  }
  process.exitCode = 1;
} else {
  console.log(`workflow mapping OK: ${root}`);
}
