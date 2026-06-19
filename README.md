# Codex Conversation Preview

本地 Codex 对话记录预览工具。直接读取 Codex 会话 JSONL 和会话索引，在浏览器中按会话查看完整的用户请求、处理过程和最终回复。

## 环境要求

- Node.js 18 或更高版本
- 本机存在 Codex 会话目录，默认位置为 `~/.codex/sessions`

项目仅使用 Node.js 内置模块，无需安装额外依赖。

## 启动与访问

```bash
cd CodexConversationPreview
npm start
```

服务默认监听 `127.0.0.1:5177`。每次启动会生成随机访问令牌，并在终端输出完整访问地址：

```text
Codex Conversation Preview: http://127.0.0.1:5177/#token=<random-token>
```

请使用终端输出的完整地址打开页面。令牌由前端保存到当前标签页的 `sessionStorage`，随后会从地址栏移除，不会随 HTTP 请求或 Referrer 发送。

在启动服务的终端中按 `Ctrl+C` 可停止服务。

## 配置

可通过环境变量修改监听、访问控制和数据文件位置：

```bash
PORT=5180 \
CODEX_PREVIEW_TOKEN='replace-with-a-long-random-token' \
CODEX_SESSIONS_DIR=/path/to/sessions \
CODEX_SESSION_INDEX_FILE=/path/to/session_index.jsonl \
npm start
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `5177` | HTTP 服务端口 |
| `CODEX_PREVIEW_TOKEN` | 每次启动随机生成 | API Bearer Token |
| `CODEX_PREVIEW_ALLOWED_HOSTS` | `127.0.0.1,localhost,::1` | 额外允许的 Host，多个值用逗号分隔 |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex 会话 JSONL 目录 |
| `CODEX_SESSION_INDEX_FILE` | 会话目录同级的 `session_index.jsonl` | 会话标题索引文件 |

如需监听局域网地址，必须同时显式配置允许的 Host，并建议配合防火墙使用：

```bash
HOST=0.0.0.0 \
CODEX_PREVIEW_ALLOWED_HOSTS=192.168.1.20 \
CODEX_PREVIEW_TOKEN='replace-with-a-long-random-token' \
npm start
```

此时使用 `http://192.168.1.20:5177/#token=<token>` 访问。不要将服务直接暴露到公网。

## 功能

### 会话列表

- 扫描本地 Codex 会话目录并展示会话标题、路径、更新时间和消息统计。
- 优先使用 `session_index.jsonl` 中的会话标题，而不是第一条用户消息。
- 支持按标题、工作区名称、记录相对路径和会话 ID 搜索。
- 自动隐藏子智能体、Guardian 以及 Codex 评估历史等重复或不可正常展示的会话。
- 会话列表和对话正文均支持独立滚动。

### 完整对话

- 采用 ChatGPT 风格展示对话：用户消息显示为右侧气泡，最终回复显示为普通助手回复。
- 仅展示同时包含 `user` 和 `assistant · final_answer` 的完整回合；异常中断回合不会显示。
- 用户消息按纯文本展示，长文本自动换行，不需要横向滚动。
- `assistant · commentary` 作为处理过程收纳在“已处理”折叠块中，并显示处理耗时。
- “显示其他内容”开关可将工具调用、工具输出等内容按原始时间顺序嵌入“已处理”区域。
- 支持调节对话字体大小，设置会保存在浏览器本地存储中。
- 支持复制当前会话文件路径。

### Markdown 渲染

最终回复和处理过程支持常用 Markdown：

- 标题、段落、粗体、斜体、链接和引用
- 有序列表、无序列表和分隔线
- 行内代码和围栏代码块
- Python 代码语言标记，如 `python`、`py`、`python3`
- 管道表格、表头和列对齐；宽表格支持横向滚动

用户消息不会进行 Markdown 渲染。

### 用户消息定位

- 右侧轨道为每个完整回合生成一个灰色圆点锚点。
- 悬浮锚点可预览用户消息；包含 `My request for Codex:` 时，仅显示该标记后的内容。
- 点击锚点可平滑跳转并高亮对应用户消息。
- 单轨道时，锚点间隔根据前一个最终回复的长度计算。
- 每条轨道最多显示 15 个锚点；多轨道时锚点等间隔分布并按行对齐。
- 跳转后对应锚点显示选中状态；用户滚动正文后恢复普通样式。

### 提问列表

- 点击“用户消息定位”左侧的列表按钮可打开悬浮提问列表。
- 标题显示当前用户消息总数，列表按会话顺序编号。
- 每条提问最多显示 300 字；包含 `My request for Codex:` 时从标记后开始显示。
- 点击列表项可跳转到对应用户消息。
- 已通过锚点或列表跳转时，再次打开列表会自动滚动并选中当前条目。
- 点击列表外空白区域、再次点击按钮或按 `Esc` 可关闭列表。

## 数据与访问安全

- 工具只读取本地 Codex 会话文件，不会修改原始 JSONL 或会话索引。
- 服务默认仅监听 `127.0.0.1`，并校验请求 Host。
- 所有 API 请求都必须携带访问令牌；静态页面本身不包含令牌。
- 会话列表和详情不会返回会话目录、绝对文件路径、完整工作目录、来源或 CLI 版本。
- 绝对文件路径仅在用户点击“复制路径”时通过独立的受保护接口按需获取。
- API 与静态资源均使用 `no-store`，并设置 CSP、禁止嵌入、禁止 Referrer 等安全响应头。
