# dsh-deepseek-balance

一个常驻的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Cordis 插件，用于在侧边栏底部、Settings 按钮正上方展示你的 DeepSeek 账户余额。

<p align="center">
  <img src="docs/imgs/example.png" alt="账户余额示例" width="240">
</p>

![balance-display](https://img.shields.io/badge/platform-web-blue)

> [!NOTE] 
> **AI 生成声明**:本插件由 AI 生成，可能存在错误、安全隐患或不符合预期之处，使用前请自行 review 代码并实测；发现任何问题欢迎提交 issue 或 PR 修正。

## 特性

- 在左侧边栏底部、Settings 上方展示当前 DeepSeek 账户余额，每 60 秒自动刷新。
- 三种显示模式：仅 CNY、仅 USD、或同时显示两者；可为 CNY/USD 分别配置预警阈值 —— 余额低于阈值显示红色、低于其两倍显示黄色（0 = 禁用预警）。
- 配置实时生效 —— 部署默认值编辑 `cordis.patch.yml`（base 层，HMR），用户设置用 设置 → 插件 → Balance Monitor（保存到 `settings.yaml`，经 dsh settings 服务热发布）；两者均无需重启 `dsh web`。
- 当侧边栏收起（rail 模式）时自动隐藏。
- 从 `DEEPSEEK_API_KEY` 环境变量读取 API 密钥。

## 架构

这是一个**双面（dual-face）Cordis 插件**：

| 端 | 文件 | 作用 |
| --- | --- | --- |
| Host | `lib/index.js` | 在官方 `ctx.settings` 缝上注册 `deepseek-balance` settings 命名空间（patch 行内 config 作为 base 层；供 设置 → 插件 → Plugin configuration 标签页派发卡片）；注册 `/deepseek-balance`（代理 [DeepSeek Get User Balance API](https://api-docs.deepseek.com/api/get-user-balance)）和 `/deepseek-balance/settings`（`ctx.settings` 的薄代理：GET 生效设置 + revision；POST 保存/重置写入用户层，携带 revision 乐观并发，冲突返回 409） |
| Client | `lib/client.js` | 在 `sidebar.footer.action` 槽位注册余额展示（60 秒轮询），并以 `deepseek-balance` 为 key 在 `settings.plugin.item` 注册可编辑的 Balance Monitor 卡片（显示于 Plugin configuration 标签页） |

```
Browser (Client half)  --fetch /deepseek-balance-->  Host HTTP route  -->  api.deepseek.com/user/balance
```

## 安装

### 通过 [plugin-registry](https://github.com/vlln/plugin-registry) 安装

设置 → 插件 → 安装,source 填 `@choi-p/dsh-deepseek-balance` 或者 `github:Choi-Peng/dsh-deepseek-balance`

### 手动安装

```bash
dsh plugin --profile web add "github:Choi-Peng/dsh-deepseek-balance"
```

插件包自带 `cordis.patch.yml`（`package.json` 中的 `dsh.bundle.patch`），安装时由 dsh 自动应用 —— **无需手改 profile 层的 `cordis.patch.yml`**。重启 `dsh web` 后生效（插件发现按进程缓存）。

### 卸载方式：

```bash
dsh plugin --profile web remove @choi-p/dsh-deepseek-balance
```

bundle 挂载随插件移除自动消失；若曾在 profile 层手动写过该行，需先删掉它。

## 配置

插件设置遵循 dsh 官方双缝配置模型，**均实时生效，无需重启 `dsh web`**（要求宿主安装 `@deepseek-ai/dsh-settings` ≥ 0.1.0-rc.7，标准 dsh web 发行版内置）：

| 层 | 来源 | 生效方式 |
| --- | --- | --- |
| 默认值 | schema 内置（`cny`，两个阈值均为 0） | — |
| base 层（部署方静态配置） | 插件 bundle 自带 `cordis.patch.yml` 行内 `config`（`dsh.bundle.patch`，安装即自动挂载） | `dsh web` 监听 patch 层（HMR），编辑后自动用新配置重启此 fiber |
| 用户层（运行时设置） | 设置 → 插件 → Balance Monitor 的保存/重置，经 `ctx.settings` 持久化到 `$DSH_HOME/settings.yaml`；重置 = 清空用户层回落 base | settings 服务热发布，立即生效；本插件不再改写 `cordis.patch.yml` |

base 层 `config`（bundle 默认附带）：

```yaml
- insert:
    - id: deepseek-balance
      name: '@choi-p/dsh-deepseek-balance'
      config:
        displayCurrency: cny   # cny = 仅 CNY | usd = 仅 USD | both = 同时显示（默认 cny）
        warningThresholdCny: 0 # CNY 预警阈值（0 = 禁用）；低于显示红色，低于其两倍显示黄色
        warningThresholdUsd: 0 # USD 预警阈值（0 = 禁用）；低于显示红色，低于其两倍显示黄色
```

卡片暴露
`displayCurrency`（下拉框：仅 CNY / 仅 USD / CNY 和 USD）以及两个告警阈值（数字输入框），并提供
保存 / 恢复默认值；保存采用 revision 乐观并发，若配置已在别处修改会提示并加载最新值；侧边栏余额展示每 60 秒轮询刷新。预警规则：余额 ≤ 阈值显示红色，≤ 阈值的两倍显示黄色，阈值为 0 时不预警。

API 密钥从 `DEEPSEEK_API_KEY` 环境变量读取；密钥仅由 host 端持有并以 `Bearer` 方式随请求发送，不会下发到浏览器。

余额 API 会返回账户的全部币种余额（通常为 CNY 与 USD）；侧边栏按 `displayCurrency` 设置显示对应币种。

## 使用

1. 在环境变量中设置 `DEEPSEEK_API_KEY` 后启动 `dsh web` —— 侧边栏底部、Settings 上方会显示余额读数，每 60 秒自动刷新。
2. 设置 → 插件 → **余额监控** 卡片：选择要显示的币种并设置预警阈值，然后保存。所有修改实时生效，无需重启 `dsh web`。

## 开发

```bash
# 校验 host 半部分可被干净地导入：
node --input-type=module -e "import('./lib/index.js').then(m => console.log(m.name, m.inject))"

# 对 client bundle 做语法检查：
node -e "new Function(require('fs').readFileSync('lib/client.js', 'utf8'))"
```

## License

MIT
