# GachaSimulate-Configs

Official configuration source for [GachaSimulate](https://github.com/Apprentice-Geo/GachaSimulate).

`GACHASIMULATE_COMMIT` pins the compiler and repository contract used by the local build. The generated `dist/` is committed and CI rejects uncommitted changes to it.

```bash
pnpm install
pnpm run prepare:compiler
pnpm run build
```

The first batch of 15 official configurations has been migrated from the main repository. Each existing simulation model remains an independent configuration, including the Dream Corridor variants whose final fragment count differs.

The main repository keeps its original local configurations for now. Parameterizing configurations into shared `configs + pools + rules` is planned as a separate follow-up and is not part of this repository version.
