// AI 生成声明:本插件代码由 AI 生成,可能存在错误或安全隐患,使用前请 review 并实测。
// DeepSeek Balance — Host half
// Registers HTTP routes that proxy the DeepSeek balance API and expose the
// plugin settings (currency display + per-currency warning thresholds).
//
// Settings follow the official dsh two-seam configuration model:
//   1. Base layer: this plugin's row `config` in the profile's
//      cordis.patch.yml — the deployer's static configuration. It arrives as
//      the loader-provided `config` and is registered as the composition
//      `base` of the `deepseek-balance` settings namespace.
//   2. User layer: runtime edits from Settings → Plugins go through
//      `ctx.settings` (@deepseek-ai/dsh-settings); the provider (e.g.
//      dsh-settings-file) persists them to $DSH_HOME/settings.yaml with
//      hot publication, optimistic-concurrency revisions, and a serialized
//      write queue. The patch file is never written by this plugin.
// The browser cannot reach `ctx.settings` directly, so
// /deepseek-balance/settings remains as a thin proxy over the official seam.
// On hosts without a settings service the plugin runs on the base layer
// (`config`) and the settings route answers 503.
import z from '@deepseek-ai/schemastery';
import { settingsNamespace, SettingsConflictError } from '@deepseek-ai/dsh-settings';

/** Settings namespace served through `ctx.settings`. */
const NS = settingsNamespace('deepseek-balance');

/** Schema resolving the namespace; also defines the defaults. */
const SCHEMA = z.object({
  displayCurrency: z.union(['cny', 'usd', 'both']).default('cny'),
  warningThresholdCny: z.number().min(0).default(0),
  warningThresholdUsd: z.number().min(0).default(0),
});

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

/** Whether an error is the settings seam's optimistic-concurrency conflict. */
function isSettingsConflict(err) {
  return err instanceof SettingsConflictError || (err && err.code === 'SETTINGS_CONFLICT');
}

/** This namespace's descriptor from the settings service (redacted view). */
function describeOwn(settings) {
  const list = settings.describe({ redactSecrets: true });
  return list.find((descriptor) => descriptor.ns === NS);
}

/** Shape one namespace descriptor into the wire response for the client. */
function describeResponse(descriptor) {
  return {
    ...descriptor.value,
    revision: descriptor.revision,
    hasOverrides: !!(descriptor.user && Object.keys(descriptor.user).length > 0),
  };
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
        req.once('error', () => {});
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
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  // Only reflect the request origin when it is a local web-server origin,
  // avoiding a wildcard cross-origin policy for an authenticated endpoint.
  const req = res.req;
  const origin = req && req.headers && req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body);
}

/** Cordis plugin name. */
const name = 'deepseek-balance';
/** Required services: the HTTP route registry. */
const inject = ['webServer'];

function apply(ctx, config) {
  // Register the settings namespace on the official seam: the loader-provided
  // `config` (this plugin's cordis.patch.yml row) becomes the composition
  // `base` layer; user edits persist through the provider into settings.yaml.
  // The service reference is held at apply scope so the thin-proxy handlers
  // below can reach it. The registration rides this fiber (via the scoped
  // inject context), so a config-HMR restart re-registers cleanly. When the
  // settings service is absent, the inject callback simply never runs: the
  // plugin keeps working on the base layer and the settings route answers
  // 503.
  let settingsService;
  ctx.inject(['settings'], (sctx) => {
    settingsService = sctx.settings;
    settingsService.register(NS, SCHEMA, { base: resolveSettings(config) });
  });

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
          if (!settingsService) {
            sendJson(res, 503, { error: 'settings-unavailable' });
            return;
          }
          if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, describeResponse(describeOwn(settingsService)));
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method-not-allowed' });
            return;
          }
          const body = await readJsonBody(req);
          const expectedRevision = typeof body.revision === 'number' ? body.revision : undefined;
          try {
            if (body.reset === true) {
              // Reset: clear the user layer so the value falls back to base.
              await settingsService.replace(NS, {}, expectedRevision);
            } else {
              const invalid = validatePartial(body);
              if (invalid.length > 0) {
                sendJson(res, 400, { error: 'invalid-field', fields: invalid });
                return;
              }
              // Save: merge only the provided fields into the user layer.
              const patch = {};
              for (const field of SETTINGS_FIELDS) {
                if (body[field] !== undefined) normalizeField(patch, field, body[field]);
              }
              await settingsService.update(NS, patch, expectedRevision);
            }
          } catch (err) {
            if (isSettingsConflict(err)) {
              sendJson(res, 409, { error: 'settings-conflict', revision: err.actual });
              return;
            }
            throw err;
          }
          sendJson(res, 200, describeResponse(describeOwn(settingsService)));
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
