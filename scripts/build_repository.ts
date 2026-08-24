import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildRepository,
  type ConfigCompiler,
  type RepositoryContract,
} from "./repository_builder.js";

const root = process.cwd();
const deps = join(root, ".deps", "GachaSimulate");
if (!existsSync(deps))
  throw new Error(
    ".deps/GachaSimulate is missing; run pnpm run prepare:compiler",
  );

const compiler = (await import(
  pathToFileURL(join(deps, "packages/config-compiler/dist/index.js")).href
)) as ConfigCompiler;
const contract = (await import(
  pathToFileURL(join(deps, "packages/config-repository-contract/dist/index.js"))
    .href
)) as RepositoryContract;

buildRepository({ root, compiler, contract });
