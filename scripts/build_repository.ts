import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const deps = join(root, ".deps", "GachaSimulate");
if (!existsSync(deps))
  throw new Error(
    ".deps/GachaSimulate is missing; run pnpm run prepare:compiler",
  );

const compiler = (await import(
  pathToFileURL(join(deps, "packages/config-compiler/dist/index.js")).href
)) as {
  validate_config_files(
    text: string,
    terminations: { file: string; text: string }[],
  ): string[];
};
const contract = (await import(
  pathToFileURL(join(deps, "packages/config-repository-contract/dist/index.js"))
    .href
)) as {
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
};

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
const u16 = (value: number) => {
  const out = Buffer.allocUnsafe(2);
  out.writeUInt16LE(value);
  return out;
};
const u32 = (value: number) => {
  const out = Buffer.allocUnsafe(4);
  out.writeUInt32LE(value >>> 0);
  return out;
};

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data, { level: 9, strategy: 3 });
    const header = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc32(file.data)),
      u32(compressed.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    local.push(header, compressed);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(8),
        u16(0),
        u16(0),
        u32(crc32(file.data)),
        u32(compressed.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0o100644 << 16),
        u32(offset),
        name,
      ]),
    );
    offset += header.length + compressed.length;
  }
  const body = Buffer.concat([...local, ...central]);
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  return Buffer.concat([
    body,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ]);
}

function checkZip(archive: Buffer, expected: Map<string, Buffer>) {
  let offset = 0;
  const found = new Map<string, Buffer>();
  while (
    offset + 30 <= archive.length &&
    archive.readUInt32LE(offset) === 0x04034b50
  ) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const size = archive.readUInt32LE(offset + 22);
    const nameSize = archive.readUInt16LE(offset + 26);
    const extraSize = archive.readUInt16LE(offset + 28);
    const name = archive
      .subarray(offset + 30, offset + 30 + nameSize)
      .toString("utf8");
    const start = offset + 30 + nameSize + extraSize;
    const compressed = archive.subarray(start, start + compressedSize);
    if (method !== 8 || size > contract.CONFIG_PACKAGE_FILE_SIZE_LIMIT)
      throw new Error(`invalid ZIP entry: ${name}`);
    const data = inflateRawSync(compressed);
    if (
      data.length !== size ||
      crc32(data) !== archive.readUInt32LE(offset + 14)
    )
      throw new Error(`corrupt ZIP entry: ${name}`);
    if (found.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);
    found.set(name, data);
    offset = start + compressedSize;
  }
  if (
    archive.length < 22 ||
    archive.readUInt32LE(archive.length - 22) !== 0x06054b50 ||
    found.size !== expected.size
  )
    throw new Error("invalid ZIP archive");
  for (const [name, data] of expected)
    if (!found.has(name) || !found.get(name)!.equals(data))
      throw new Error(`ZIP mismatch: ${name}`);
}

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
    archive.length > 8 * 1024 * 1024 ||
    files.length > contract.CONFIG_PACKAGE_FILE_LIMIT
  )
    throw new Error(`${id}: package limit exceeded`);
  const packagePath = join(packagesDir, `${id}.zip`);
  writeFileSync(packagePath, archive, { mode: 0o644 });
  checkZip(archive, new Map(files.map(({ name, data }) => [name, data])));
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
