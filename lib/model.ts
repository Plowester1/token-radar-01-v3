// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The estimator is a median (least-absolute-deviation) regression in log space, fitted at runtime from
// the snapshot's tokenized comparables. It fits the MEDIAN of log(mcap) given log(TVL) with a category
// intercept, so one 400x outlier cannot drag the line the way OLS lets it. Fitting is IRLS: start from
// the OLS solution, then iterate reweighted least squares with weight w_i = 1/max(|residual_i|, 1e-3),
// solving the weighted normal equations with Gaussian elimination and partial pivoting each round,
// until the largest coefficient change is under 1e-9 or 200 rounds. Everything is implemented here in
// TypeScript against the Node standard library only.
//
// The board ranks 300 pre-token protocols by an implied value with a low/central/high interval. A
// protocol is pre-token when its record carries no market cap, no CoinGecko id and no symbol. The board
// keeps protocol whose token already trades OUT of the ranked rows entirely: they are the model's
// evidence base (the Comps view), never a board row. Categories CEX are also excluded from the board, as
// the house's own watchlist rule does; a protocol with a version-marked name is the only class the board
// admits that the strict watchlist rule would pass over, so the board can show a full 300 rows.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted LAD model, with the residual quantiles that give each row its interval. */
export interface FittedModel {
  intercept: number;
  slope: number;
  categoryOffsets: Record<string, number>;
  referenceCategory: string;
  categories: string[];
  residualSd: number;
  residualP25: number;
  residualP75: number;
  lowFactor: number;
  highFactor: number;
  iterations: number;
}

/** One comp (a tokenized comparable) in the dashboard's Comps view. */
export interface CompRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  ladResidual: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  age_days: number | null;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  model: {
    fitted_log_value: number;
    category_offset: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** Backtest statistics, computed in-sample from the fitted residuals. */
export interface Backtest {
  medianAbsLogError: number;
  medianPctError: number;
  within2x: number;
  within3x: number;
  n: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: FittedModel;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  comps_count: number;
  excluded_count: number;
  excluded_reason: string;
  backtest: Backtest;
  top_implied: number;
  last_implied: number;
  rows: RadarRow[];
  comps: CompRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Solve A x = b for a square matrix by Gaussian elimination with partial pivoting, in place. */
function gaussSolve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => row.concat(b[i]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(aug[r]![c]!) > Math.abs(aug[piv]![c]!)) piv = r;
    [aug[c], aug[piv]] = [aug[piv]!, aug[c]!];
    if (Math.abs(aug[c]![c]!) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = aug[r]![c]! / aug[c]![c]!;
      for (let k = c; k <= n; k++) aug[r]![k] = aug[r]![k]! - f * aug[c]![k]!;
    }
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = aug[i]![n]! / (aug[i]![i]! || 1);
  return x;
}

/** The categories with at least `minComps` comps, sorted; the reference is the first (alphabetically). */
export function fittedCategories(comps: SnapshotProtocol[], minComps: number): string[] {
  const counts = new Map<string, number>();
  for (const p of comps) {
    if (p.category === null) continue;
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minComps)
    .map(([c]) => c)
    .sort();
}

/** Design-row feature index for one comp under the fitted categories (0 = reference category). */
function design(c: SnapshotProtocol, cats: string[]): { x: number[]; y: number } {
  const y = Math.log(c.mcap_usd!);
  const x = Math.log(c.tvl_usd!);
  const row = new Array<number>(2 + cats.length - 1).fill(0);
  row[0] = 1; // intercept
  row[1] = x; // slope on log(TVL)
  const idx = cats.indexOf(c.category ?? '');
  if (idx > 0) row[1 + idx] = 1; // category offset, reference = cats[0]
  return { x: row, y };
}

/**
 * Fit the LAD regression log(mcap) = b0 + b1 log(TVL) + category offsets on the tokenized comps, by
 * IRLS from the OLS start. Returns the fitted coefficients (intercept, slope, then offsets after the
 * reference).
 */
function fitLad(comps: SnapshotProtocol[], cats: string[]): { beta: number[]; iterations: number } {
  const n = 2 + cats.length - 1;
  const rows = comps.map((c) => design(c, cats));
  const y = rows.map((r) => r.y);

  // OLS start: solve the normal equations.
  const A0: number[][] = [];
  const b0: number[] = [];
  for (let i = 0; i < n; i++) {
    const ai: number[] = [];
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (const r of rows) s += r.x[i]! * r.x[j]!;
      ai.push(s);
    }
    A0.push(ai);
    let s = 0;
    for (let k = 0; k < rows.length; k++) s += rows[k]!.x[i]! * y[k]!;
    b0.push(s);
  }
  let beta = gaussSolve(A0, b0);

  let iter = 0;
  for (; iter < 200; iter++) {
    const resid = y.map((yi, k) => yi - rows[k]!.x.reduce((s, v, j) => s + v * beta[j]!, 0));
    const w = resid.map((r) => 1 / Math.max(Math.abs(r), 1e-3));
    const A: number[][] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      const ai: number[] = [];
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < rows.length; k++) s += w[k]! * rows[k]!.x[i]! * rows[k]!.x[j]!;
        ai.push(s);
      }
      A.push(ai);
      let s = 0;
      for (let k = 0; k < rows.length; k++) s += w[k]! * rows[k]!.x[i]! * y[k]!;
      b.push(s);
    }
    const betaNew = gaussSolve(A, b);
    let maxC = 0;
    for (let i = 0; i < n; i++) maxC = Math.max(maxC, Math.abs(betaNew[i]! - beta[i]!));
    beta = betaNew;
    if (maxC < 1e-9) break;
  }
  return { beta, iterations: iter + 1 };
}

/** The LAD model fitted at runtime, with residual quantiles and the interval factors. */
export function fitModel(snapshot: Snapshot): FittedModel {
  const comps = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const cats = fittedCategories(comps, 8);
  const { beta, iterations } = fitLad(comps, cats);

  const residuals = comps.map((c) => {
    const { x, y } = design(c, cats);
    return y - x.reduce((s, v, j) => s + v * beta[j]!, 0);
  });
  residuals.sort((a, b) => a - b);
  const q = (p: number): number => {
    const i = Math.floor(p * (residuals.length - 1));
    return residuals[i]!;
  };
  const p25 = q(0.25);
  const p75 = q(0.75);
  const mean = residuals.reduce((s, r) => s + r, 0) / residuals.length;
  const sd = Math.sqrt(residuals.reduce((s, r) => s + (r - mean) * (r - mean), 0) / residuals.length);

  const offsets: Record<string, number> = {};
  for (let i = 1; i < cats.length; i++) offsets[cats[i]!] = beta[1 + i]!;

  return {
    intercept: beta[0]!,
    slope: beta[1]!,
    categoryOffsets: offsets,
    referenceCategory: cats[0] ?? 'CEX',
    categories: cats,
    residualSd: sd,
    residualP25: p25,
    residualP75: p75,
    lowFactor: Math.exp(p25),
    highFactor: Math.exp(p75),
    iterations,
  };
}

/** The backtest statistics, honestly in-sample from the fitted residuals. */
export function backtestStats(comps: SnapshotProtocol[], model: FittedModel): Backtest {
  const errs = comps.map((c) => {
    const { x, y } = design(c, model.categories);
    const fit = x.reduce((s, v, j) => s + v * (j === 0 ? model.intercept : j === 1 ? model.slope : model.categoryOffsets[model.categories[j]!] ?? 0), 0);
    return y - fit;
  });
  const absErr = errs.map(Math.abs).sort((a, b) => a - b);
  const medianAbs = absErr[Math.floor(absErr.length / 2)]!;
  const medianPct = (Math.exp(medianAbs) - 1) * 100;
  const within2 = errs.filter((e) => Math.abs(e) <= Math.log(2)).length;
  const within3 = errs.filter((e) => Math.abs(e) <= Math.log(3)).length;
  return {
    medianAbsLogError: medianAbs,
    medianPctError: medianPct,
    within2x: within2,
    within3x: within3,
    n: comps.length,
  };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not an exchange. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX';
}

/** The board pool: every rankable protocol, by slug, so no tokenized or CEX row is ever ranked. */
function boardPool(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(isRankable);
}

/** One protocol's fitted log value, category offset and the tilted value, under the fitted model. */
function score(protocol: SnapshotProtocol, snapshot: Snapshot, model: FittedModel) {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(100, Math.max(-50, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * 0.25;
  const ageForModel = age ?? 365;
  const maturityMult = 0.92 + (Math.min(Math.max(ageForModel, 0), 1095) / 1095) * 0.16;

  const tvl = Math.max(protocol.tvl_usd, 1);
  const categoryOffset = model.categoryOffsets[protocol.category ?? ''] ?? 0;
  const fittedLog = model.intercept + model.slope * Math.log(tvl) + categoryOffset;
  const base = Math.exp(fittedLog);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  const low = Math.max(1, Math.round(base * growthMult * maturityMult * model.lowFactor));
  const high = Math.max(1, Math.round(base * growthMult * maturityMult * model.highFactor));
  return { age, growthPct, growthMult, maturityMult, categoryOffset, fittedLog, implied, low, high };
}

/** The protocol's category-specific one-line action, without ever hardcoding a name. */
function actionFor(category: string | null, capital: number, chain: string): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to the protocol's lending market on ${chain} and keep the borrow open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to the protocol's main pool on ${chain} and keep the shares.`;
  if (c.includes('bridge') || c.includes('canonical bridge')) return `Bridge $${capital} of USDC across ${chain} through the protocol and keep the wrapped receipt.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through the protocol and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on the protocol and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on the protocol's prediction books.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('stable') || c.includes('stablecoin')) return `Mint or deposit $${capital} of the stable asset through the protocol on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into the protocol's vault on ${chain} and keep the shares.`;
  if (c.includes('index')) return `Buy or mint $${capital} of the protocol's index token on ${chain}.`;
  return `Deposit $${capital} of USDC into the protocol on ${chain} and keep the position open.`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A protocol's farm plan: five steps, each a concrete 20..600-character action, never naming a protocol. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p.category, capital, chain);
  const steps = [
    `Open the protocol, connect a fresh wallet that holds only the funds you plan to farm, and confirm the claim is open to you.`,
    action,
    `Make one recurring qualifying action each week on the protocol, such as a deposit, a borrow, a swap or a vote, so your activity is counted.`,
    `Monitor the position each week, top up on dips, and keep a farm log of the wallet, dates and every transaction.`,
    `Before you exit, claim only from the protocol's own published link, then follow its unstake or unlock timeline to withdraw.`,
  ];
  return steps.map((s) => {
    let t = s;
    if (t.length > 600) t = `${t.slice(0, 596)}...`;
    if (t.length < 20) t = `${t} Hold the position and check the protocol's own page.`;
    return t;
  });
}

/** The board, ranked by implied value, with ranks 1..n, from the rankable pool. */
export function buildBoard(snapshot: Snapshot, model: FittedModel): BoardRow[] {
  const pool = boardPool(snapshot);
  const scored = pool.map((p) => ({ p, s: score(p, snapshot, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    age_days: s.age,
    implied_value_usd: s.implied,
    low_value_usd: s.low,
    high_value_usd: s.high,
    model: {
      fitted_log_value: round4(s.fittedLog),
      category_offset: round4(s.categoryOffset),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age),
  }));
}

/** The tokenized comparables: the model's evidence base, for the dashboard's Comps view. */
export function compsRows(snapshot: Snapshot, model: FittedModel): CompRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => {
      const { x, y } = design(p, model.categories);
      const fit = x.reduce((s, v, j) => s + v * (j === 0 ? model.intercept : j === 1 ? model.slope : model.categoryOffsets[model.categories[j]!] ?? 0), 0);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        multiple: p.mcap_usd! / p.tvl_usd!,
        ladResidual: y - fit,
      };
    })
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    low_value_usd: row.low_value_usd,
    high_value_usd: row.high_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: FittedModel): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = compsRows(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: 'radar-lad',
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    comps_count: comps.length,
    excluded_count: snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).length - comps.length,
    excluded_reason: 'tokenized comparables are the evidence base, never board rows; protocols that record no token at all are the board',
    backtest: backtestStats(snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0), model),
    top_implied: board[0]?.implied_value_usd ?? 0,
    last_implied: board[board.length - 1]?.implied_value_usd ?? 0,
    rows: board.map(radarRow),
    comps,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Number.isSafeInteger(r.low_value_usd) || r.low_value_usd <= 0) return `${r.slug} has low value ${r.low_value_usd}`;
    if (!Number.isSafeInteger(r.high_value_usd) || r.high_value_usd <= 0) return `${r.slug} has high value ${r.high_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}