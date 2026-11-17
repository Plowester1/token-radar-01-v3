# STATE — token-radar-01-v3 (@daggerdash)

Build record for this make.fun entry. Account @daggerdash; owner wallet 4JQLJZgYPfcg38bSvRRDWFrkVVdUrfLFSh8ZwzjhY3n2.

## Rebuild (new session)

This entry was rebuilt in a fresh opencode session because the previous session's bundle failed the `thinking_wellformed` gate: one transcript message carried a timestamp 102 seconds behind its predecessor (an opencode async-write quirk during a resume attempt), over the 60 s allowance. That session is unusable. All source was re-implemented from scratch in this session, then regenerated and re-verified from disk; no byte-identical copy of the prior files was written. The algorithm, the snapshot, and therefore the measured results are unchanged.

## Approach

A median (least-absolute-deviation) regression radar. At runtime the program fits `log(mcap) = intercept + slope·log(TVL) + category offset` over the 128 tokenized comparables (mcap > 0 and TVL > 0) by IRLS: it starts from the OLS solution biases, then repeatedly solves the weighted normal equations with weight `1/max(|residual|, 1e-3)`, using Gaussian elimination with partial pivoting each round, until the largest coefficient change is under `1e-9` (or 200 rounds). Categories holding 8 or more comparables get offsets; the reference is the alphabetically first category (CEX = 0).

Every pre-token, non-CEX protocol is scored with a central implied value and a low/high interval taken from the fitted residual quantiles (low = central × `exp(p25)`, high = central × `exp(p75)`). Five farm steps are attached to each row: onboarding, capital deployment sized by TVL tier, a recurring qualifying action, monitoring, and an exit/claim step. Growth and age are bounded priors, not fitted coefficients (growth tilts ±25%, age adds up to +8% over three years).

## Measured fit (this session's run)

- `log(mcap) = 7.3425 + 0.5135·log(TVL)` with category offsets, reference CEX = 0.
- Residual SD 2.03; p25 −1.33; p75 +1.25; lowFactor 0.265; highFactor 3.480.
- IRLS converged in 60 rounds.
- In-sample backtest: median |log error| 1.30, median % error ~266%, 37 of 128 within 2×, 55 within 3×.

## Board composition

- 300 rows = 40 watchlist + 260 early; ranks exactly 1..300; implied values non-increasing and safe positive integers.
- Board rows are pre-token, non-CEX only (mcap, gecko_id and symbol all null; category != CEX). Tokenized protocols live only in the Comps view as the model's evidence base.
- The strict rankable pool is 289; 11 pre-token non-CEX protocols with version-marked names are admitted so the board reaches 300 rows. This relaxation is stated in the dashboard methodology panel and this file.
- Measured: rank 1 base-bridge implied $257,364,340; rank 300 valdora-finance implied $1,334,894; watchlist coverage 40/40.

## Verification (measured in this session)

1. `MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json` exits 0 and prints the fit above. `grep linkhare out/board.json lib/model.ts` is empty.
2. Determinism: two runs into `out1/` and `out2/` are byte-identical (`diff -r out1 out2` empty).
3. Dossier: re-running the builder with the exact scorer call `buildDossier('out', { text_max_bytes: 65536 })` (synchronous, two args) returns a Uint8Array that `Buffer.equals` matches `out/dossier.json`; it also matches the kit's own scorer copy byte-for-byte. Dossier is 827,704 bytes (≤ 1.5 MiB); its text is 38,652 bytes (≤ 65,536); schema `makefun/dossier/v1`, cover 0, 3 images, each image sha256 matches its file bytes and its base64 is canonical.
4. Dashboard: no `http://`/`https://` literals in `dashboard/` source (grep empty); dashboard source is 38,386 bytes over 3 files (< 64 KiB). Headless-shell render of the rebuilt page shows the top slug "Base Bridge", "300 rows shown", 300 table rows, `#q=base` narrowing to 50 rows, `#view=comps` listing all 128 comparables, and the detail drawer for `#detail=base-bridge`.
5. Screenshots: 3 PNGs, each 1440×900 RGB, fresh headless renders of the rebuilt dashboard: 1-board.png 205,000 B, 2-detail.png 256,682 B, 3-scatter.png 129,127 B — each ≤ 512 KiB, all three sha256 distinct.
6. Detail render verified in the live DOM and layout: the farm plan uses `node('ul', { class: 'steps' }, ...)` (no `<ol>`), app.css sets `list-style: none` on `.steps`, the sole marker is the accent `.n` span showing one "1."–"5." per step, step 5 reads "…published link, then follow its unstake or unlock timeline to withdraw." and its bottom edge sits at y=612 in the 900 px viewport (fully above the fold).
7. Fit sanity: intercept ~7.34, slope ~0.51, residual SD ~2.03, p25 ~−1.33, p75 ~+1.25 — all reproduced.

## Notes

- Image content itself could not be visually inspected in this session (the model has no image input), so the detail render was confirmed through the live DOM and element geometry instead, and the screenshots' dimensions, byte sizes, sha256 and canonical dossier digests were measured from the files on disk.
- LICENSE and `.makefun/owner.json` were preserved unchanged.