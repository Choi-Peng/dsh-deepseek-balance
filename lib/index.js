// AI 生成声明:本插件代码由 AI 生成,可能存在错误或安全隐患,使用前请 review 并实测。
// DeepSeek Balance — Host half
// Registers HTTP routes that proxy the DeepSeek balance API and expose the
// plugin configuration (currency display + per-currency warning thresholds).
//
// Configuration is layered, and both layers apply live while dsh web runs:
//   1. Primary: UI edits from Settings → Plugins are persisted into the
//      profile's cordis.patch.yml, on this plugin's own row `config`
//      (identified by the row's `name`/`id`). dsh watches the patch layer
//      (watchUserPatches + cordis-plugin-hmr) and restarts this fiber with
//      the new config — no restart of dsh web. Only the row's `config`
//      mapping is spliced in place, so comments and `!!js` expressions
//      elsewhere in the file survive; a splice that fails validation falls
//      back to a full js-yaml round-trip of the patch list (same dialect the
//      loader itself uses: entryListSchema).
//   2. Default seeding: on startup, when this plugin's row is absent from the
//      profile's cordis.patch.yml, the plugin writes a fresh default row
//      (id + name + DEFAULT_SETTINGS) into that file so the Settings card has
//      a stable place to read from and write back to. There is no legacy
//      overrides file; the patch row is the single source of truth.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';

/** The profile patch filename this plugin persists settings into. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml';

/** Defaults: no warning threshold (0 = disabled). */
export const DEFAULT_SETTINGS = {
  displayCurrency: 'cny', // cny | usd | both
  warningThresholdCny: 0,
  warningThresholdUsd: 0,
};

const SETTINGS_FIELDS = ['displayCurrency', 'warningThresholdCny', 'warningThresholdUsd'];

/** Apply one validated field onto `out`; invalid values are ignored. */
function normalizeField(out, field, value) {
  if (field === 'displayCurrency') {
    if (value === 'cny' || value === 'usd' || value === 'both') out.displayCurrency = value;
  } else if (field === 'warningThresholdCny' || field === 'warningThresholdUsd') {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[field] = value;
  }
}

/** Merge the loader-provided config over the defaults, per field. */
function resolveSettings(config) {
  const out = { ...DEFAULT_SETTINGS };
  if (config && typeof config === 'object') {
    for (const field of SETTINGS_FIELDS) normalizeField(out, field, config[field]);
  }
  return out;
}

/** Effective settings = the loader-provided row config, resolved per field. */
function effectiveSettings(config) {
  return resolveSettings(config);
}

/** Whether the loader-provided config carries an explicit setting. */
function rowConfigSet(config) {
  return !!config && typeof config === 'object' && SETTINGS_FIELDS.some((field) => config[field] !== undefined);
}

/**
 * Locate this plugin's row inside a parsed patch list. A row is either an
 * entry of an `insert:` list or a bare id-targeted patch option; both are
 * matched by the row's `name` (package name) first, then by `id`.
 * @returns the matched entry object, or null when absent.
 */
function findRow(data, rowName, rowId) {
  for (const patch of data) {
    if (!patch || typeof patch !== 'object') continue;
    const candidates = Array.isArray(patch.insert) ? patch.insert : [patch];
    for (const entry of candidates) {
      if (!entry || typeof entry !== 'object') continue;
      if ((rowName && entry.name === rowName) || (rowId && entry.id === rowId)) return { entry };
    }
  }
  return null;
}

/**
 * The profile cordis.patch.yml backing this plugin's row. The loader mounts
 * this plugin's row inside the root include (the profile's cordis.yml), which
 * sits in the profile directory; that directory — from the include's file
 * path or the inherited `ctx.baseUrl` — locates the patch file. When the row
 * is genuinely mounted from a `cordis.patch.yml` include itself, that exact
 * path wins.
 */
function resolvePatchFile(ctx) {
  const entry = ctx && ctx.fiber && ctx.fiber.entry;
  const include = entry && entry.parent && entry.parent.tree;
  if (include && typeof include.filename === 'string' && include.filename.length > 0) {
    if (basename(include.filename) === PROFILE_PATCH_FILENAME) return include.filename;
    return join(dirname(include.filename), PROFILE_PATCH_FILENAME);
  }
  if (ctx && typeof ctx.baseUrl === 'string' && ctx.baseUrl.length > 0) {
    const base = ctx.baseUrl.startsWith('file:') ? fileURLToPath(ctx.baseUrl) : ctx.baseUrl;
    return join(base, PROFILE_PATCH_FILENAME);
  }
  return undefined;
}

/** Leading whitespace width of a YAML line (spaces). */
function leadingSpaces(line) {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1;
  return i;
}

/** Match a `name:` line whose scalar value equals `rowName`. */
function matchRowName(line, rowName) {
  const match = /^\s*name:\s*(['"]?)([^'"]*?)\1\s*(?:#.*)?$/.exec(line);
  return !!match && match[2] === rowName;
}

/** Match an `id:` line whose scalar value equals `rowId`. */
function matchRowId(line, rowId) {
  const match = /^\s*id:\s*(['"]?)([^'"]*?)\1\s*(?:#.*)?$/.exec(line);
  return !!match && match[2] === rowId;
}

/** Render a scalar in the safe YAML subset this plugin's settings use. */
function formatScalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    if (/^(?:cny|usd|both)$/.test(value)) return value;
    return `'${value.replace(/'/g, "''")}'`;
  }
  return String(value);
}

/** The `config:` block text for one row, or null when removing the config. */
function buildConfigBlock(keyIndent, config, eol) {
  const pad = ' '.repeat(keyIndent);
  const sub = ' '.repeat(keyIndent + 2);
  const lines = [`${pad}config:`];
  for (const field of SETTINGS_FIELDS) lines.push(`${sub}${field}: ${formatScalar(config[field])}`);
  return lines.join(eol);
}

/**
 * Splice this plugin's `config:` mapping in the raw patch file text, leaving
 * every other byte untouched (comments, `!!js` expressions, other rows).
 * Returns the new text, or undefined when the row text is unrecognizable
 * (caller falls back to a full round-trip dump).
 */
function spliceConfigBlock(text, rowName, rowId, nextConfig) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // Trailing empty elements only represent the file's final newline(s); drop
  // them so boundary math works on real content, then restore the newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const trailingEol = text.endsWith(eol) ? eol : '';
  let nameIdx = -1;
  if (rowName) nameIdx = lines.findIndex((line) => matchRowName(line, rowName));
  if (nameIdx < 0 && rowId) nameIdx = lines.findIndex((line) => matchRowId(line, rowId));
  if (nameIdx < 0) return undefined;

  const keyIndent = leadingSpaces(lines[nameIdx]);

  // Scan below the name/id line: nested content belongs to the row; a key at
  // the same indent is our `config:` (or an unexpected sibling key); a dedent
  // ends the row block.
  let configIdx = -1;
  let boundary = lines.length;
  for (let i = nameIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = leadingSpaces(line);
    if (indent > keyIndent) continue;
    if (indent === keyIndent) {
      if (line.trim().startsWith('config:')) {
        configIdx = i;
        break;
      }
      return undefined; // unexpected sibling key — do not guess
    }
    boundary = i;
    break;
  }

  const block = nextConfig == null ? null : buildConfigBlock(keyIndent, nextConfig, eol);
  if (configIdx >= 0) {
    let end = configIdx + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() === '') {
        // A blank line belongs to the config block only when the next
        // non-blank line is still deeper; otherwise it separates rows and
        // must survive the replacement.
        let look = end + 1;
        while (look < lines.length && lines[look].trim() === '') look += 1;
        if (look >= lines.length || leadingSpaces(lines[look]) <= keyIndent) break;
        end += 1;
        continue;
      }
      if (leadingSpaces(line) > keyIndent) {
        end += 1;
        continue;
      }
      break;
    }
    if (block === null) lines.splice(configIdx, end - configIdx);
    else lines.splice(configIdx, end - configIdx, ...block.split(eol));
  } else {
    if (block === null) return text; // nothing to remove — row has no config
    lines.splice(boundary, 0, ...block.split(eol));
  }
  return lines.join(eol) + trailingEol;
}

/** Shallow equality for the flat settings objects this plugin manages. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

/** Atomically replace a file (write tmp, then rename). */
function atomicWriteFile(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

/**
 * Render a fresh default patch row for this plugin (id + name + config block)
 * in the safe YAML subset this plugin uses.
 */
function buildDefaultRow(rowName, rowId, config) {
  const id = rowId || 'deepseek-balance';
  const nameField = rowName ? `  name: '${rowName}'\n` : '';
  const lines = [`- insert:`, `  - id: ${id}`, nameField.trimEnd()];
  const sub = '    ';
  lines.push(`  config:`);
  for (const field of SETTINGS_FIELDS) lines.push(`${sub}${field}: ${formatScalar(config[field])}`);
  return lines.join('\n') + '\n';
}

/**
 * Persist `nextConfig` (or remove the row config when undefined) into the
 * profile's cordis.patch.yml. When the row does not yet exist there and
 * `allowInsert` is true, a fresh default row is appended instead. Throws when
 * the patch file cannot be parsed or written.
 * @returns `{ written, rowFound, changed, mode }` — mode is 'splice',
 *   'dump', 'insert', or 'noop'.
 */
function updatePatchRow(ctx, nextConfig, allowInsert = false) {
  const file = resolvePatchFile(ctx);
  const entry = ctx && ctx.fiber && ctx.fiber.entry ? ctx.fiber.entry.options : undefined;
  const rowName = entry && entry.name;
  const rowId = entry && entry.id;
  if (!file || (!rowName && !rowId)) return { written: false, rowFound: false };

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // Unreadable/missing patch file — the row cannot live there.
    return { written: false, rowFound: false };
  }

  let data;
  try {
    data = yaml.load(text, { schema: entryListSchema });
  } catch (err) {
    throw new Error(`cannot parse ${file}: ${err && err.message ? err.message : err}`);
  }
  if (!Array.isArray(data)) throw new Error(`${file} is not a top-level array`);

  const found = findRow(data, rowName, rowId);
  if (!found) {
    if (!allowInsert) return { written: false, rowFound: false };
    const inserted = buildDefaultRow(rowName, rowId, nextConfig == null ? DEFAULT_SETTINGS : nextConfig);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const joined = (text.endsWith(eol) ? text : text + eol) + inserted;
    atomicWriteFile(file, joined);
    return { written: true, rowFound: false, changed: true, mode: 'insert' };
  }
  if (deepEqual(found.entry.config, nextConfig == null ? undefined : nextConfig)) {
    return { written: true, rowFound: true, changed: false, mode: 'noop' };
  }

  // Apply the mutation to the parsed tree (used by the dump fallback).
  if (nextConfig == null) delete found.entry.config;
  else found.entry.config = { ...nextConfig };

  // Preferred: splice only the row's config block, preserving all other text.
  const spliced = spliceConfigBlock(text, rowName, rowId, nextConfig);
  if (spliced !== undefined) {
    try {
      const check = yaml.load(spliced, { schema: entryListSchema });
      const checkRow = Array.isArray(check) ? findRow(check, rowName, rowId) : null;
      const checkConfig = checkRow ? checkRow.entry.config : undefined;
      if (checkRow && deepEqual(checkConfig, nextConfig == null ? undefined : nextConfig)) {
        atomicWriteFile(file, spliced);
        return { written: true, rowFound: true, changed: true, mode: 'splice' };
      }
    } catch {
      // fall through to the dump fallback
    }
  }

  // Fallback: round-trip the whole patch list with the loader's own dialect.
  const dumped = yaml.dump(data, { schema: entryListSchema, lineWidth: -1, noRefs: true, sortKeys: false });
  atomicWriteFile(file, `${dumped}\n`);
  return { written: true, rowFound: true, changed: true, mode: 'dump' };
}

/** Names of provided fields whose value is invalid, for a 400 response. */
function validatePartial(partial) {
  const invalid = [];
  for (const field of SETTINGS_FIELDS) {
    if (partial[field] === undefined) continue;
    const probe = {};
    normalizeField(probe, field, partial[field]);
    if (probe[field] === undefined) invalid.push(field);
  }
  return invalid;
}

/** Read and parse a JSON request body (capped at 1 MiB). */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Read DEEPSEEK_API_KEY from the process environment. */
function resolveApiKey() {
  if (typeof process !== 'undefined' && process.env && process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY;
  }
  return undefined;
}

async function fetchBalance() {
  const key = resolveApiKey();
  if (!key) return { error: 'no-api-key' };
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'bad-json', detail: text.slice(0, 200) };
  }
  if (parsed && Array.isArray(parsed.balance_infos) && parsed.balance_infos.length > 0) {
    const balances = [];
    for (const info of parsed.balance_infos) {
      const currency = String(info.currency || '');
      const num = Number(info.total_balance);
      if (currency && Number.isFinite(num)) {
        balances.push({ currency, balance: num });
      }
    }
    if (balances.length > 0) return { balances };
  }
  if (parsed && parsed.balance !== undefined) {
    return { balances: [{ currency: String(parsed.currency || 'CNY'), balance: Number(parsed.balance) }] };
  }
  const msg = parsed && parsed.error ? (parsed.error.message || parsed.error) : 'unexpected-response';
  return { error: String(msg), detail: text.slice(0, 200) };
}

/** Write a JSON response. */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/** Cordis plugin name. */
const name = 'deepseek-balance';
/** Required services: the HTTP route registry. */
const inject = ['webServer'];

/**
 * On startup, ensure this plugin has a row in the profile's cordis.patch.yml.
 * When the row is absent, a fresh default row (id + name + default config) is
 * appended so the Settings card and every subsequent save have a stable place
 * to read from / write back to. Runs best-effort; a missing/unwritable patch
 * file is silently ignored (the plugin then runs on its built-in defaults).
 */
function ensureDefaultConfig(ctx) {
  try {
    updatePatchRow(ctx, DEFAULT_SETTINGS, true);
  } catch {
    // Ignore — fall back to built-in defaults; the row will be created on the
    // first successful save instead.
  }
}

function apply(ctx, config) {
  // Seed a default patch row at startup so config has a persistent home.
  ensureDefaultConfig(ctx);

  const routes = [
    {
      kind: 'exact',
      path: '/deepseek-balance',
      handler: async (_req, res) => {
        try {
          const data = await fetchBalance();
          sendJson(res, 200, data);
        } catch (err) {
          sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/deepseek-balance/settings',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET' || req.method === 'HEAD') {
            const effective = effectiveSettings(config);
            const hasOverrides = rowConfigSet(config);
            sendJson(res, 200, { ...effective, hasOverrides });
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method-not-allowed' });
            return;
          }
          const body = await readJsonBody(req);
          if (body.reset === true) {
            const patch = updatePatchRow(ctx, undefined, true);
            // After a patch write the fiber restarts with the bare row (no
            // config), so the response must reflect the reset state, not the
            // stale `config` of the fiber still handling this request.
            const effective = patch.written ? resolveSettings(undefined) : effectiveSettings(config);
            const hasOverrides = patch.written ? false : rowConfigSet(config);
            sendJson(res, 200, { ...effective, hasOverrides });
            return;
          }
          const invalid = validatePartial(body);
          if (invalid.length > 0) {
            sendJson(res, 400, { error: 'invalid-field', fields: invalid });
            return;
          }
          // Full next effective settings: patch base overlaid with the fields
          // the client sent (the patch row config replaces the whole config).
          const next = { ...resolveSettings(config) };
          for (const field of SETTINGS_FIELDS) {
            if (body[field] === undefined) continue;
            normalizeField(next, field, body[field]);
          }
          const patch = updatePatchRow(ctx, next, true);
          let effective;
          let hasOverrides;
          if (patch.written) {
            effective = resolveSettings(next);
            hasOverrides = true;
          } else {
            // Patch row unavailable (no writable profile patch file): keep
            // serving the built-in defaults; nothing can be persisted.
            effective = resolveSettings(config);
            hasOverrides = rowConfigSet(config);
          }
          sendJson(res, 200, { ...effective, hasOverrides });
        } catch (err) {
          sendJson(res, 400, { error: String(err && err.message ? err.message : err) });
        }
      },
    },
  ];

  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register(route), 'deepseek-balance: route');
  }
}

export { apply, inject, name };
export default { apply, inject, name };
