# GachaSimulate-Configs

Official configuration source for [GachaSimulate](https://github.com/Apprentice-Geo/GachaSimulate).

`GACHASIMULATE_COMMIT` pins the compiler and repository contract used by the local build. The generated `dist/` is committed and CI rejects uncommitted changes to it.

```bash
pnpm install
pnpm run prepare:compiler
pnpm run build
```

To prevent the CI workflow from failing, run the following commands before pushing:

```bash
pnpm install --frozen-lockfile
pnpm run prepare:compiler
pnpm run format:check
pnpm run typecheck
pnpm test
pnpm run build
git diff --exit-code -- dist/
```
