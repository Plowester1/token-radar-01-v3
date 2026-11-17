export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface ModelFit {
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

export interface Comparable {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  ladResidual: number;
}

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

export interface Backtest {
  medianAbsLogError: number;
  medianPctError: number;
  within2x: number;
  within3x: number;
  n: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelFit;
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
  comps: Comparable[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY = 86_400_000;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const now = Date.parse(`${asOf}T00:00:00Z`);
  const then = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY));
}

function solveSystem(matrix: number[][], rhs: number[]): number[] {
  const size = matrix.length;
  const augmented = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    const swap = augmented[column]!;
    augmented[column] = augmented[pivot]!;
    augmented[pivot] = swap;
    if (Math.abs(augmented[column]![column]!) < 1e-12) continue;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]! / augmented[column]![column]!;
      for (let k = column; k <= size; k += 1) {
        augmented[row]![k] = augmented[row]![k]! - factor * augmented[column]![k]!;
      }
    }
  }
  return augmented.map((row, i) => row[size]! / (row[i]! || 1));
}

function featureRow(protocol: Protocol, categories: string[]): number[] {
  const values = new Array<number>(categories.length + 1).fill(0);
  values[0] = 1;
  values[1] = Math.log(protocol.tvl_usd!);
  const categoryIndex = categories.indexOf(protocol.category ?? '');
  if (categoryIndex > 0) values[categoryIndex + 1] = 1;
  return values;
}

export function fittedCategories(comps: Protocol[], minimum = 8): string[] {
  const counts = new Map<string, number>();
  for (const comp of comps) {
    if (comp.category === null) continue;
    counts.set(comp.category, (counts.get(comp.category) ?? 0) + 1);
  }
  return [...counts]
    .filter((pair) => pair[1] >= minimum)
    .map((pair) => pair[0])
    .sort();
}

function weightedNormal(rows: number[][], values: number[], weights: number[]): { matrix: number[][]; rhs: number[] } {
  const width = rows[0]!.length;
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let left = 0; left < width; left += 1) {
    const row = new Array<number>(width).fill(0);
    let target = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const weight = weights[index]!;
      for (let right = 0; right < width; right += 1) {
        row[right] += weight * rows[index]![left]! * rows[index]![right]!;
      }
      target += weight * rows[index]![left]! * values[index]!;
    }
    matrix.push(row);
    rhs.push(target);
  }
  return { matrix, rhs };
}

function fitLad(comps: Protocol[], categories: string[]): { beta: number[]; rounds: number } {
  const rows = comps.map((comp) => featureRow(comp, categories));
  const values = comps.map((comp) => Math.log(comp.mcap_usd!));
  const plain = weightedNormal(rows, values, values.map(() => 1));
  let beta = solveSystem(plain.matrix, plain.rhs);
  let rounds = 0;
  for (; rounds < 200; rounds += 1) {
    const residuals = values.map((value, index) => value - dot(rows[index]!, beta));
    const weights = residuals.map((residual) => 1 / Math.max(Math.abs(residual), 1e-3));
    const weighted = weightedNormal(rows, values, weights);
    const next = solveSystem(weighted.matrix, weighted.rhs);
    const movement = Math.max(...next.map((value, index) => Math.abs(value - beta[index]!)));
    beta = next;
    if (movement < 1e-9) break;
  }
  return { beta, rounds: rounds + 1 };
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

export function fitModel(snapshot: Snapshot): ModelFit {
  const comps = snapshot.protocols.filter((protocol) => protocol.mcap_usd !== null && protocol.mcap_usd > 0 && protocol.tvl_usd > 0);
  const categories = fittedCategories(comps);
  const { beta, rounds } = fitLad(comps, categories);
  const residuals = comps.map((comp) => Math.log(comp.mcap_usd!) - dot(featureRow(comp, categories), beta)).sort((a, b) => a - b);
  const quantile = (fraction: number): number => residuals[Math.floor(fraction * (residuals.length - 1))]!;
  const p25 = quantile(0.25);
  const p75 = quantile(0.75);
  const mean = residuals.reduce((sum, residual) => sum + residual, 0) / residuals.length;
  const residualSd = Math.sqrt(residuals.reduce((sum, residual) => sum + (residual - mean) ** 2, 0) / residuals.length);
  const categoryOffsets: Record<string, number> = {};
  for (let index = 1; index < categories.length; index += 1) categoryOffsets[categories[index]!] = beta[index + 1]!;
  return {
    intercept: beta[0]!,
    slope: beta[1]!,
    categoryOffsets,
    referenceCategory: categories[0] ?? 'CEX',
    categories,
    residualSd,
    residualP25: p25,
    residualP75: p75,
    lowFactor: Math.exp(p25),
    highFactor: Math.exp(p75),
    iterations: rounds,
  };
}

function predictedLog(protocol: Protocol, model: ModelFit): number {
  const category = protocol.category ?? '';
  return model.intercept + model.slope * Math.log(Math.max(protocol.tvl_usd, 1)) + (model.categoryOffsets[category] ?? 0);
}

function evidencePrediction(protocol: Protocol, model: ModelFit): number {
  const categoryIndex = model.categories.indexOf(protocol.category ?? '');
  const shiftedOffset = categoryIndex > 0 ? model.categoryOffsets[model.categories[categoryIndex + 1] ?? ''] ?? 0 : 0;
  return model.intercept + model.slope * Math.log(Math.max(protocol.tvl_usd, 1)) + shiftedOffset;
}

export function backtestStats(comps: Protocol[], model: ModelFit): Backtest {
  const errors = comps.map((comp) => Math.log(comp.mcap_usd!) - evidencePrediction(comp, model));
  const absolute = errors.map(Math.abs).sort((a, b) => a - b);
  const medianAbs = absolute[Math.floor(absolute.length / 2)]!;
  return {
    medianAbsLogError: medianAbs,
    medianPctError: (Math.exp(medianAbs) - 1) * 100,
    within2x: errors.filter((error) => Math.abs(error) <= Math.log(2)).length,
    within3x: errors.filter((error) => Math.abs(error) <= Math.log(3)).length,
    n: comps.length,
  };
}

export function isPreToken(protocol: Protocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

export function isRankable(protocol: Protocol): boolean {
  return isPreToken(protocol) && protocol.category !== 'CEX';
}

interface Score {
  age: number | null;
  growthPct: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  categoryOffset: number;
  fittedLog: number;
  implied: number;
  low: number;
  high: number;
}

function scoreProtocol(protocol: Protocol, snapshot: Snapshot, model: ModelFit): Score {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const growthPct = Math.min(100, Math.max(-50, finiteOr(protocol.change_7d, 0)));
  const growthMultiplier = 1 + growthPct * 0.0025;
  const ageYears = age ?? 365;
  const maturityMultiplier = 0.92 + (Math.min(Math.max(ageYears, 0), 1095) / 1095) * 0.16;
  const categoryOffset = model.categoryOffsets[protocol.category ?? ''] ?? 0;
  const fittedLog = model.intercept + model.slope * Math.log(Math.max(protocol.tvl_usd, 1)) + categoryOffset;
  const base = Math.exp(fittedLog);
  const implied = Math.max(1, Math.round(base * growthMultiplier * maturityMultiplier));
  return {
    age,
    growthPct,
    growthMultiplier,
    maturityMultiplier,
    categoryOffset,
    fittedLog,
    implied,
    low: Math.max(1, Math.round(base * growthMultiplier * maturityMultiplier * model.lowFactor)),
    high: Math.max(1, Math.round(base * growthMultiplier * maturityMultiplier * model.highFactor)),
  };
}

export function buildBoard(snapshot: Snapshot, model: ModelFit): BoardRow[] {
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((protocol) => ({ protocol, score: scoreProtocol(protocol, snapshot, model) }));
  scored.sort((left, right) => {
    if (right.score.implied !== left.score.implied) return right.score.implied - left.score.implied;
    if (left.protocol.slug < right.protocol.slug) return -1;
    return left.protocol.slug > right.protocol.slug ? 1 : 0;
  });
  return scored.map(({ protocol, score }, index) => ({
    rank: index + 1,
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: protocol.chains,
    tvl_usd: protocol.tvl_usd,
    change_7d: protocol.change_7d,
    mcap_usd: protocol.mcap_usd,
    listed_at: protocol.listed_at,
    gecko_id: protocol.gecko_id,
    symbol: protocol.symbol,
    age_days: score.age,
    implied_value_usd: score.implied,
    low_value_usd: score.low,
    high_value_usd: score.high,
    model: {
      fitted_log_value: round4(score.fittedLog),
      category_offset: round4(score.categoryOffset),
      growth_pct: round4(score.growthPct),
      growth_multiplier: round4(score.growthMultiplier),
      maturity_multiplier: round4(score.maturityMultiplier),
      age_days: score.age,
    },
    farm_steps: farmSteps(protocol, score.age),
  }));
}

function capitalFor(protocol: Protocol): number {
  if (protocol.tvl_usd >= 5_000_000_000) return 300;
  if (protocol.tvl_usd >= 1_000_000_000) return 200;
  if (protocol.tvl_usd >= 100_000_000) return 120;
  return 60;
}

function primaryChain(protocol: Protocol): string {
  return protocol.chains[0] ?? 'its main chain';
}

function actionFor(protocol: Protocol, capital: number): string {
  const category = (protocol.category ?? '').toLowerCase();
  const chain = primaryChain(protocol);
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) {
    return `Put $${capital} of USDC into the lending market on ${chain}, accept the borrow, and keep the supplied position open.`;
  }
  if (category.includes('dex') || category.includes('yield') || category.includes('leveraged farm')) {
    return `Add $${capital} to the main liquidity pool on ${chain}, collect the receipt token, and leave the position open.`;
  }
  if (category.includes('bridge') || category.includes('canonical bridge')) {
    return `Bridge $${capital} of USDC over ${chain} using the protocol, then retain the wrapped receipt instead of unwrapping it.`;
  }
  if (category.includes('staking') || category.includes('restak')) {
    return `Stake $${capital} of the native staking asset through the protocol on ${chain} and hold the receipt.`;
  }
  if (category.includes('perpetual') || category.includes('derivative')) {
    return `Post $${capital} of USDC as margin on ${chain} and hold one small hedged perpetual position.`;
  }
  if (category.includes('prediction')) {
    return `Fund $${capital} in the protocol wallet and place one small position in its prediction market.`;
  }
  if (category.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain}, then keep the resulting receipt.`;
  }
  if (category.includes('stable') || category.includes('stablecoin')) {
    return `Deposit $${capital} of the stable asset through the protocol on ${chain} and track the issued balance.`;
  }
  if (category.includes('curator') || category.includes('allocator')) {
    return `Deposit $${capital} into a protocol vault on ${chain} and retain the vault shares.`;
  }
  if (category.includes('index')) {
    return `Buy or mint $${capital} of the protocol's index token on ${chain} and hold that token.`;
  }
  return `Deposit $${capital} of USDC into the protocol on ${chain} and keep the resulting position open.`;
}

function holdingWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

export function farmSteps(protocol: Protocol, age: number | null): string[] {
  const capital = capitalFor(protocol);
  const window = holdingWindow(age);
  const steps = [
    `Open the protocol with a fresh wallet containing only the capital you have allocated, then verify that deposits and the claim flow work for your account.`,
    actionFor(protocol, capital),
    `Repeat one qualifying action each week for ${window} days, such as depositing, borrowing, swapping or voting, and record every transaction date in your farm log.`,
    `Review the open position weekly, reinvest a small amount when the protocol's TVL is improving, and stop adding if liquidity or safety signals deteriorate.`,
    `Before you exit, claim only from the protocol's own published link, then follow its unstake or unlock timeline to withdraw.`,
  ];
  return steps.map((step) => {
    if (step.length > 600) return `${step.slice(0, 596)}...`;
    if (step.length < 20) return `${step} Keep the position open and review the protocol page.`;
    return step;
  });
}

export function comparableRows(snapshot: Snapshot, model: ModelFit): Comparable[] {
  return snapshot.protocols
    .filter((protocol) => protocol.mcap_usd !== null && protocol.mcap_usd > 0 && protocol.tvl_usd > 0)
    .map((protocol) => ({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      tvl_usd: protocol.tvl_usd,
      mcap_usd: protocol.mcap_usd!,
      multiple: protocol.mcap_usd! / protocol.tvl_usd!,
      ladResidual: Math.log(protocol.mcap_usd!) - evidencePrediction(protocol, model),
    }))
    .sort((left, right) => right.tvl_usd - left.tvl_usd);
}

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

export function buildRadar(snapshot: Snapshot, model: ModelFit): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = comparableRows(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((row) => !watchlist.has(row.slug)).length;
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
    excluded_count: 0,
    excluded_reason: 'Tokenized protocols form the comparable set and never become board rows; board rows record no token and are not exchanges.',
    backtest: backtestStats(snapshot.protocols.filter((protocol) => protocol.mcap_usd !== null && protocol.mcap_usd > 0 && protocol.tvl_usd > 0), model),
    top_implied: board[0]?.implied_value_usd ?? 0,
    last_implied: board.at(-1)?.implied_value_usd ?? 0,
    rows: board.map(radarRow),
    comps,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new SnapshotError('snapshot.json must contain a JSON object');
  }
  const record = document as Record<string, unknown>;
  if (typeof record.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.as_of)) {
    throw new SnapshotError('snapshot.json has no valid as_of date');
  }
  if (typeof record.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof record.floor_usd !== 'number' || !Number.isSafeInteger(record.floor_usd) || record.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no positive floor_usd');
  }
  if (!Array.isArray(record.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(record.watchlist) || record.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slug strings');
  }
  const protocols = record.protocols.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapshotError(`snapshot.json protocol ${index} is not an object`);
    }
    const item = value as Record<string, unknown>;
    if (typeof item.slug !== 'string' || typeof item.name !== 'string' || typeof item.tvl_usd !== 'number' || !Number.isFinite(item.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${index} lacks a slug, name, or finite TVL`);
    }
    return {
      slug: item.slug,
      name: item.name,
      category: typeof item.category === 'string' ? item.category : null,
      chains: Array.isArray(item.chains) ? item.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: item.tvl_usd,
      change_7d: typeof item.change_7d === 'number' && Number.isFinite(item.change_7d) ? item.change_7d : null,
      mcap_usd: typeof item.mcap_usd === 'number' && Number.isFinite(item.mcap_usd) ? item.mcap_usd : null,
      listed_at: typeof item.listed_at === 'string' ? item.listed_at : null,
      gecko_id: typeof item.gecko_id === 'string' ? item.gecko_id : null,
      symbol: typeof item.symbol === 'string' ? item.symbol : null,
    };
  });
  return {
    as_of: record.as_of,
    source: record.source,
    floor_usd: record.floor_usd,
    protocols,
    watchlist: record.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `${missing.length} watchlist protocols are absent: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let index = 0; index < ranks.length; index += 1) {
    if (ranks[index] !== index + 1) return `rank ${index + 1} holds ${ranks[index]}`;
  }
  for (let index = 1; index < board.length; index += 1) {
    if (board[index]!.implied_value_usd > board[index - 1]!.implied_value_usd) return `row ${index + 1} has more value than row ${index}`;
  }
  if (board.length > 1 && board[0]!.implied_value_usd === board.at(-1)!.implied_value_usd) {
    return 'every row has the same implied value';
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a ${step.length}-character farm step`;
    }
    for (const value of [row.implied_value_usd, row.low_value_usd, row.high_value_usd]) {
      if (!Number.isSafeInteger(value) || value <= 0) return `${row.slug} has an invalid value`;
    }
    if (row.low_value_usd > row.implied_value_usd || row.implied_value_usd > row.high_value_usd) {
      return `${row.slug} has an invalid value interval`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
