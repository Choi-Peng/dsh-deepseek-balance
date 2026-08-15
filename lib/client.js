// DeepSeek Balance — Client half
// Displays the DeepSeek account balance in the sidebar footer above Settings,
// colored by per-currency warning thresholds (0 = disabled), plus a
// "Balance Monitor" card in Settings → Plugins that picks which currency to
// show and edits thresholds. Settings are persisted by the host half to
// $DSH_HOME/deepseek-balance.json via /deepseek-balance/settings.
window.__ModuleLoader__.load({
  id: '@dsh-local/deepseek-balance',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');

    var DISPLAY_FIELD = 'displayCurrency';
    var THRESHOLD_CNY_FIELD = 'warningThresholdCny';
    var THRESHOLD_USD_FIELD = 'warningThresholdUsd';
    var DEFAULT_THRESHOLD = 0;
    var DEFAULT_DISPLAY = 'cny';

    /** Required client services. */
    var inject = ['slots', 'locale'];

    var en = {
      cardTitle: 'Balance Monitor',
      cardDescription: 'Watches your DeepSeek account balance and colors the sidebar readout.',
      displayLabel: 'Show currency',
      displayHint: 'Which balance(s) the sidebar shows.',
      displayCny: 'CNY only',
      displayUsd: 'USD only',
      displayBoth: 'CNY and USD',
      thresholdCnyLabel: 'CNY warning threshold',
      thresholdUsdLabel: 'USD warning threshold',
      thresholdHint: 'Below this the balance turns red; below twice this it turns yellow. 0 disables the warning.',
      configSource: 'Configuration is read from the profile cordis.patch.yml (the deepseek-balance row). Edit it and restart dsh web to apply.',
    };
    var zh = {
      cardTitle: '余额监控',
      cardDescription: '监控你的 DeepSeek 账户余额,并为侧边栏读数着色。',
      displayLabel: '显示货币',
      displayHint: '侧边栏显示哪种(些)余额。',
      displayCny: '仅 CNY',
      displayUsd: '仅 USD',
      displayBoth: 'CNY 和 USD',
      thresholdCnyLabel: 'CNY 预警阈值',
      thresholdUsdLabel: 'USD 预警阈值',
      thresholdHint: '余额低于该值显示红色;低于其两倍显示黄色。0 表示不预警。',
      configSource: '配置读取自 profile 的 cordis.patch.yml(deepseek-balance 行)。修改后重启 dsh web 生效。',
    };

    function apply(ctx) {
      var slots = ctx.slots;

      // ── locale ──────────────────────────────────────────────────────────────
      ctx.effect(function () {
        return ctx.locale.register('deepseek-balance', { en: en, zh: zh });
      }, 'deepseek-balance: dictionaries');

      // ── sidebar balance readout ─────────────────────────────────────────────
      function BalanceDisplay() {
        var settingsState = react.useState({});
        var settings = settingsState[0];
        var setSettings = settingsState[1];
        var balancesState = react.useState([]);
        var balances = balancesState[0];
        var setBalances = balancesState[1];
        var loadingState = react.useState(true);
        var loading = loadingState[0];
        var setLoading = loadingState[1];
        var errorState = react.useState(null);
        var error = errorState[0];
        var setError = errorState[1];

        // Load settings + balances on mount and refresh every 60 seconds.
        react.useEffect(function () {
          var cancelled = false;
          var intervalId = null;

          async function doFetch() {
            try {
              var [settingsRes, balanceRes] = await Promise.all([
                fetch('/deepseek-balance/settings', { cache: 'no-store' }),
                fetch('/deepseek-balance', { cache: 'no-store' }),
              ]);
              var settingsData = await settingsRes.json();
              var balanceData = await balanceRes.json();
              if (cancelled) return;
              if (settingsData && typeof settingsData === 'object') setSettings(settingsData);
              if (balanceData && balanceData.error) {
                setError(String(balanceData.error) + (balanceData.detail ? ': ' + String(balanceData.detail) : ''));
                setBalances([]);
              } else if (balanceData && Array.isArray(balanceData.balances)) {
                setBalances(balanceData.balances);
                setError(null);
              }
            } catch (err) {
              if (cancelled) return;
              setError(String(err && err.message ? err.message : err));
              setBalances([]);
            } finally {
              if (!cancelled) setLoading(false);
            }
          }

          doFetch();
          intervalId = window.setInterval(doFetch, 60000);
          return function () {
            cancelled = true;
            if (intervalId !== null) window.clearInterval(intervalId);
          };
        }, []);

        var baseStyle = { padding: '6px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' };
        if (loading) {
          return react.createElement('div', Object.assign({}, baseStyle, { color: 'var(--dsw-alias-label-tertiary, #888)' }), '...');
        }
        if (error) {
          var errMsg = error.length > 60 ? error.slice(0, 60) + '...' : error;
          return react.createElement('div', { title: error, style: Object.assign({}, baseStyle, { color: 'var(--dsw-alias-state-error-primary, #e53e3e)', opacity: 0.8 }) }, '\u26A0\uFE0F ' + errMsg);
        }

        var display = settings[DISPLAY_FIELD] || DEFAULT_DISPLAY;
        var thresholdCny = typeof settings[THRESHOLD_CNY_FIELD] === 'number' ? settings[THRESHOLD_CNY_FIELD] : DEFAULT_THRESHOLD;
        var thresholdUsd = typeof settings[THRESHOLD_USD_FIELD] === 'number' ? settings[THRESHOLD_USD_FIELD] : DEFAULT_THRESHOLD;

        // Pick the balances to show per display setting.
        var shown = balances.filter(function (b) {
          var cur = (b.currency || '').toUpperCase();
          if (display === 'cny') return cur === 'CNY';
          if (display === 'usd') return cur === 'USD';
          return true;
        });

        if (shown.length === 0) {
          return react.createElement('div', Object.assign({}, baseStyle, { color: 'var(--dsw-alias-label-tertiary, #888)' }), '账户余额: --');
        }

        // Build one colored span per shown balance. Threshold 0 disables the
        // warning; each currency is colored by its own threshold.
        var segments = [];
        for (var i = 0; i < shown.length; i++) {
          var item = shown[i];
          var cur = (item.currency || '').toUpperCase();
          var threshold = cur === 'USD' ? thresholdUsd : thresholdCny;
          var num = typeof item.balance === 'number' ? item.balance : Number(item.balance);
          var color = 'var(--dsw-alias-label-secondary, #888)';
          if (typeof num === 'number' && typeof threshold === 'number' && threshold > 0) {
            if (num <= threshold) color = 'var(--dsw-alias-state-error-primary, #e53e3e)'; // red
            else if (num <= threshold * 2) color = 'var(--dsw-alias-state-warning-primary, #d99a1f)'; // yellow
          }
          segments.push(
            react.createElement('span', { key: i, style: { color: color, fontWeight: 500 } }, num.toFixed(2) + ' ' + cur)
          );
        }

        // Separators between segments stay in the default secondary color.
        var children = [react.createElement('span', { key: 'prefix', style: { color: 'var(--dsw-alias-label-secondary, #888)' } }, '账户余额: ')];
        for (var j = 0; j < segments.length; j++) {
          if (j > 0) children.push(react.createElement('span', { key: 'sep' + j, style: { color: 'var(--dsw-alias-label-secondary, #888)' } }, ' / '));
          children.push(segments[j]);
        }

        return react.createElement('div', Object.assign({}, baseStyle), children);
      }

      // ── Settings → Plugins card (read-only view of the patch config) ───────
      function BalanceMonitorCard(props) {
        var t = props.t;
        var settingsState = react.useState({});
        var settings = settingsState[0];
        var openState = react.useState(false);
        var open = openState[0];

        // Load the current config (served by the host from cordis.patch.yml).
        react.useEffect(function () {
          var cancelled = false;
          fetch('/deepseek-balance/settings', { cache: 'no-store' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
              if (!cancelled && data && typeof data === 'object') settingsState[1](data);
            })
            .catch(function () { /* keep defaults */ });
          return function () { cancelled = true; };
        }, []);

        var currentDisplay = settings[DISPLAY_FIELD] || DEFAULT_DISPLAY;
        var currentCny = typeof settings[THRESHOLD_CNY_FIELD] === 'number' ? settings[THRESHOLD_CNY_FIELD] : DEFAULT_THRESHOLD;
        var currentUsd = typeof settings[THRESHOLD_USD_FIELD] === 'number' ? settings[THRESHOLD_USD_FIELD] : DEFAULT_THRESHOLD;

        var displayText = currentDisplay === 'both' ? t('displayBoth') : (currentDisplay === 'usd' ? t('displayUsd') : t('displayCny'));

        var cardStyle = { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: '12px', listStyle: 'none' };
        var headerStyle = { appearance: 'none', width: '100%', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', background: '0 0', border: '0', borderRadius: '12px', alignItems: 'center', gap: '12px', padding: '14px 16px', display: 'flex' };
        var bodyStyle = { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', padding: '12px 0 8px' };
        var fieldStyle = { flexDirection: 'column', gap: '4px', padding: '8px 0', display: 'flex' };
        var rowStyle = { alignItems: 'center', gap: '8px', display: 'flex' };
        var labelStyle = { minWidth: '0', color: 'var(--dsw-alias-label-primary)', flex: '1', fontSize: '13px', fontWeight: '500', lineHeight: '1.5' };
        var valueStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '1.5' };
        var hintStyle = { color: 'var(--dsw-alias-label-tertiary)', margin: '0', fontSize: '12px', lineHeight: '1.5' };

        return react.createElement('li', { style: cardStyle },
          react.createElement('button', { style: headerStyle, onClick: function () { openState[1](!open); }, 'aria-expanded': open },
            react.createElement('span', { style: { flexDirection: 'column', flex: '1', gap: '4px', minWidth: '0', display: 'flex' } },
              react.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: '15px', fontWeight: '600', lineHeight: '1.4' } }, t('cardTitle')),
              react.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', lineHeight: '1.5' } }, t('cardDescription'))
            ),
            react.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', flex: 'none' } }, open ? '\u25B2' : '\u25BC')
          ),
          open ? react.createElement('div', { style: bodyStyle },
            react.createElement('div', { style: fieldStyle },
              react.createElement('div', { style: rowStyle },
                react.createElement('span', { style: labelStyle }, t('displayLabel')),
                react.createElement('span', { style: valueStyle }, displayText)
              )
            ),
            react.createElement('div', { style: fieldStyle },
              react.createElement('div', { style: rowStyle },
                react.createElement('span', { style: labelStyle }, t('thresholdCnyLabel')),
                react.createElement('span', { style: valueStyle }, String(currentCny))
              )
            ),
            react.createElement('div', { style: fieldStyle },
              react.createElement('div', { style: rowStyle },
                react.createElement('span', { style: labelStyle }, t('thresholdUsdLabel')),
                react.createElement('span', { style: valueStyle }, String(currentUsd))
              )
            ),
            react.createElement('p', { style: hintStyle }, t('configSource'))
          ) : null
        );
      }

      // ── slot registrations ──────────────────────────────────────────────────

      // Sidebar footer readout, hidden when the sidebar is collapsed (rail mode).
      slots.inject('sidebar.footer.action', function () {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'deepseek-balance', order: -1 },
          function (props) {
            if (props && props.wide === false) return null;
            return react.createElement(BalanceDisplay, null);
          }
        );
      });

      // Settings → Plugins → configurable tab card.
      slots.inject('settings.plugin.item', function () {
        return slots.register(
          {
            name: 'settings.plugin.item',
            id: 'deepseek-balance',
            order: 30,
            locale: 'deepseek-balance',
          },
          function (props) {
            var t = ctx.locale.bind('deepseek-balance');
            return react.createElement(BalanceMonitorCard, { t: t });
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
