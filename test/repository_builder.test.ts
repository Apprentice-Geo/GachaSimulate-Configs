import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { unzipSync } from "fflate";
import {
  buildRepository,
  type ConfigCompiler,
  type RepositoryContract,
} from "../scripts/repository_builder.js";

const compiler: ConfigCompiler = {
  validate_config_files: () => [],
};

function contract(
  overrides: Partial<RepositoryContract> = {},
): RepositoryContract {
  return {
    validate_config_package: (id, _manifest, files) => ({
      id,
      name: `Name ${id}`,
      description: `Description ${id}`,
      terminations: files
        .filter(({ path }) => path.startsWith("termination"))
        .map(({ path }) => ({ file: path })),
    }),
    read_repository_index: JSON.parse,
    CONFIG_PACKAGE_FILE_SIZE_LIMIT: 1024 * 1024,
    CONFIG_PACKAGE_FILE_LIMIT: 64,
    REPOSITORY_CONFIG_LIMIT: 256,
    REPOSITORY_INDEX_TEXT_LIMIT: 1024 * 1024,
    ...overrides,
  };
}

function temporaryRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "gachasimulate-configs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "configs"), { recursive: true });
  return root;
}

function writeConfig(root: string, id: string): void {
  const dir = join(root, "configs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.yaml"), `id: ${id}\n`);
  writeFileSync(join(dir, "config.yaml"), `config: ${id}\n`);
  writeFileSync(join(dir, "termination.yaml"), `termination: ${id}\n`);
}

test("builds deterministic archives, index entries, and hashes", (t) => {
  const root = temporaryRoot(t);
  writeConfig(root, "zeta");
  writeConfig(root, "alpha");
  mkdirSync(join(root, "dist", "packages"), { recursive: true });
  writeFileSync(join(root, "dist", "packages", "stale.zip"), "stale");

  buildRepository({ root, compiler, contract: contract() });

  assert.equal(existsSync(join(root, "dist", "packages", "stale.zip")), false);
  const firstIndex = readFileSync(join(root, "dist", "index.json"));
  const index = JSON.parse(firstIndex.toString("utf8")) as {
    configs: { id: string; download_url: string; sha256: string }[];
  };
  assert.deepEqual(
    index.configs.map(({ id }) => id),
    ["alpha", "zeta"],
  );

  const firstArchives = new Map<string, Buffer>();
  for (const entry of index.configs) {
    assert.equal(entry.download_url, `packages/${entry.id}.zip`);
    const archive = readFileSync(join(root, "dist", entry.download_url));
    firstArchives.set(entry.id, archive);
    assert.equal(
      entry.sha256,
      createHash("sha256").update(archive).digest("hex"),
    );
    const files = unzipSync(archive);
    assert.deepEqual(Object.keys(files).sort(), [
      "config.yaml",
      "manifest.yaml",
      "termination.yaml",
    ]);
    for (const name of Object.keys(files))
      assert.deepEqual(
        Buffer.from(files[name]),
        readFileSync(join(root, "configs", entry.id, name)),
      );
  }

  buildRepository({ root, compiler, contract: contract() });

  assert.deepEqual(readFileSync(join(root, "dist", "index.json")), firstIndex);
  for (const [id, archive] of firstArchives)
    assert.deepEqual(
      readFileSync(join(root, "dist", "packages", `${id}.zip`)),
      archive,
    );
});

test("rejects invalid repository inputs and validator failures", async (t) => {
  await t.test("nested paths", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "example");
    mkdirSync(join(root, "configs", "example", "nested"));
    assert.throws(
      () => buildRepository({ root, compiler, contract: contract() }),
      /nested paths are not allowed/,
    );
  });

  await t.test("missing manifest", (t) => {
    const root = temporaryRoot(t);
    const dir = join(root, "configs", "example");
    mkdirSync(dir);
    writeFileSync(join(dir, "config.yaml"), "config: example\n");
    assert.throws(
      () => buildRepository({ root, compiler, contract: contract() }),
      /manifest\.yaml/,
    );
  });

  await t.test("missing config", (t) => {
    const root = temporaryRoot(t);
    const dir = join(root, "configs", "example");
    mkdirSync(dir);
    writeFileSync(join(dir, "manifest.yaml"), "id: example\n");
    assert.throws(
      () => buildRepository({ root, compiler, contract: contract() }),
      /config\.yaml/,
    );
  });

  await t.test("invalid UTF-8", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "example");
    writeFileSync(
      join(root, "configs", "example", "manifest.yaml"),
      Buffer.from([0xff]),
    );
    assert.throws(() =>
      buildRepository({ root, compiler, contract: contract() }),
    );
  });

  await t.test("compiler rejection", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "example");
    assert.throws(
      () =>
        buildRepository({
          root,
          compiler: { validate_config_files: () => ["config.yaml"] },
          contract: contract(),
        }),
      /compiler rejected config\.yaml/,
    );
  });

  await t.test("contract rejection", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "example");
    assert.throws(
      () =>
        buildRepository({
          root,
          compiler,
          contract: contract({
            validate_config_package: () => {
              throw new Error("contract rejected package");
            },
          }),
        }),
      /contract rejected package/,
    );
  });
});

test("enforces repository and package limits", async (t) => {
  await t.test("configuration count", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "one");
    writeConfig(root, "two");
    assert.throws(
      () =>
        buildRepository({
          root,
          compiler,
          contract: contract({ REPOSITORY_CONFIG_LIMIT: 1 }),
        }),
      /too many configurations/,
    );
  });

  await t.test("file size", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "example");
    assert.throws(
      () =>
        buildRepository({
          root,
          compiler,
          contract: contract({ CONFIG_PACKAGE_FILE_SIZE_LIMIT: 1 }),
        }),
      /exceeds 1 MiB/,
    );
  });

  await t.test("package file count", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "example");
    assert.throws(
      () =>
        buildRepository({
          root,
          compiler,
          contract: contract({ CONFIG_PACKAGE_FILE_LIMIT: 2 }),
        }),
      /package limit exceeded/,
    );
  });

  await t.test("repository index size", (t) => {
    const root = temporaryRoot(t);
    writeConfig(root, "example");
    assert.throws(
      () =>
        buildRepository({
          root,
          compiler,
          contract: contract({ REPOSITORY_INDEX_TEXT_LIMIT: 1 }),
        }),
      /index\.json exceeds 1 MiB/,
    );
  });
});
