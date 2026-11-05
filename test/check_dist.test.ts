import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/check_dist.ts", import.meta.url),
);

for (const scenario of [
  "clean",
  "unrelated changes",
  "untracked package",
  "staged package",
  "modified index",
  "deleted package",
]) {
  test(`dist check handles ${scenario}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "gachasimulate-dist-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git(["init"]);
    mkdirSync(join(root, "dist", "packages"), { recursive: true });
    writeFileSync(join(root, "dist", "index.json"), "{}\n");
    writeFileSync(join(root, "dist", "packages", "existing.zip"), "existing");
    git(["add", "dist/"]);
    git([
      "-c",
      "user.name=Test Author",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "baseline",
    ]);

    if (scenario === "unrelated changes")
      writeFileSync(join(root, "notes.txt"), "unrelated");
    if (scenario === "untracked package" || scenario === "staged package")
      writeFileSync(join(root, "dist", "packages", "new.zip"), "new");
    if (scenario === "staged package") git(["add", "dist/packages/new.zip"]);
    if (scenario === "modified index")
      writeFileSync(join(root, "dist", "index.json"), '{"changed":true}\n');
    if (scenario === "deleted package")
      rmSync(join(root, "dist", "packages", "existing.zip"));

    const result = spawnSync(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), script],
      { cwd: root, encoding: "utf8" },
    );
    assert.ifError(result.error);
    const shouldPass = scenario === "clean" || scenario === "unrelated changes";
    assert.equal(result.status, shouldPass ? 0 : 1, result.stderr);
    if (!shouldPass)
      assert.match(result.stderr, /dist\/(?:index\.json|packages\/.*\.zip)/);
  });
}
