// AI 生成声明:本插件代码由 AI 生成,可能存在错误或安全隐患,使用前请 review 并实测。
// DeepSeek Balance — Host half
// Registers HTTP routes that proxy the DeepSeek balance API and expose the
// plugin configuration (currency display + per-currency warning thresholds).
//
// Configuration is layered, and both layers apply live while dsh web runs:
//   1. Base: the profile's cordis.patch.yml under the plugin row `config`.
//      dsh watches the patch layer (watchUserPatches + cordis-plugin-hmr) and
//      restarts this fiber with the new config — no restart of dsh web.
//   2. Overrides: UI edits from Settings → Plugins are persisted to
//      $DSH_HOME/deepseek-balance.json and win per field. They are re-read on
//      every /deepseek-balance/settings request, so they apply immediately.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Defaults: no warning threshold (0 = disabled). */
export const DEFAULT_SETTINGS = {
  displayCurrency: 'cny', // cny | usd | both
  warningThresholdCny: 0,
  warningThresholdUsd: 0,
};

const SETTINGS_FIELDS = ['displayCurrency', 'warningThresholdCny', 'warningThresholdUsd'];

/** Resolve $DSH_HOME (default ~/.dsh), mirroring @deepseek-ai/dsh-home-paths. */
function resolveDshHome() {
  const env = process.env && process.env.DSH_HOME;
  let home = env && env.trim().length > 0 ? env : join(homedir(), '.dsh');
  if (home === '~') return homedir();
  if (home.startsWith('~/') || home.startsWith('~\\')) home = join(homedir(), home.slice(2));
  return home;
}

/** Overrides file written by Settings → Plugins UI edits. */
const SETTINGS_FILE = join(resolveDshHome(), 'deepseek-balance.json');

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

/** Read the UI overrides file; a missing/unreadable/invalid file means none. */
function readOverrides() {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const field of SETTINGS_FIELDS) normalizeField(out, field, parsed[field]);
    return out;
  } catch {
    return {};
  }
}

/** Effective settings = patch base overlaid with UI overrides (per field). */
function effectiveSettings(config) {
  return { ...resolveSettings(config), ...readOverrides() };
}

/** Atomically persist the overrides file. */
function writeOverrides(overrides) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  const tmp = SETTINGS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
  renameSync(tmp, SETTINGS_FILE);
}

/** Merge a validated partial update into the overrides and persist. */
function saveOverrides(partial) {
  const next = { ...readOverrides() };
  let changed = false;
  for (const field of SETTINGS_FIELDS) {
    if (partial[field] === undefined) continue;
    const candidate = { ...next };
    normalizeField(candidate, field, partial[field]);
    if (candidate[field] !== next[field]) {
      next[field] = candidate[field];
      changed = true;
    }
  }
  if (changed) writeOverrides(next);
  return next;
}

/** Clear UI overrides (back to the patch-layer defaults). */
function clearOverrides() {
  writeOverrides({});
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

/** Read DEEPSEEK_API_KEY from ~/.api_keys (source'd by .zshrc) or process env. */
function resolveApiKey() {
  if (typeof process !== 'undefined' && process.env && process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY;
  }
  try {
    const file = join(homedir(), '.api_keys');
    const text = readFileSync(file, 'utf8');
    const match = text.match(/^export\s+DEEPSEEK_API_KEY="([^"]*)"/m);
    if (match) return match[1];
    const match2 = text.match(/^export\s+DEEPSEEK_API_KEY='([^']*)'/m);
    if (match2) return match2[1];
  } catch {
    // fall through
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

function apply(ctx, config) {
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
            sendJson(res, 200, { ...effective, hasOverrides: Object.keys(readOverrides()).length > 0 });
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method-not-allowed' });
            return;
          }
          const body = await readJsonBody(req);
          if (body.reset === true) {
            clearOverrides();
            const effective = effectiveSettings(config);
            sendJson(res, 200, { ...effective, hasOverrides: false });
            return;
          }
          const invalid = validatePartial(body);
          if (invalid.length > 0) {
            sendJson(res, 400, { error: 'invalid-field', fields: invalid });
            return;
          }
          const overrides = saveOverrides(body);
          const effective = { ...resolveSettings(config), ...overrides };
          sendJson(res, 200, { ...effective, hasOverrides: Object.keys(overrides).length > 0 });
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
