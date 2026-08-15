// DeepSeek Balance — Client half
// Displays the DeepSeek account balance in the sidebar footer above Settings,
// colored by per-currency warning thresholds (0 = disabled), plus an editable
// "Balance Monitor" card in Settings → Plugins. Effective settings come from
// /deepseek-balance/settings (cordis.patch.yml base + $DSH_HOME overrides
// persisted by the host through POST); the readout re-polls every 60 s and
// listens for the 'deepseek-balance:settings-changed' event after a save.
window.__ModuleLoader__.load({
  id: '@choi-peng/dsh-deepseek-balance',
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
      saveLabel: 'Save',
      resetLabel: 'Reset to defaults',
      savingStatus: 'Saving…',
      savedStatus: 'Saved — applies immediately.',
      invalidFields: 'Invalid value(s) for:',
      configSource: 'Defaults come from the profile cordis.patch.yml (the deepseek-balance row); edits here are saved to $DSH_HOME/deepseek-balance.json and apply immediately, no restart needed.',
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
      saveLabel: '保存',
      resetLabel: '恢复默认',
      savingStatus: '保存中…',
      savedStatus: '已保存,立即生效。',
      invalidFields: '以下字段的值不合法:',
      configSource: '默认值来自 profile 的 cordis.patch.yml(deepseek-balance 行);在此修改会保存到 $DSH_HOME/deepseek-balance.json 并立即生效,无需重启。',
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
        // Latest good balances, readable from the fetch closure without
        // re-running the effect (kept across transient fetch failures).
        var latestBalancesRef = react.useRef([]);
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
                latestBalancesRef.current = balanceData.balances;
                setBalances(balanceData.balances);
                setError(null);
              }
            } catch (err) {
              if (cancelled) return;
              // Transient fetch failure (e.g. the host briefly unregisters the
              // route while hot-reloading this plugin's config): keep showing
              // the last good readout instead of an error flash.
              if (latestBalancesRef.current.length === 0) {
                setError(String(err && err.message ? err.message : err));
              }
            } finally {
              if (!cancelled) setLoading(false);
            }
          }

          doFetch();
          intervalId = window.setInterval(doFetch, 60000);
          // The Settings → Plugins card dispatches this after a save/reset so
          // the sidebar readout updates immediately instead of waiting for the
          // next poll.
          var onSettingsChanged = function () { doFetch(); };
          window.addEventListener('deepseek-balance:settings-changed', onSettingsChanged);
          return function () {
            cancelled = true;
            if (intervalId !== null) window.clearInterval(intervalId);
            window.removeEventListener('deepseek-balance:settings-changed', onSettingsChanged);
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

      // ── Settings → Plugins card (editable view of the plugin config) ───────
      function BalanceMonitorCard(props) {
        var t = props.t;
        var fieldsState = react.useState({ displayCurrency: 'cny', warningThresholdCny: '0', warningThresholdUsd: '0' });
        var fields = fieldsState[0];
        var setFields = fieldsState[1];
        var metaState = react.useState({ hasOverrides: false });
        var meta = metaState[0];
        var setMeta = metaState[1];
        var dirtyRef = react.useRef(false);
        var openState = react.useState(false);
        var open = openState[0];
        var saveState = react.useState({ status: 'idle', message: '' });
        var save = saveState[0];
        var setSave = saveState[1];

        // Load the effective config (host: patch base + persisted overrides)
        // and re-poll so an open card reflects external edits while dsh web
        // runs. In-progress edits are not clobbered by the poll.
        react.useEffect(function () {
          var cancelled = false;
          function doFetch() {
            fetch('/deepseek-balance/settings', { cache: 'no-store' })
              .then(function (res) { return res.json(); })
              .then(function (data) {
                if (cancelled || !data || typeof data !== 'object') return;
                setMeta({ hasOverrides: !!data.hasOverrides });
                if (!dirtyRef.current) {
                  setFields({
                    displayCurrency: data.displayCurrency || 'cny',
                    warningThresholdCny: String(typeof data.warningThresholdCny === 'number' ? data.warningThresholdCny : 0),
                    warningThresholdUsd: String(typeof data.warningThresholdUsd === 'number' ? data.warningThresholdUsd : 0),
                  });
                }
              })
              .catch(function () { /* keep last known values */ });
          }
          doFetch();
          var intervalId = window.setInterval(doFetch, 30000);
          return function () {
            cancelled = true;
            window.clearInterval(intervalId);
          };
        }, []);

        function setField(field, value) {
          dirtyRef.current = true;
          setSave({ status: 'idle', message: '' });
          setFields(function (prev) {
            var next = {};
            for (var key in prev) next[key] = prev[key];
            next[field] = value;
            return next;
          });
        }

        // Reflect a save/reset response and nudge the sidebar readout to
        // refetch immediately (it also polls every 60 s).
        function applyResponse(data) {
          dirtyRef.current = false;
          setMeta({ hasOverrides: !!data.hasOverrides });
          setFields({
            displayCurrency: data.displayCurrency || 'cny',
            warningThresholdCny: String(typeof data.warningThresholdCny === 'number' ? data.warningThresholdCny : 0),
            warningThresholdUsd: String(typeof data.warningThresholdUsd === 'number' ? data.warningThresholdUsd : 0),
          });
          window.dispatchEvent(new window.Event('deepseek-balance:settings-changed'));
        }

        function saveErrorMessage(data) {
          if (!data || typeof data !== 'object') return 'save failed';
          if (data.error === 'invalid-field') {
            return t('invalidFields') + ' ' + (Array.isArray(data.fields) ? data.fields.join(', ') : '');
          }
          return String(data.error);
        }

        function onSave() {
          setSave({ status: 'saving', message: '' });
          fetch('/deepseek-balance/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayCurrency: fields.displayCurrency,
              warningThresholdCny: Number(fields.warningThresholdCny),
              warningThresholdUsd: Number(fields.warningThresholdUsd),
            }),
          })
            .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
            .then(function (result) {
              if (!result.ok || (result.data && result.data.error)) {
                setSave({ status: 'error', message: saveErrorMessage(result.data) });
                return;
              }
              applyResponse(result.data);
              setSave({ status: 'saved', message: '' });
            })
            .catch(function () {
              setSave({ status: 'error', message: 'network error' });
            });
        }

        function onReset() {
          setSave({ status: 'saving', message: '' });
          fetch('/deepseek-balance/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reset: true }),
          })
            .then(function (res) { return res.json(); })
            .then(function (data) {
              if (data && data.error) {
                setSave({ status: 'error', message: saveErrorMessage(data) });
                return;
              }
              applyResponse(data);
              setSave({ status: 'saved', message: '' });
            })
            .catch(function () {
              setSave({ status: 'error', message: 'network error' });
            });
        }

        var cardStyle = { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', borderRadius: '12px', listStyle: 'none' };
        var headerStyle = { appearance: 'none', width: '100%', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', background: '0 0', border: '0', borderRadius: '12px', alignItems: 'center', gap: '12px', padding: '14px 16px', display: 'flex' };
        var bodyStyle = { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', padding: '12px 0 8px' };
        var fieldStyle = { flexDirection: 'column', gap: '4px', padding: '8px 0', display: 'flex' };
        var rowStyle = { alignItems: 'center', gap: '8px', display: 'flex' };
        var labelStyle = { minWidth: '0', color: 'var(--dsw-alias-label-primary)', flex: '1', fontSize: '13px', fontWeight: '500', lineHeight: '1.5' };
        var hintStyle = { color: 'var(--dsw-alias-label-tertiary)', margin: '0', fontSize: '12px', lineHeight: '1.5' };
        var controlStyle = { background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', padding: '5px 8px', fontSize: '13px', minWidth: '0', flex: '1' };
        var saveButtonStyle = { background: 'var(--dsw-alias-button-primary-fill, #4f6ef7)', color: 'var(--dsw-alias-label-primary-inverted, #fff)', border: '0', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' };
        var ghostButtonStyle = { background: 'transparent', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', cursor: 'pointer' };
        var disabledStyle = { opacity: 0.5, cursor: 'default' };
        var statusStyle = { margin: '0', fontSize: '12px', lineHeight: '1.5' };
        var saving = save.status === 'saving';

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
              react.createElement('label', { style: labelStyle, htmlFor: 'dsb-display-currency' }, t('displayLabel')),
              react.createElement('select', { id: 'dsb-display-currency', style: controlStyle, value: fields.displayCurrency, onChange: function (e) { setField('displayCurrency', e.target.value); } },
                react.createElement('option', { value: 'cny' }, t('displayCny')),
                react.createElement('option', { value: 'usd' }, t('displayUsd')),
                react.createElement('option', { value: 'both' }, t('displayBoth'))
              )
            ),
            react.createElement('div', { style: fieldStyle },
              react.createElement('label', { style: labelStyle, htmlFor: 'dsb-threshold-cny' }, t('thresholdCnyLabel')),
              react.createElement('input', { id: 'dsb-threshold-cny', type: 'number', min: 0, step: 0.01, style: controlStyle, value: fields.warningThresholdCny, onChange: function (e) { setField('warningThresholdCny', e.target.value); } })
            ),
            react.createElement('div', { style: fieldStyle },
              react.createElement('label', { style: labelStyle, htmlFor: 'dsb-threshold-usd' }, t('thresholdUsdLabel')),
              react.createElement('input', { id: 'dsb-threshold-usd', type: 'number', min: 0, step: 0.01, style: controlStyle, value: fields.warningThresholdUsd, onChange: function (e) { setField('warningThresholdUsd', e.target.value); } })
            ),
            react.createElement('p', { style: hintStyle }, t('thresholdHint')),
            react.createElement('div', { style: rowStyle },
              react.createElement('button', { style: saving ? Object.assign({}, saveButtonStyle, disabledStyle) : saveButtonStyle, disabled: saving, onClick: onSave }, t('saveLabel')),
              react.createElement('button', { style: saving || !meta.hasOverrides ? Object.assign({}, ghostButtonStyle, disabledStyle) : ghostButtonStyle, disabled: saving || !meta.hasOverrides, onClick: onReset }, t('resetLabel'))
            ),
            saving ? react.createElement('p', { style: Object.assign({}, statusStyle, { color: 'var(--dsw-alias-label-tertiary, #888)' }) }, t('savingStatus'))
              : save.status === 'saved' ? react.createElement('p', { style: Object.assign({}, statusStyle, { color: 'var(--dsw-alias-state-success-primary, #2f9e44)' }) }, t('savedStatus'))
              : save.status === 'error' ? react.createElement('p', { style: Object.assign({}, statusStyle, { color: 'var(--dsw-alias-state-error-primary, #e53e3e)' }) }, save.message)
              : null,
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
