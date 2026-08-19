# dsh-deepseek-balance 设置体系重构方案（v0.4.0）

目标版本：`0.4.0`（当前 `0.3.4`） · 分支：`dev-0.4.0`

## 1. 背景与问题

当前设置实现在 `lib/index.js` 中**绕开了 dsh 官方 settings 缝**：

- 官方设计是双缝配置模型：
  - `cordis.patch.yml` 行内 `config` → 插件 `config`，作为 settings 的 **base 层**（部署方静态配置）；
  - 用户运行时修改走 **`ctx.settings`**（由 `@deepseek-ai/dsh-settings` 提供，provider 如 `dsh-settings-file` 持久化到 `$DSH_HOME/settings.yaml`，支持热发布、revision 乐观并发、写队列串行化）。
- 本包现状：自建 `/deepseek-balance/settings` HTTP 路由 + 手写 patch 拼接函数族（`resolvePatchFile` / `findRow` / `matchRowName` / `buildDefaultRow` / `buildConfigBlock` / `spliceConfigBlock` / `updatePatchRow` / `atomicWriteFile` / `readLiveRowConfig` / `normalizeForCompare` / `deepEqual` 等约 200+ 行），把用户设置写回 patch 行内 config —— 与官方 settings 服务职责重复，且把"用户设置"与"部署方配置"混为一谈。
- 依赖现状：`schemastery`（unscoped）为直接依赖，**未声明** `@deepseek-ai/dsh-settings`。
- 客户端现状：卡片保存/重置后通过自定义事件 `deepseek-balance:settings-changed` 通知侧边栏刷新；卡片注册缺少 `id`/`order` 字段。

## 2. 官方 API 依据（@deepseek-ai/dsh-settings@0.1.0-rc.7）

已从 registry 下载并核对该包实现（本地存档于 `/Users/choi/Project/DeepSeek-Harness/plugin/.pnpm-store/dsh-settings-0.1.0-rc.7/`）：

- `settingsNamespace(name)` 创建命名空间符号。
- `ctx.settings.register(ns, schema, { base, applies?, validate? })` 返回 scope：`{ get(), watch(cb), update(patch, expectedRevision?), replace(section, expectedRevision?) }`。
  - `update` = merge 用户层；`replace({})` = 重置（清空用户层，回落 base）。
  - 两方法内部完成：schema 校验 → provider 持久化 → revision 递增 → 提交并广播。
- `ctx.settings.describe({ redactSecrets: true })` 返回各 ns 描述符（含 `base` / `user` / `value` / `revision`）。
- `SettingsConflictError`（code `SETTINGS_CONFLICT`）：`expectedRevision` 过期时抛出。
- 事件：`settings/updated (ns, next, prev, source)`、`settings/document-updated (ns, revision)`。
- 浏览器端无法直连 `ctx.settings`（wire 仅暴露 capability 布尔），故保留 HTTP 路由作为**薄代理**是标准形态，而非"绕开"。

## 3. 改动清单

### 3.1 `package.json`

- `dependencies` 移除：`schemastery`（unscoped）、`js-yaml`、`@deepseek-ai/cordis-plugin-include`（patch 拼接删除后不再使用）。
- 新增 `peerDependencies`（non-optional）：
  - `"@deepseek-ai/dsh-settings": "^0.1.0-rc.7"`
  - `"@deepseek-ai/schemastery": "^3.18.1-rc.1"`
- 全部 `schemastery` 引用改为 `@deepseek-ai/schemastery`。

### 3.2 `lib/index.js`

- 命名空间：`const NS = settingsNamespace('deepseek-balance')`。
- 注册：保留 `ctx.inject(['settings'])`，改为持有 scope。**scope 必须在 `apply` 外层作用域声明**（`let scope`），再由 `ctx.inject(['settings'])` 回调赋值，否则后面的 `/deepseek-balance/settings` 薄代理 handler 无法访问它：
  ```js
  let scope; // 外层持有，供薄代理 handler 调用 scope.update / scope.replace
  ctx.inject(['settings'], (sctx) => {
    scope = sctx.settings.register(NS, SCHEMA, { base: resolveSettings(config) });
  });
  ```
- 删除全部 patch 拼接函数（见 §1 清单），**并移除 `ensureDefaultConfig()` 及其调用点**：settings 体系中 base 层只来自部署方 patch config，启动时往 patch 行写入默认配置的行为必须一并删除，否则与"用户层独立于 patch"的新模型冲突。
- `/deepseek-balance/settings` 改为薄代理：
  - `GET` → `describe({ redactSecrets: true })` 中取本 ns，返回 `{ ...value, revision, hasOverrides }`（`hasOverrides = Object.keys(user ?? {}).length > 0`）。
  - `POST`（保存）→ `await scope.update(patch, expectedRevision)`。
  - `POST`（重置）→ `await scope.replace({}, expectedRevision)`。
  - 捕获 `SettingsConflictError` → HTTP 409 + 最新 `revision`。
- `/deepseek-balance`（余额代理）路由保持不变。
- 移除 `deepseek-balance:settings-changed` 事件的服务端触发；跨客户端同步改用官方 `settings/updated` 事件。

### 3.3 `lib/client.js`

对齐统一客户端标准形态：

- 卡片注册补 `id: 'deepseek-balance'`、`order: 40`。
- 删除自定义事件分发/监听；保存后用响应直接 `applySettings(...)` 即时生效。
- 保留轮询兜底（全局 60s / 卡片 30s，与现状一致；如需对齐 footer-order 的 10s 需另行确认）。
- 新增 409 冲突处理：重新 GET 并提示"配置已在别处修改"。

## 4. 风险与兼容性

- **服务缺失降级**：非 web / 无 provider 宿主上 `ctx.inject(['settings'])` 回调不执行，插件以 `config`（base）运行；设置路由返回 503。
- **存量数据迁移**：已写入 patch 行内 config 的值升级后成为 base 层，不再被用户层覆盖。需一次性迁移：读取 patch 现值 → `scope.update()` → 清除 patch 行内键（或文档注明手动迁移）。**注意**：`scope.update()` 必须在 `ctx.inject(['settings'])` 回调成功赋值后、且 provider `writable` 时才可用；服务缺失/只读时跳过迁移并回退 base 运行。
- **peer 依赖升级**：宿主须安装 `@deepseek-ai/dsh-settings >= 0.1.0-rc.7`（标准 dsh web 发行版内置）。

## 5. 验收标准

- [ ] 设置改动持久化到 `$DSH_HOME/settings.yaml`，不再修改 `cordis.patch.yml`。
- [ ] 重置后值回落 base（patch config）。
- [ ] 并发保存触发 409 并被客户端正确处理。
- [ ] 无 settings 服务宿主上余额功能正常、设置路由 503。
- [ ] `lib/index.js` 中不再存在 patch 拼接函数族。
