// DeepSeek Balance — Host half
// Registers an HTTP route /deepseek-balance that proxies the DeepSeek balance API.
// Returns all currency balances from the account.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

function apply(ctx) {
  const route = {
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
  };
  ctx.effect(() => ctx.webServer.register(route), 'deepseek-balance: route');
}

export { apply, inject, name };
export default { apply, inject, name };
