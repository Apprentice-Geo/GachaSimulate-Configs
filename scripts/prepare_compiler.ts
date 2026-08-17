import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const deps = join(root, ".deps", "GachaSimulate");
const commit = readFileSync(join(root, "GACHASIMULATE_COMMIT"), "utf8").trim();
if (!/^[0-9a-f]{40}$/.test(commit))
  throw new Error("invalid GACHASIMULATE_COMMIT");

if (!existsSync(deps)) {
  execFileSync(
    "git",
    [
      "clone",
      "--no-checkout",
      "https://github.com/Apprentice-Geo/GachaSimulate.git",
      deps,
    ],
    { stdio: "inherit" },
  );
}
execFileSync("git", ["checkout", "--force", commit], {
  cwd: deps,
  stdio: "inherit",
});
execFileSync("pnpm", ["install", "--frozen-lockfile"], {
  cwd: deps,
  stdio: "inherit",
});
execFileSync("pnpm", ["--dir", "packages/config-compiler", "build"], {
  cwd: deps,
  stdio: "inherit",
});
execFileSync(
  "pnpm",
  ["--dir", "packages/config-repository-contract", "build"],
  {
    cwd: deps,
    stdio: "inherit",
  },
);
