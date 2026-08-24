import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { zipSync, type Zippable } from "fflate";

export interface ConfigCompiler {
  validate_config_files(
    text: string,
    terminations: { file: string; text: string }[],
  ): string[];
}

export interface RepositoryContract {
  validate_config_package(
    id: string,
    manifest: string,
    files: { path: string; size: number }[],
  ): {
    id: string;
    name: string;
    description: string;
    terminations: { file: string }[];
  };
  read_repository_index(text: string): unknown;
  CONFIG_PACKAGE_FILE_SIZE_LIMIT: number;
  CONFIG_PACKAGE_FILE_LIMIT: number;
  REPOSITORY_CONFIG_LIMIT: number;
  REPOSITORY_INDEX_TEXT_LIMIT: number;
}

export interface BuildRepositoryOptions {
  root: string;
  compiler: ConfigCompiler;
  contract: RepositoryContract;
}

const ZIP_MTIME = new Date(1980, 0, 1);
const ZIP_FILE_MODE = 0o100644 << 16;
const CONFIG_PACKAGE_ARCHIVE_LIMIT = 8 * 1024 * 1024;

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const entries: Zippable = {};
  for (const { name, data } of files) entries[name] = data;
  return Buffer.from(
    zipSync(entries, {
      level: 9,
      mtime: ZIP_MTIME,
      os: 3,
      attrs: ZIP_FILE_MODE,
    }),
  );
}

export function buildRepository({
  root,
  compiler,
  contract,
}: BuildRepositoryOptions): void {
  const configsDir = join(root, "configs");
  const distDir = join(root, "dist");
  const packagesDir = join(distDir, "packages");
  mkdirSync(packagesDir, { recursive: true });
  rmSync(packagesDir, { recursive: true, force: true });
  mkdirSync(packagesDir, { recursive: true });

  const text = (path: string) => {
    const data = readFileSync(path);
    if (data.length > contract.CONFIG_PACKAGE_FILE_SIZE_LIMIT)
      throw new Error(`${relative(root, path)} exceeds 1 MiB`);
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  };

  const entries: {
    id: string;
    name: string;
    description: string;
    download_url: string;
    sha256: string;
  }[] = [];
  const dirs = readdirSync(configsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (dirs.length > contract.REPOSITORY_CONFIG_LIMIT)
    throw new Error("too many configurations");
  for (const id of dirs) {
    const dir = join(configsDir, id);
    const directoryFiles = readdirSync(dir, { withFileTypes: true });
    if (directoryFiles.some((entry) => !entry.isFile()))
      throw new Error(`${id}: nested paths are not allowed`);
    const manifest = text(join(dir, "manifest.yaml"));
    const names = directoryFiles.map((entry) => entry.name);
    const sizes = names.map((name) => ({
      path: name,
      size: statSync(join(dir, name)).size,
    }));
    const parsed = contract.validate_config_package(id, manifest, sizes);
    const terminations = parsed.terminations.map(({ file }) => ({
      file,
      text: text(join(dir, file)),
    }));
    const failed = compiler.validate_config_files(
      text(join(dir, "config.yaml")),
      terminations,
    );
    if (failed.length)
      throw new Error(`${id}: compiler rejected ${failed.join(", ")}`);
    const files = [
      "manifest.yaml",
      "config.yaml",
      ...parsed.terminations.map(({ file }) => file),
    ].map((name) => ({ name, data: readFileSync(join(dir, name)) }));
    const archive = zip(files);
    if (
      archive.length > CONFIG_PACKAGE_ARCHIVE_LIMIT ||
      files.length > contract.CONFIG_PACKAGE_FILE_LIMIT
    )
      throw new Error(`${id}: package limit exceeded`);
    const packagePath = join(packagesDir, `${id}.zip`);
    writeFileSync(packagePath, archive, { mode: 0o644 });
    entries.push({
      id,
      name: parsed.name,
      description: parsed.description,
      download_url: `packages/${id}.zip`,
      sha256: createHash("sha256").update(archive).digest("hex"),
    });
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = `${JSON.stringify({ format_version: 1, configs: entries }, null, 2)}\n`;
  if (Buffer.byteLength(index) > contract.REPOSITORY_INDEX_TEXT_LIMIT)
    throw new Error("index.json exceeds 1 MiB");
  contract.read_repository_index(index);
  writeFileSync(join(distDir, "index.json"), index, { mode: 0o644 });
}
