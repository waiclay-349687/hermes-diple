---
status: accepted
date: 2026-10-25
---

# 两个插件共用的桌面行为放进 desktop-kit；批次记录与发送按角色收口

出处：D1 设计审查（codebase-design，2026-10）的 L1、L2、L3 三项。本篇只记决定和接口；行为在重构前后不变，由场景测试（`tests/desktop/contracts.test.mjs` 等）钉住。

## 决定

### 1. `packages/desktop-kit`（L1）

两个插件一模一样的桌面行为只写一份，像 `packages/core` 一样在构建时分别打包进每个插件（别名 `@diple/desktop-kit`，`scripts/build.mjs` 的 `SHARED_ALIASES`）。运行时各插件一份实例，互不共享状态，也不互相 import（ADR 0004 不变）。

- `locale-ids.js`：宿主内置的 locale 列表、各语言自称、RTL、`envelopeLangOf`、`localeFromTag`、语言选项。
- `createLocaleRuntime(ctx, settings, { pluginId, locales, roots })`：跟随 app 或固定语言、缺键回退 en、插件根节点的 `dir` 同步（含后来出现的根节点）、发给 AI 的语言；旧宿主没有 `ctx.i18n` 或 SDK 没有 `usePluginI18n` 时自己翻译。所有订阅随 `ctx.onDispose` 结束。
- `createSettingsStore(storage, normalize)`：读、持久化、通知。规则（默认值、允许的值）由插件自己的 `normalize` 给出。

留在插件里的：插件 id、根节点选择器、文案（`messages.js`、`locales/`）、设置项和默认值。

### 2. 批次记录：`BatchCatalog`（L2）

`plugins/diple/desktop/src/shared/batch-catalog.js` 是唯一知道本地批次记录存法的模块：`batch.<id>` 加 `batches.index`（旧的在前），最多 200 条，超出删最旧的；本地没有时回退问后端。

```js
const batches = createBatchCatalog({ storage, api })
batches.remember(rec)              // 发送时写入
batches.peek(batchId)              // 只查本地，不发请求
await batches.read(batchId)        // 本地 → GET /batches/<id>，取到就记住；404 / 连不上 / 无 items → null
batches.localForSession(key)       // 该会话的本地记录（按索引顺序）
await batches.findItem(itemId, key)// 先查所有会话的本地记录（新的在前），再查该会话的后端记录
```

`send-flow`、回应标记、原文上的已发标记和定位都通过它读，不再各自拼 storage 的键。存储格式、上限、缺省值不变。记录只说明「这一批带了什么」，是否发出仍以后端状态为准（`shared/batch-states.js` 不变）。

### 3. 发送模块按角色收口（L3，D1 §5.4 方案 C）

`plugins/diple/desktop/src/send/sending.js`：

```js
const sending = createSending(deps, env, { reveal })
await sending.request(key, { bodySource: 'draft' })   // 或 { bodySource: 'explicit', body }
sending.preview(key, body)
sending.get(key)          // { queued, status, receipt, notices }，冻结的快照，没变化时是同一个对象
sending.subscribe(key, fn)
await sending.resolve(key, { type: 'cancel-queue' | 'put-back-confirmation' | 'keep-confirmation'
                                 | 'dismiss-notice' | 'put-back-notice' | 'clear-receipt', ... })
useSending(sending, key)  // React

const bound = bindSending(ctx, sending, { live, session, gateway, beforeEvent })
bound.middleware(draft); bound.resume()
```

- UI（底栏、回执行、预览弹窗、标记）只拿 `request / preview / get / subscribe / resolve`。
- 宿主接线（网关事件、`plugin.diple.batch.sent`、文档版交接广播、焦点、重连、重载后恢复、composer middleware）只经 `bindSending`。
- `settle`、发件箱、接收方的 `start` 不在任何对外接口上：UI 无法伪造最终结果。`resolve` 遇到未知动作返回 `{ ok: false }`，不会静默成功。
- 协议实现（`send-flow.js`、`handoff.js`）原样留在模块内部，是它的内部 seam；回归测试仍可直接驱动它。await 的位置、同步写入的顺序、超时、错误词（`unknown` 与 `false` 分开）、通知都没有改。

## 不变量与错误表

| 场景 | 结果 |
| --- | --- |
| 一次发送意图（含保存/读草稿期间的重复点击） | 最多一个批次、一次 submit；其余返回 `already-sending` 或提示「上一批标注还在发送」 |
| PUT /batches 失败 | `register-failed`，列表解锁，不 submit |
| 回合出错（展开前） | `turn-error`，条目放回 |
| 历史读不到（`null`） / 读到无此行（`false`） | 前者按本回合确认；后者不算送达，保留待确认 |
| 最终结果 POST 失败 | 存进发件箱，重试或下个窗口补发，先到的终态不被覆盖 |
| 同一 handoffId 重复广播 | 一个 batchId，一次 submit |
| 后端批次 404 / 连不上 | `read` / `findItem` 返回 `null` |
| `resolve` 动作无效 | `{ ok: false }`（`put-back-notice` 另带 `count: 0`） |

## 理由

- 删除测试：两份逐行相同的 locale / dir / 设置代码删掉一份，复杂度不会在调用方重现，说明这是一份行为、两个副本。合并后修一次两边都修好。
- 批次记录原来分散在三处，各自知道键名和上限；改存储时要同时改三处，也没有一个地方能测「本地 → 后端 → 记住」这条规则。
- 发送对象原来把协议内部（`settle`、发件箱、接收方入口）和 UI 需要的东西放在同一个对象上，UI 可以绕过协议直接写终态。按角色收口后，每个使用者只看到它需要的接口。
- 没有重写协议状态机：它已经过 R1–R9 九轮复审，重写的风险远大于收益。

## Considered Options

- **方案 A：只暴露用户意图**（一个 `install` 搞定一切）：宿主接线和 UI 混在一起，测试只能从最外层进，压不到并发窗口。没有采用。
- **方案 B：纯状态机 + effect 解释器**：等于重写已验证的协议，风险最大。没有采用。
- **把 desktop-kit 做成万能 UI 库**：两个插件的界面并不相同，只有一个使用者的抽象是假 seam。没有采用（D1 L7 另议）。
- **BatchCatalog 放进 `packages/core`**：它依赖 storage 和后端，不是纯逻辑；而且只有聊天版用。没有采用。

## Consequences

- 新增共享包 `packages/desktop-kit`，公开导出的白名单和依赖闭包检查（`validatePublicImports`）都包括它。
- `ctx.storage.set` 抛异常时，设置的内存值已经更新但订阅者不会被通知、异常抛给调用方——这是原有行为，原样保留并写进了测试。
- L5–L8（文档选区映射、docs 安全读取、SDK 展示 adapter、文档会话生命周期）不在本轮，记在 ROADMAP 的「内部设计债」。
