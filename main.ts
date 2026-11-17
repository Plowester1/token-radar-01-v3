import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, fitModel, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1]!;
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

const inputOption = option('input', '/input');
const inputPath = inputOption.endsWith('.json') ? inputOption : join(inputOption, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`token-radar: snapshot not found at ${inputPath}; pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}

const outputPath = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const model = fitModel(snapshot);
const { board, radar } = buildRadar(snapshot, model);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token-radar: board validation failed: ${issue}\n`);
  process.exit(1);
}

function copyRegularFiles(source: string, destination: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(destination, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(source).sort()) {
    if (name.startsWith('.')) continue;
    const sourcePath = join(source, name);
    if (!statSync(sourcePath).isFile()) continue;
    copyFileSync(sourcePath, join(destination, name));
    names.push(name);
  }
  return names;
}

mkdirSync(outputPath, { recursive: true });
writeFileSync(join(outputPath, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputPath, 'data.js'), dataScript(radar));
copyRegularFiles(join(root, 'dashboard'), join(outputPath, 'dashboard'));
const images = copyRegularFiles(join(root, 'screenshots'), join(outputPath, 'screenshots'));
if (images.length < 3) {
  process.stderr.write(`token-radar: screenshots/ contains ${images.length} images; three are required\n`);
  process.exit(1);
}
writeFileSync(join(outputPath, 'dossier.json'), buildDossier(outputPath, { text_max_bytes: 65_536 }));

process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watched, ${board.length} board rows (${radar.early_size} early)\n` +
  `token-radar: LAD fit ${model.intercept.toFixed(4)} + ${model.slope.toFixed(4)} log(TVL), ${radar.comps_count} comparables, ${model.iterations} IRLS rounds\n` +
  `token-radar: residual SD ${model.residualSd.toFixed(3)}, p25 ${model.residualP25.toFixed(3)}, p75 ${model.residualP75.toFixed(3)}, factors ${model.lowFactor.toFixed(3)} / ${model.highFactor.toFixed(3)}\n` +
  `token-radar: in-sample median absolute log error ${radar.backtest.medianAbsLogError.toFixed(3)}, median error ${radar.backtest.medianPctError.toFixed(0)}%, within 2x ${radar.backtest.within2x}, within 3x ${radar.backtest.within3x}\n` +
  `token-radar: output written to ${outputPath}\n`,
);
