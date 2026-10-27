---
status: accepted
date: 2026-10-25
---

# 命名：标注 = 划线 + 批注；插件家族名「圈批 · Diple」

术语见本篇；它取代 0001、0003、0006 等早期 ADR 里的「摘录 / 引用 / 审阅清单」叫法（旧 ADR 正文是历史记录，不改）。完整调研是一份内部笔记，没有公开；结论都在本篇里。

## 决定

- **统称**：从对话或文档里选出的一段原文（带出处，意见可留空）叫 **标注**，英文 **annotation**。原来叫「摘录 / excerpt」。
- **不写意见的标注** 叫 **划线**，英文 **highlight**。原来叫「引用 / quote」。
- **写了意见的标注** 仍叫 **批注**，英文改为 **comment**（原来英文叫 annotation，这个词现在给了统称）。意见本身仍叫「意见 / comment」。
- 文档版的「审阅清单」改为 **标注清单**。
- **插件名**：聊天版 `Diple · 圈批`（id `diple`），文档版 `Diple Docs · 圈批·文档`（id `diple-docs`）。宿主显示插件名时不翻译，所以各语言都显示这个双语名。公开仓库名 `hermes-diple`。
- **发给 AI 的前缀** 改为 `@diple:`。插件 id、事件命名空间（`plugin.diple.*`）和这个前缀共用一个常量（Python `store.PLUGIN_ID`，JS core `Envelope.REFERENCE_PREFIX`）。文档版的事件是 `plugin.diple-docs.*`。
- **回应标记 `::ann{}` 不变**。`ann` 本来就是 annotation 的缩写，改名后反而更贴切；它由模型写出，改动它要重新教模型、还要兼容历史回答。
- 发给 AI 的规则改写为：**批注要逐条回应；划线只是背景材料，不要单独回应**（英文 "Answer each comment; highlights are background only"）。
- 一次性改名，不写兼容层和迁移代码：改名时插件数据是空的，公开版也还没有用户。

## 理由

- 「摘录」只说「抄出来」，看不出「贴意见」，和子称分不开，这是用户提出的问题。「标注」能覆盖「只划不写」，且和 Hermes 宿主自己的「标注 / 批注」（Annotate / Comment）一致；W3C Web Annotation、Codex、Kindle 也都是「一个统称 + 两种子称」、统称允许没有意见。
- 「引用」在 Hermes 里已经有主人：composer 的 `@` 提示叫「引用文件、文件夹、网址」，我们的 `@diple:` 在宿主里也叫「上下文引用」。「划线」和微信读书、Kindle Highlight、W3C `highlighting` 对得上。
- 保留「批注」：和宿主、Codex、W3C `commenting` 一致，回应标记「↩ 批注 ①」中文一个字不用改。
- 「审阅」已被宿主的审查面板占用，所以文档版叫「圈批·文档」、清单叫「标注清单」。
- 「圈批」= 圈（划线）+ 批（批注），正好是两种子称的并集；Diple（`>`）是亚历山大学者写在页边、指向注疏的符号，也是引号的前身，和 Hermes 的希腊主题呼应。插件目录、GitHub 和网上都没找到同功能的同名产品。

## Considered Options

- **备选 B：圈批 · Annotations**（id `annotations`）：英文一看就懂。但和 Hermes 内置的预览「Annotate / 标注」撞名，词太泛，且 Python 里 `from __future__ import annotations` 让代码难以 grep。没有采用。
- **备选 C：评点 · Diple**：没有「批改作业」的联想，更书卷气；但「圈点」那一半不显眼，覆盖「只划不写」不如「圈批」精确。没有采用。
- **统称用「批注」**：中文里没有不写字的批注，且和子称同名。没有采用。
- **统称用「笔记」**：太大，会占掉将来沉淀体系要用的词。没有采用。
- **保留 `@excerpt:` 前缀**：零风险，但会在用户看得到的气泡里留下一个和新名字、新术语都不一致的旧词。没有采用。
- **把 `::ann{}` 改成 `::diple{}`**：模型看不出含义、抄错风险变高，历史回答也要兼容；收益为零。没有采用。
- 其他候选（Margin、Gloss、Scholia、Marginalia、Highlight、Glean、Manicule、Rubric、Hermeneia）因撞名或精确度低落选。打分和撞名证据在内部调研笔记里。

## Consequences

- 规则文本的「comment 要回应，highlight 是背景」属于推理，没有做 A/B 实测；改名后应用几条真实批次冒烟确认回应标记的准确率不变。
- 本机已装的旧版（`excerpt`、`excerpt-review`）需要在安装新版时卸载，旧的 plugin-data 可以直接丢弃。
- 目前只更新了 zh、en 两种界面语言；其他语言另行处理（各语言的建议叫法在提案 §3）。
