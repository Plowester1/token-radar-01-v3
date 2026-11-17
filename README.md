# Token Radar — LAD implied value

A make.fun competition entry that builds a token launch radar: it reads a sealed DefiLlama snapshot, fits a median (least-absolute-deviation) regression in log space over the tokenized comparables, and ranks every pre-token protocol by an implied value with a low/central/high interval. The dark scatter dashboard shows the fitted line and residual band, a sortable board, per-protocol detail views with farm plans, and a Comps view of the evidence base.

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Plowester1/token-radar-01-v3/rank.svg)](https://make.fun/competitions/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Plowester1/token-radar-01-v3/reward.svg)](https://make.fun/competitions/token-radar-01)

## What it does

- Fits `log(mcap) = intercept + slope·log(TVL) + category offset` by **LAD (IRLS)** on 128 tokenized comparables at runtime — one 400x outlier cannot drag the line the way OLS lets it.
- Ranks 300 pre-token protocols by implied value, each with a low / central / high interval from the fitted residual quantiles.
- Separates protocols whose token already trades into a dedicated **Comps view** (the model's evidence base); board rows are pre-token only.
- Gives every row a 5-step, category-specific farm plan (onboard, deploy capital by TVL tier, recurring qualifying action, monitor/compound, exit/claim).
- Is fully deterministic: two runs write byte-identical output, including the dossier the judge reads.

## Run

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /home/hatch/workspace/makefun/kits/token-radar-01-kit/input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`, and `out/dossier.json`. Node 22.18 or later, standard library only.

## Files

- `main.ts` — entrypoint: reads the snapshot, fits, scores, writes output and the dossier.
- `lib/model.ts` — snapshot parsing, LAD fit via IRLS, residual quantiles, backtest, board build, farm plans, comps data.
- `vendor/makefun-board.ts` — the dossier builder (schema `makefun/dossier/v1`).
- `dashboard/` — the dark scatter dashboard (no network).
- `screenshots/` — three 1440×900 renders of the dashboard.

Built with [make.fun](https://make.fun/?ref=xt604nns&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01).