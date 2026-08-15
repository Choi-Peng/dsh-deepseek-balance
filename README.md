# dsh-deepseek-balance

A persistent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Cordis plugin that shows your DeepSeek account balance in the sidebar footer, right above the Settings button.

![balance-display](https://img.shields.io/badge/platform-web-blue)

## Features

- 💰 Displays your current DeepSeek account balance as `账户余额: 122.77 CNY` in the left sidebar footer, above Settings.
- 🔄 Auto-refreshes every 60 seconds.
- ⚡ Config hot reload — edit `cordis.patch.yml` or use Settings → Plugins → Balance Monitor; both apply without restarting `dsh web`.
- 📱 Hides automatically when the sidebar is collapsed (rail mode).
- 🔑 Reads the API key from `~/.api_keys` (`export DEEPSEEK_API_KEY="sk-..."`) or the `DEEPSEEK_API_KEY` environment variable.
- 🎨 Two-decimal formatting, 6px uniform padding.

## Architecture

This is a **dual-face Cordis plugin**:

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Registers `/deepseek-balance` (proxies the [DeepSeek Get User Balance API](https://api-docs.deepseek.com/api/get-user-balance)) and `/deepseek-balance/settings` (GET effective config; POST saves/resets UI overrides to `$DSH_HOME/deepseek-balance.json`) |
| Client | `lib/client.js` | Registers the balance readout in the `sidebar.footer.action` slot (60 s poll) and an editable Balance Monitor card in Settings → Plugins |

```
Browser (Client half)  --fetch /deepseek-balance-->  Host HTTP route  -->  api.deepseek.com/user/balance
```

## Installation

The plugin is a **pure Cordis plugin** (no `dsh.bundle`): `dsh plugin add`
installs the package into the profile, and a one-row `insert` in the profile's
`cordis.patch.yml` mounts it. That mount row lives in the HMR-watched layer,
so config changes, enable/disable, and adding/removing the row all apply live
— no restart.

For other people, install from the git repository (no npm publish needed):

```bash
# 1. Install the package into the web profile:
dsh plugin --profile web add git+https://github.com/Choi-Peng/dsh-deepseek-balance.git
#    or a pinned version:  .../dsh-deepseek-balance.git#v0.3.0
```

For your own checkout, `link:` references it live (no re-install after code
edits):

```bash
dsh plugin --profile web add link:./dsh-deepseek-balance
```

```yaml
# 2. Mount the plugin row in the profile's patch layer:
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: deepseek-balance
      name: '@choi-peng/dsh-deepseek-balance'
      config:
        displayCurrency: cny
        warningThresholdCny: 0
        warningThresholdUsd: 0
```

`dsh plugin add` runs `pnpm add`; since the package declares no `dsh.bundle`,
it is installed as a plain dependency (the CLI prints a notice to that effect)
and the row above is what mounts it. Saving `cordis.patch.yml` is picked up by
config HMR immediately — the row mounts and the balance appears without a
restart.

Remove with:

```bash
# drop the row from cordis.patch.yml (applies live), then:
dsh plugin --profile web remove @choi-peng/dsh-deepseek-balance
```

## Configuration

The plugin settings are layered, and **both layers apply live, without
restarting `dsh web`**:

| Layer | Source | How it applies |
| --- | --- | --- |
| Base | the `deepseek-balance` row `config` in the profile's `cordis.patch.yml` | `dsh web` watches the patch layer (HMR); saving the file restarts this fiber with the new config |
| Overrides | `$DSH_HOME/deepseek-balance.json` — written by **Settings → Plugins → Balance Monitor** | The host re-reads the file on every `/deepseek-balance/settings` request, so edits apply immediately; overrides win per field |

Effective settings = patch base overlaid with UI overrides. The card exposes
`displayCurrency` (select) and both warning thresholds (number inputs) with
Save / Reset-to-defaults; after saving, the sidebar readout refreshes
immediately (it also re-polls every 60 s).

The API key is resolved in this order:

1. `DEEPSEEK_API_KEY` environment variable
2. `~/.api_keys` file — the line `export DEEPSEEK_API_KEY="sk-..."`

The balance API returns both CNY and USD balances when present; the plugin prefers CNY and falls back to USD.

### Hot reload chain

1. `dsh web` boots with `@deepseek-ai/cordis-plugin-hmr` and watches the
   profile's patch layer (`dsh-app-boot` → `watchUserPatches`).
2. On save, HMR re-parses the patch file and transactionally re-applies it to
   the loader entry tree (`cordis-plugin-include` → `entry.update()`).
3. The loader diffs the `deepseek-balance` row: a `config` change restarts just
   that fiber with the new config (`fiber.update()` → Cordis `restart()`).
4. The host half re-registers its routes (`/deepseek-balance`,
   `/deepseek-balance/settings`) through `ctx.effect` disposers, so the new
   settings are served immediately.
5. The sidebar readout re-polls `/deepseek-balance/settings` every 60 s and the
   Settings → Plugins card every 30 s — new values appear within a minute.

The API key is *not* part of the hot-reload config: it is re-resolved from
`~/.api_keys` / the environment on every balance fetch, so editing
`~/.api_keys` also takes effect without a restart.

If the edited YAML is invalid, HMR logs an `hmr/config-update-failed`
diagnostic and the last good tree stays active.

## Development

```bash
# Validate the host half imports cleanly:
node --input-type=module -e "import('@choi-peng/dsh-deepseek-balance').then(m => console.log(m.name, m.inject))"

# Syntax-check the client bundle:
node -e "new Function(require('fs').readFileSync('lib/client.js', 'utf8'))"
```

## License

MIT
