# STATE — token-radar-01-v3 (@daggerdash)

Approach and build record for this make.fun entry. Session id: `token-radar-01-v3` (account @daggerdash, owner Plowester1, repo token-radar-01-v3).

## Approach

A **median (LAD) regression** radar, the comps-fitted valuation pattern but with a robust estimator. It fits `log(mcap) = intercept + slope·log(TVL) + category offset` at runtime over the 128 tokenized comparables (mcap > 0 and TVL > 0), by **IRLS**: start from the OLS solution, then reweighted least squares with weight `1/max(|residual|, 1e-3)`, Gaussian elimination with partial pivoting each round, until max coefficient change < 1e-9 (or 200 rounds). The LAD line fits the median of log(mcap) given log(TVL), so one 400x outlier cannot drag it the way OLS lets it.

Each pre-token protocol gets a **central implied value** and a **low/high interval** computed from the fitted residual quantiles (p25/p75), so every row carries three values (low = central × exp(p25), high = central × exp(p75)).

## How it differs from v1 (@sunny)

- **Estimator**: LAD (median) regression via IRLS vs v1's OLS log-log + category intercepts. No OLS final fit, no hat-matrix LOO.
- **Board**: 300 rows (40 watchlist + 260 early) vs v1's 200 rows. The 300 come from the pre-token non-CEX pool (see "Board composition" below).
- **Farm steps**: 5 per row (onboard/verify, deploy capital by TVL tier, recurring qualifying action, monitor/compound, exit/claim) vs v1's 6.
- **Dashboard**: dark near-black theme with one amber/gold accent, an SVG log-log scatter (TVL vs implied) with the LAD fitted line + p25/p75 shaded band and a pre-token second series, a top-10 spotlight card row, sortable board table with interval bars, a separate **Comps view** of the 128 tokenized comparables (the evidence base), deep links `#detail=<slug>` and `#q=<text>`. v1 is a light sortable table with a Live-token tab.

## Fitted numbers (measured at runtime on the sealed snapshot)

- `log(mcap) = 7.3425 + 0.5135·log(TVL)` + category offsets, reference category CEX = 0.
- Offsets: Canonical Bridge +0.91, Dexs −0.09, Lending −0.76, Liquid Staking −1.21, RWA +0.21, Yield −0.45.
- Residual SD 2.03; median residual ≈ 0.00 (by construction); p25 −1.33, p75 +1.25; lowFactor ×0.265, highFactor ×3.480.
- IRLS converged in 60 rounds.
- Backtest (in-sample, honest): median |log error| 1.30, median % error ~266%, 37 of 128 within 2× (29%), 55 within 3× (43%). The fit is noisy (mcap/TVL spans 0.0003×–400×); the LAD line and OLS land in the same error band. LAD is chosen for robustness to outliers, not a better backtest.

## Board composition

- 300 rows = 40 watchlist + 260 early, ranks 1..300, implied non-increasing, positive safe integers ≤ 1e14.
- The board ranks **pre-token, non-CEX** protocols (mcap, gecko_id and symbol all null; category != CEX). Tokenized protocols (mcap present) and CEX protocols are **never** board rows — tokenized ones appear only in the Comps view (the model's evidence base), per the judge's separation requirement.
- There are exactly 289 genuinely "rankable" pre-token non-CEX protocols (249 non-watchlist) under the strict watchlist rule that also excludes version-marked names. To reach the 300-row design target, the board admits the 11 pre-token non-CEX protocols whose names carry a version marker (space + V2/v2/2.0 etc). This is the only relaxation; it is stated in the dashboard methodology panel and here. All 300 rows are pre-token and non-CEX; no tokenized protocol is ever ranked.
- Measured: top implied $257,364,340 (rank 1); #300 implied $1,334,894. 40/40 watchlist covered.

## Fixes after resume 3

Three defects found after the first full build were fixed, and the whole build was regenerated and re-verified afterwards:

1. **Mangled word in the farm plan** — `lib/model.ts` line 412 held the step-5 template as "…the protocol's own published *linkhare*, then follow its unstake or unlock timeline to withdraw." The word is now "link". The template is shared by all 300 rows, so every row's step 5 changed with it; `grep -r linkhare out/board.json lib/model.ts` is empty.
2. **Double numbering in the detail view** — `dashboard/app.js` line 347 rendered the farm plan with `<ol>`, whose own list numbering sat beside the explicit `1.`/`2.`… `<span class="n">` marker, so the drawer read "1. 1. Open the protocol…". The element is now `<ul>`, so the explicit span numbers are the only numbers. Nothing else in app.js changed.
3. **Bullet markers and a clipped last step** (found by inspecting the PNG pixels rather than the DOM) — switching to `<ul>` left the browser's default `disc` marker in place, so each step still showed a stray bullet before its numeral, and the farm plan ended at y=934 in a 900 px viewport, so step 5 ("published link,") was cut off by the fold. `dashboard/app.css` now sets `list-style: none` on `.steps` (the accent `.n` span is the sole marker) and the detail sections use tighter spacing, so all five steps fit fully above the fold (step 5 now ends at y=898).

`out/board.json`, `out/data.js` and `out/dossier.json` were regenerated with `main.ts` after the fixes, and only `screenshots/2-detail.png` was retaken (the board and scatter views do not show the farm plan, so they are unchanged — verified by identical sha256 and by re-rendering them byte-for-byte from the current build).

## Verification (all pass)

1. `MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json` exits 0; prints fitted intercept/slope/residual quantiles/backtest. Measured: board.json has 300 rows, 40 watchlist slugs present, ranks exactly 1..300, implied non-increasing, top $257,364,340 (rank 1), #300 $1,334,894, 5 farm steps per row each 20–600 chars, implied positive safe integers ≤ 1e14, low ≤ implied ≤ high on every row.
2. Two runs into out1/ and out2/ are byte-identical (`diff -r out1 out2` empty) — fully deterministic, no timestamps/randomness.
3. Dossier: re-running `buildDossier('out', { text_max_bytes: 65536 })` (the scorer's exact call, two args) is byte-identical with out/dossier.json (measured `cmp` empty); dossier 667,319 bytes (≤ 1.5 MiB); parses as JSON (schema makefun/dossier/v1, cover 0, 3 images); each image entry has keys name/media_type/sha256/base64, its sha256 matches the file bytes and its base64 is canonical.
4. Dashboard: no `http://`/`https://` literals in dashboard/ source (measured grep empty); total dashboard source 36,873 bytes (< 64 KiB); headless-shell render check shows the top slug "Base Bridge", the "300 rows" count and the scatter panel; the detail view (`#detail=base-bridge`) renders `<ul class="steps">` whose five items are `<li><span class="n">1.</span>` … `5.` with no `<ol>` marker and no bullet, and the step-5 text "published link,".
5. Screenshots: 3 PNGs, all 1440×900 RGB: 1-board.png (140,248 B, sha256 37cf78822481…), 2-detail.png (205,289 B, sha256 d6210be88796…), 3-scatter.png (126,196 B, sha256 641cc6b54db4…) — all three sha256 distinct, each ≤ 512 KiB, each with thousands of distinct colours on the dark background, confirming real renders (board, detail of #1 via #detail=base-bridge, scatter/Comps via #view=comps). All three reproduce byte-for-byte when re-rendered from the current out/ (measured `cmp` empty), so the dossier images and the committed screenshots are the same pixels.
6. Model sanity: measured slope 0.5135 (~0.51), intercept 7.3425 (~7.34), residual SD 2.03, p25 −1.33, p75 +1.25, lowFactor 0.265 (~0.27), highFactor 3.480 (~3.5); backtest stats present in data.js (median |log error| 1.30, median % error 266%, within 2× 37, within 3× 55); low/high intervals on every row.
7. Detail screenshot checked at the pixel level (no OCR and no image input available, so the PNG was rendered as ASCII art and compared against renders of deliberately altered builds): the farm-plan marker gutter (x=870–886) has zero ink, so there is no bullet and no second numeral — each step shows exactly one accent "1."–"5."; and a render of the same build with "published link," replaced by "QQZZXXQQ," differs from the committed PNG only in the region rows 856–870, x=1276–1378, which is inside the 900 px viewport, so step 5's wording is genuinely on screen (the pixels there read "published link,"). Before the `list-style: none` and spacing fixes the same differential test put step 5 at rows 892–899, i.e. clipped by the fold.

## How the parent verifies

Run main.ts into out/, `diff -r` two runs, re-run buildDossier and byte-compare, `grep -r "https\?://" dashboard/`, `du -sb dashboard`, view the 3 PNGs, and open the page with the headless shell to confirm rows render (grep the DOM for a known slug and the "300" count).

## Known weaknesses

- The board admits 11 version-marked names to reach 300 rows; the strict rankable pool is 289. This is documented in the methodology panel and README.
- The LAD fit is noisy (mcap/TVL spans 0.0003×–400×); the median error band is wide. It is reported honestly and not inflated.
- Growth and age are bounded priors (growth ±25%, age +8%), not fitted — they tilt the central value but carry no statistical weight.
- The scatter uses a Dexs-reference band for display; category offsets shift each protocol, so the band is indicative, not per-row exact.