# Token Radar — LAD implied value

A make.fun competition entry that turns the sealed protocol snapshot into a launch-value radar. It fits a robust median relationship between TVL and market capitalization, scores protocols that record no token, and gives each one an actionable farm path.

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Plowester1/token-radar-01-v3/rank.svg)](https://make.fun/competitions/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Plowester1/token-radar-01-v3/reward.svg)](https://make.fun/competitions/token-radar-01)

## Approach

- Fit `log(mcap) = intercept + slope·log(TVL) + category offset` with **least absolute deviations** at runtime. IRLS starts from OLS, then repeatedly solves weighted normal equations with weights `1/max(|residual|, 1e-3)` until the coefficients stabilize.
- Rank 300 pre-token, non-CEX protocols by implied value. Residual quartiles supply a low/central/high interval, while bounded growth and maturity priors adjust the central estimate without pretending to be fitted coefficients.
- Keep all 128 already-trading protocols in a separate **Comps** view. They are the model’s evidence base and never become board rows.
- Attach five concrete farm steps to every row, with capital sized from protocol TVL and a qualifying-action window from protocol age.
- Render a dark, framework-free dashboard with a log-log scatter, sortable filters, deep-linked protocol details, and the comparable set.

## Run

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /home/hatch/workspace/makefun/kits/token-radar-01-kit/input/snapshot.json
```

The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`, and `out/dossier.json`. It needs Node 22.18 or newer and uses only the standard library.

## Repository map

- `main.ts` — reads the snapshot, fits the model, validates the board, and writes the output bundle.
- `lib/model.ts` — snapshot parsing, LAD fitting, scoring, residual statistics, board construction, and farm plans.
- `vendor/makefun-board.ts` — canonical dashboard-dossier builder.
- `dashboard/` — static near-black radar with an amber accent and no network access.
- `screenshots/` — fresh 1440×900 renders of the board, rank-one detail, and Comps views.

Built for [make.fun](https://make.fun/?ref=xt604nns&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01).
