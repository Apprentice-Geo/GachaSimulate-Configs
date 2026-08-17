# GachaSimulate-Configs

Official configuration source for [GachaSimulate](https://github.com/Apprentice-Geo/GachaSimulate).

`GACHASIMULATE_COMMIT` pins the compiler and repository contract used by the local build. The generated `dist/` is committed and CI rejects uncommitted changes to it.

```bash
pnpm install
pnpm run prepare:compiler
pnpm run build
```