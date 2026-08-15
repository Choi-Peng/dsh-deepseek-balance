// DeepSeek Balance — Client half
// Displays all DeepSeek account balances in the sidebar footer above Settings,
// colored per currency by its warning threshold (0 disables the warning).
window.__ModuleLoader__.load({
  id: '@dsh-local/deepseek-balance',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');

    var THRESHOLD_CNY_FIELD = 'warningThresholdCny';
    var THRESHOLD_USD_FIELD = 'warningThresholdUsd';
    var DEFAULT_THRESHOLD = 0;

    /** Required client services. */
    var inject = ['slots'];

    function apply(ctx) {
      var slots = ctx.slots;

      function BalanceDisplay() {
        var settingsState = react.useState({});
        var settings = settingsState[0];
        var balancesState = react.useState([]);
        var balances = balancesState[0];
        var setBalances = balancesState[1];
        var loadingState = react.useState(true);
        var loading = loadingState[0];
        var setLoading = loadingState[1];
        var errorState = react.useState(null);
        var error = errorState[0];
        var setError = errorState[1];

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
        if (balances.length === 0) {
          return react.createElement('div', Object.assign({}, baseStyle, { color: 'var(--dsw-alias-label-tertiary, #888)' }), '账户余额: --');
        }

        var thresholdCny = typeof settings[THRESHOLD_CNY_FIELD] === 'number' ? settings[THRESHOLD_CNY_FIELD] : DEFAULT_THRESHOLD;
        var thresholdUsd = typeof settings[THRESHOLD_USD_FIELD] === 'number' ? settings[THRESHOLD_USD_FIELD] : DEFAULT_THRESHOLD;

        // Build one colored span per balance; each currency uses its own threshold.
        var segments = balances.map(function (item, i) {
          var cur = (item.currency || '').toUpperCase();
          var threshold = cur === 'USD' ? thresholdUsd : thresholdCny;
          var num = typeof item.balance === 'number' ? item.balance : Number(item.balance);
          var color = 'var(--dsw-alias-label-secondary, #888)';
          if (typeof num === 'number' && typeof threshold === 'number' && threshold > 0) {
            if (num <= threshold) color = 'var(--dsw-alias-state-error-primary, #e53e3e)'; // red
            else if (num <= threshold * 2) color = 'var(--dsw-alias-state-warning-primary, #d99a1f)'; // yellow
          }
          return react.createElement('span', { key: i, style: { color: color, fontWeight: 500 } }, num.toFixed(2) + ' ' + cur);
        });

        // The '账户余额: ' prefix and ' / ' separators keep the default color.
        var children = [react.createElement('span', { key: 'prefix', style: { color: 'var(--dsw-alias-label-secondary, #888)' } }, '账户余额: ')];
        for (var j = 0; j < segments.length; j++) {
          if (j > 0) children.push(react.createElement('span', { key: 'sep' + j, style: { color: 'var(--dsw-alias-label-secondary, #888)' } }, ' / '));
          children.push(segments[j]);
        }

        return react.createElement('div', Object.assign({}, baseStyle), children);
      }

      slots.inject('sidebar.footer.action', function () {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'deepseek-balance', order: -1 },
          function (props) {
            if (props && props.wide === false) return null;
            return react.createElement(BalanceDisplay, null);
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
