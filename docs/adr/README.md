# Architecture decision records

The ADRs are written in Chinese (the project's working language). English titles:

| ADR | Title |
| --- | --- |
| [0001](0001-引用与批注合为一个动作.md) | Highlight and comment are one action; writing a comment makes the difference (terms: see 0008) |
| [0002](0002-回应标记由AI写编号代码负责其余.md) | Response markers: the AI writes only numbered markers, code does the rest |
| 0003 | Markdown-document annotations live in a per-file annotation list — about [Diple Docs](https://github.com/waiclay-349687/hermes-diple-docs), published in its repository |
| [0004](0004-拆成两个插件用插件事件通信.md) | Two plugins with a shared core, talking through plugin events |
| [0005](0005-后端数据存插件SQLite.md) | Data shared by front end and back end goes into the plugin's own SQLite |
| [0006](0006-完整版经插件@引用送达.md) | The full version reaches the AI through a plugin `@` reference, not a `pre_llm_call` hook |
| [0007](0007-交接协议的状态机与幂等.md) | Hand-off protocol: claims with generations, stable batches, monotonic outcomes, settled derived by the backend |
| [0008](0008-命名-标注与圈批Diple.md) | Naming: annotation = highlight + comment; the plugin family “Diple · 圈批” |
| [0009](0009-desktop-kit与批次记录与发送接口.md) | Shared desktop kit; one batch catalog; the send module's interface split by role |
| [0010](0010-发送请求与发送菜单与图钉合成线程滚动.md) | One send request and send menu; pins scroll with the thread |
| [0011](0011-工具条跟随松手点与保留选区Range.md) | The selection button follows the release point; the selection Range is kept |
| 0012–0014 | The document page's list layouts, placement and bulk actions — about Diple Docs, published in [its repository](https://github.com/waiclay-349687/hermes-diple-docs) |

Terms used in the ADRs are defined in [GLOSSARY.md](../../GLOSSARY.md) (Chinese, with the English words to avoid).
