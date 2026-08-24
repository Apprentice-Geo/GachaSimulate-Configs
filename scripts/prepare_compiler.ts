import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ensurePinnedCheckout } from "./compiler_repository.js";

const root = process.cwd();
const deps = join(root, ".deps", "GachaSimulate");
const commit = readFileSync(join(root, "GACHASIMULATE_COMMIT"), "utf8").trim();

/** Executes a command across Windows and Unix-like platforms. */
function execFileSyncPlatform(
  command: string,
  args: string[],
  cwd: string,
): void {
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", command, ...args], {
      cwd,
      stdio: "inherit",
    });
  } else {
    execFileSync(command, args, { cwd, stdio: "inherit" });
  }
}

ensurePinnedCheckout({
  deps,
  repositoryUrl: "https://github.com/Apprentice-Geo/GachaSimulate.git",
  commit,
});
execFileSyncPlatform("pnpm", ["install", "--frozen-lockfile"], deps);
execFileSyncPlatform(
  "pnpm",
  ["--dir", "packages/config-compiler", "build"],
  deps,
);
execFileSyncPlatform(
  "pnpm",
  ["--dir", "packages/config-repository-contract", "build"],
  deps,
);
