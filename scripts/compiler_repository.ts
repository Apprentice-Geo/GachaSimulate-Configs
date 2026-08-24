import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface EnsurePinnedCheckoutOptions {
  deps: string;
  repositoryUrl: string;
  commit: string;
}

export function ensurePinnedCheckout({
  deps,
  repositoryUrl,
  commit,
}: EnsurePinnedCheckoutOptions): void {
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error("invalid GACHASIMULATE_COMMIT");

  if (!existsSync(deps)) {
    execFileSync("git", ["clone", "--no-checkout", repositoryUrl, deps], {
      stdio: "inherit",
    });
  }

  execFileSync("git", ["fetch", "--no-tags", "origin"], {
    cwd: deps,
    stdio: "inherit",
  });
  execFileSync("git", ["checkout", "--force", commit], {
    cwd: deps,
    stdio: "inherit",
  });
}
