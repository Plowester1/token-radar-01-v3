import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';

export const DOSSIER_SCHEMA = 'makefun/dossier/v1';
export const DOSSIER_MAX_BYTES = 4 * 1024 * 1024;
export const DOSSIER_MAX_IMAGES = 8;
export const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
export const TEXT_FILE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;

export interface DossierCaps {
  text_max_bytes: number;
  screenshots?: { max: number; max_bytes: number };
  dashboard?: { max_files: number; max_bytes: number };
}

export class DossierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DossierError';
  }
}

interface SourceFile {
  path: string;
  size: number;
}

interface SourceSection {
  heading: string;
  content: string;
  block: string;
  size: number;
  bytes: number;
  lines: number;
  fence: string;
  language: string;
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: ${value} is not finite`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonicalJson: only plain objects and arrays are supported');
    const object = value as Record<string, unknown>;
    const members = Object.keys(object).sort(compareNames).map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`canonicalJson: ${typeof value} is not JSON data`);
}

function readLimited(path: string, limit: number, label: string): Uint8Array {
  let size: number;
  try {
    const info = lstatSync(path);
    if (!info.isFile()) throw new DossierError(`buildDossier: ${label} is not a regular file`);
    size = info.size;
  } catch (error) {
    if (error instanceof DossierError) throw error;
    throw new DossierError(`buildDossier: ${label} cannot be read`);
  }
  if (size > limit) throw new DossierError(`buildDossier: ${label} exceeds its ${limit}-byte read limit`);
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new DossierError(`buildDossier: ${label} is not a regular file`);
  }
  try {
    const confirmed = fstatSync(descriptor).size;
    if (confirmed > limit) throw new DossierError(`buildDossier: ${label} exceeds its ${limit}-byte read limit`);
    const buffer = Buffer.alloc(confirmed);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    return new Uint8Array(buffer.buffer, buffer.byteOffset, offset);
  } finally {
    closeSync(descriptor);
  }
}

function collectDashboardFiles(root: string, caps: { max_files: number; max_bytes: number } | null): SourceFile[] {
  let rootInfo: import('node:fs').Stats;
  try {
    rootInfo = lstatSync(root);
  } catch {
    throw new DossierError('buildDossier: dashboard/ is missing');
  }
  if (!rootInfo.isDirectory()) throw new DossierError('buildDossier: dashboard is not a directory');
  const files: SourceFile[] = [];
  let total = 0;
  const pending = [''];
  while (pending.length > 0) {
    const relative = pending.pop()!;
    const directory = relative === '' ? root : join(root, relative);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) throw new DossierError(`buildDossier: dashboard/${path} is a dot-directory`);
        pending.push(path);
      } else if (entry.isFile()) {
        if (!PLAIN_NAME.test(entry.name)) throw new DossierError(`buildDossier: dashboard/${path} has an unsupported name`);
        const size = lstatSync(join(root, path)).size;
        files.push({ path, size });
        total += size;
        if (caps !== null && files.length > caps.max_files) throw new DossierError(`buildDossier: dashboard/ has more than ${caps.max_files} files`);
        if (caps !== null && total > caps.max_bytes) throw new DossierError(`buildDossier: dashboard/ exceeds ${caps.max_bytes} bytes`);
      } else {
        throw new DossierError(`buildDossier: dashboard/${path} is neither a file nor a directory`);
      }
    }
  }
  return files.sort((left, right) => compareNames(left.path, right.path));
}

function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value);
}

function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let newlines = 0;
  for (const byte of bytes) if (byte === 0x0a) newlines += 1;
  return bytes[bytes.length - 1] === 0x0a ? newlines : newlines + 1;
}

function chooseFence(content: string): string {
  let longest = 0;
  for (const match of content.match(/`+/g) ?? []) longest = Math.max(longest, match.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function languageFor(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1);
  return extension === 'mjs' ? 'js' : extension;
}

function makeSection(file: SourceFile, bytes: Uint8Array): SourceSection {
  const lines = countLines(bytes);
  const heading = `### ${file.path}\n\n${bytes.length} bytes, ${lines} line${lines === 1 ? '' : 's'}\n\n`;
  if (bytes.length === 0) return { heading, content: '', block: '', size: byteLength(heading), bytes: 0, lines, fence: '', language: '' };
  const content = new TextDecoder('utf-8').decode(bytes);
  const fence = chooseFence(content);
  const language = languageFor(file.path);
  const block = `${fence}${language}\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
  return { heading, content, block, size: byteLength(heading) + byteLength(block), bytes: bytes.length, lines, fence, language };
}

export function buildDossier(dir: string, caps: DossierCaps): Uint8Array {
  const textLimit = caps.text_max_bytes;
  if (!Number.isSafeInteger(textLimit) || textLimit <= 0) {
    throw new DossierError(`buildDossier: text_max_bytes must be a positive integer, not ${String(textLimit)}`);
  }
  let imageLimit = DOSSIER_MAX_IMAGES;
  let imageByteLimit = DOSSIER_MAX_BYTES;
  if (caps.screenshots !== undefined) {
    const limits = caps.screenshots as { max?: unknown; max_bytes?: unknown };
    if (typeof limits !== 'object' || limits === null) throw new DossierError('buildDossier: screenshots caps must be an object');
    for (const key of ['max', 'max_bytes'] as const) {
      const value = limits[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new DossierError(`buildDossier: screenshot cap ${key} is invalid`);
    }
    imageLimit = Math.min(imageLimit, limits.max as number);
    imageByteLimit = Math.min(imageByteLimit, limits.max_bytes as number);
  }
  let dashboardCaps: { max_files: number; max_bytes: number } | null = null;
  if (caps.dashboard !== undefined) {
    const limits = caps.dashboard as { max_files?: unknown; max_bytes?: unknown };
    if (typeof limits !== 'object' || limits === null) throw new DossierError('buildDossier: dashboard caps must be an object');
    for (const key of ['max_files', 'max_bytes'] as const) {
      const value = limits[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new DossierError(`buildDossier: dashboard cap ${key} is invalid`);
    }
    dashboardCaps = { max_files: limits.max_files as number, max_bytes: limits.max_bytes as number };
  }

  const files = collectDashboardFiles(join(dir, 'dashboard'), dashboardCaps);
  const screenshotDirectory = join(dir, 'screenshots');
  let screenshotNames: string[];
  try {
    screenshotNames = readdirSync(screenshotDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareNames);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') throw new DossierError('buildDossier: screenshots/ is missing');
    throw new DossierError('buildDossier: screenshots/ cannot be read');
  }
  if (screenshotNames.length === 0) throw new DossierError('buildDossier: screenshots/ is empty');
  if (screenshotNames.length > imageLimit) throw new DossierError(`buildDossier: screenshots/ has more than ${imageLimit} images`);
  const images = screenshotNames.map((name) => {
    if (!PLAIN_NAME.test(name)) throw new DossierError(`buildDossier: screenshots/${name} has an unsupported name`);
    const bytes = readLimited(join(screenshotDirectory, name), imageByteLimit, `screenshots/${name}`);
    const media_type = hasMagic(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? 'image/png'
      : hasMagic(bytes, [0xff, 0xd8, 0xff]) ? 'image/jpeg' : null;
    if (media_type === null) throw new DossierError(`buildDossier: screenshots/${name} is neither PNG nor JPEG`);
    return { name, media_type, sha256: digest(bytes), base64: Buffer.from(bytes).toString('base64') };
  });

  const sourceFiles = files.filter((file) => TEXT_FILE.test(file.path));
  const sections = sourceFiles.map((file) => makeSection(file, readLimited(join(dir, 'dashboard', file.path), DOSSIER_MAX_BYTES, `dashboard/${file.path}`)));
  const dashboardBytes = files.reduce((sum, file) => sum + file.size, 0);
  const head = [
    '## Dashboard',
    '',
    `Files: ${files.length} (${dashboardBytes} bytes)`,
    ...files.map((file) => `- ${file.path} (${file.size} bytes)`),
    '',
    '## Source',
    '',
    '',
  ].join('\n');
  let text = head;
  for (const section of sections) text += `${section.heading}${section.block}`;
  if (byteLength(text) > textLimit) {
    throw new DossierError(`buildDossier: dashboard source needs ${byteLength(text)} bytes, above the ${textLimit}-byte limit`);
  }
  const dossier = {
    schema: DOSSIER_SCHEMA,
    cover: 0,
    text: text.replace(/\n+$/, '\n'),
    images,
  };
  const bytes = Buffer.from(canonicalJson(dossier), 'utf8');
  if (bytes.length > DOSSIER_MAX_BYTES) throw new DossierError(`buildDossier: dossier is ${bytes.length} bytes, above the ${DOSSIER_MAX_BYTES}-byte limit`);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}
