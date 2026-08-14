# dsh-deepseek-balance

A persistent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle plugin that shows your DeepSeek account balance in the sidebar footer, right above the Settings button.

![balance-display](https://img.shields.io/badge/platform-web-blue)

## Features

- 💰 Displays your current DeepSeek account balance as `账户余额: 122.77 CNY` in the left sidebar footer, above Settings.
- 🔄 Auto-refreshes every 60 seconds.
- 📱 Hides automatically when the sidebar is collapsed (rail mode).
- 🔑 Reads the API key from `~/.api_keys` (`export DEEPSEEK_API_KEY="sk-..."`) or the `DEEPSEEK_API_KEY` environment variable.
- 🎨 Two-decimal formatting, 6px uniform padding.

## Architecture

This is a **dual-face bundle plugin**:

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Registers an HTTP route `/deepseek-balance` that proxies the [DeepSeek Get User Balance API](https://api-docs.deepseek.com/api/get-user-balance) |
| Client | `lib/client.js` | Registers a view in the `sidebar.footer.action` slot that fetches the route and renders the balance |

```
Browser (Client half)  --fetch /deepseek-balance-->  Host HTTP route  -->  api.deepseek.com/user/balance
```

## Installation

Install the plugin as a local workspace package in your dsh web profile:

```bash
# 1. Copy the plugin into your profile (example path):
cp -R dsh-deepseek-balance ~/.dsh/profiles/web/.plugins/deepseek-balance

# 2. Add it to the pnpm workspace and profile manifest:
#    pnpm-workspace.yaml  →  packages: [".", ".plugins/deepseek-balance"]
#    package.json         →  dependencies: { "@dsh-local/deepseek-balance": "workspace:*" }

# 3. Link it:
cd ~/.dsh/profiles/web && CI=true pnpm install

# 4. Register the plugin row in cordis.patch.yml:
```

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: deepseek-balance
      name: '@dsh-local/deepseek-balance'
```

Restart `dsh web` and the balance appears in the sidebar footer.

## Configuration

The API key is resolved in this order:

1. `DEEPSEEK_API_KEY` environment variable
2. `~/.api_keys` file — the line `export DEEPSEEK_API_KEY="sk-..."`

The balance API returns both CNY and USD balances when present; the plugin prefers CNY and falls back to USD.

## Development

```bash
# Validate the host half imports cleanly:
node --input-type=module -e "import('@dsh-local/deepseek-balance').then(m => console.log(m.name, m.inject))"

# Syntax-check the client bundle:
node -e "new Function(require('fs').readFileSync('lib/client.js', 'utf8'))"
```

## License

MIT
