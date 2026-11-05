import { execFileSync } from "node:child_process";

const status = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all", "--", "dist/"],
  { encoding: "utf8" },
);

if (status) {
  console.error("dist/ contains uncommitted generated files:");
  console.error(status.trimEnd());
  process.exitCode = 1;
}
