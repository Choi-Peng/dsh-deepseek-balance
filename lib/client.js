// DeepSeek Balance — Client half
// Displays the DeepSeek account balance in the sidebar footer above Settings.
window.__ModuleLoader__.load({
  id: '@dsh-local/deepseek-balance',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var react = require('react');

    /** Required client services. */
    var inject = ['slots'];

    function apply(ctx) {
      var slots = ctx.slots;

      function BalanceDisplay() {
        var balanceState = react.useState(null);
        var balance = balanceState[0];
        var setBalance = balanceState[1];
        var currencyState = react.useState('CNY');
        var currency = currencyState[0];
        var setCurrency = currencyState[1];
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
              var res = await fetch('/deepseek-balance', { cache: 'no-store' });
              var result = await res.json();
              if (cancelled) return;
              if (result && result.error) {
                setError(String(result.error) + (result.detail ? ': ' + String(result.detail) : ''));
                setBalance(null);
              } else if (result && result.balance !== undefined) {
                setBalance(result.balance);
                if (result.currency) setCurrency(String(result.currency));
                setError(null);
              }
            } catch (err) {
              if (cancelled) return;
              setError(String(err && err.message ? err.message : err));
              setBalance(null);
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

        if (loading) {
          return react.createElement('div', { style: { padding: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', display: 'flex', alignItems: 'center', gap: '6px' } }, '...');
        }
        if (error) {
          var errMsg = error.length > 60 ? error.slice(0, 60) + '...' : error;
          return react.createElement('div', { title: error, style: { padding: '6px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #e53e3e)', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 } }, '\u26A0\uFE0F ' + errMsg);
        }
        var displayBalance = typeof balance === 'number' ? balance.toFixed(2) : String(Number(balance).toFixed(2));
        return react.createElement('div', { style: { padding: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)', display: 'flex', alignItems: 'center', gap: '6px' } },
          '账户余额: ',
          react.createElement('span', { style: { fontWeight: 500 } }, displayBalance),
          ' ' + currency
        );
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
