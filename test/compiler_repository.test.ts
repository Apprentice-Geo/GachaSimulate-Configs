import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensurePinnedCheckout } from "../scripts/compiler_repository.js";

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("fetches a new pinned commit into an existing clone without network", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gachasimulate-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const deps = join(root, "deps");

  git(["init", source]);
  git(["config", "user.name", "Test Author"], source);
  git(["config", "user.email", "test@example.invalid"], source);
  writeFileSync(join(source, "version.txt"), "A\n");
  git(["add", "version.txt"], source);
  git(["commit", "-m", "commit A"], source);
  const commitA = git(["rev-parse", "HEAD"], source);

  git(["init", "--bare", remote]);
  git(["remote", "add", "origin", remote], source);
  git(["push", "origin", "HEAD:main"], source);

  ensurePinnedCheckout({ deps, repositoryUrl: remote, commit: commitA });
  assert.equal(git(["rev-parse", "HEAD"], deps), commitA);
  assert.equal(readFileSync(join(deps, "version.txt"), "utf8").trim(), "A");

  writeFileSync(join(source, "version.txt"), "B\n");
  git(["add", "version.txt"], source);
  git(["commit", "-m", "commit B"], source);
  const commitB = git(["rev-parse", "HEAD"], source);
  git(["push", "origin", "HEAD:main"], source);
  assert.notEqual(commitB, commitA);
  assert.notEqual(
    spawnSync("git", ["cat-file", "-e", `${commitB}^{commit}`], {
      cwd: deps,
    }).status,
    0,
  );

  ensurePinnedCheckout({ deps, repositoryUrl: remote, commit: commitB });
  assert.equal(git(["rev-parse", "HEAD"], deps), commitB);
  assert.equal(readFileSync(join(deps, "version.txt"), "utf8").trim(), "B");
});

test("rejects an invalid pinned commit before invoking Git", () => {
  assert.throws(
    () =>
      ensurePinnedCheckout({
        deps: "unused",
        repositoryUrl: "unused",
        commit: "not-a-commit",
      }),
    /invalid GACHASIMULATE_COMMIT/,
  );
});
