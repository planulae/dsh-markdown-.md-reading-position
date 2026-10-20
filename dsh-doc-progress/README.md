# Markdown 阅读进度保持（dsh-doc-progress）

一个 DSH 客户端插件：记住右侧栏每个 Markdown 文档预览的阅读位置。切换会话、关闭再打开预览、重启客户端后，回到上次读到的位置。

A DSH client plugin that remembers the reading position of each Markdown preview in the right sidebar and restores it after switching sessions, closing and reopening the preview, or restarting the app. Positions stay in `localStorage`; the plugin sends nothing over the network and never stores document text.

## 功能

- 按文件绝对路径记录滚动位置；同一个文件在不同会话里共享阅读进度。
- 位置较深、首屏还没加载到那里时，自动点预览里的“加载更多”，一页页翻到原位置再定位。
- 记录最近的标题序号和偏移；窗口宽度变化导致重排后，优先按标题位置校正。
- 后台隐藏的会话不会在后台恢复或滚动；等它显示出来再恢复。
- 只读写预览的滚动位置，不修改文件，也不影响文件内容。

## 安装

### 从 npm 安装

```bash
dsh plugin --profile <profile> add dsh-doc-progress
```

`<profile>` 换成要安装的 profile，例如 `web`。桌面端使用 `desktop` profile，且该 profile 由桌面客户端管理，安装或更新前请先完全退出客户端。

### 本地开发安装

```bash
git clone <repository-url>
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-doc-progress
```

安装后重启客户端。插件会被加入 profile 的 `dsh.profile.bundles`，其 `cordis.patch.yml` 负责把插件插入配置树。

### 手动安装

1. 把本目录链接或复制到 profile 的 `node_modules/dsh-doc-progress`。
2. 在 profile 的 `package.json` 中把 `dsh-doc-progress` 加入 `dependencies` 和 `dsh.profile.bundles`。
3. 重启客户端。

## 使用

打开右侧栏的 Markdown 预览并滚动即可，无需额外操作。下次打开同一个文件时，插件会把位置放回去。

- 想从顶部重新阅读：滚到顶部后离开，记录会被更新为顶部。
- 想清掉某个文件的记录：在客户端控制台执行 `__DSH_DOC_PROGRESS__.forget("文件名")`。
- 想清空全部记录：执行 `__DSH_DOC_PROGRESS__.clear()`。

## 配置

在 profile 的 `cordis.patch.yml` 里按 entry id 覆盖（可选）：

```yaml
- id: dsh-doc-progress
  config:
    # 等内置恢复/导航先落定，再恢复；默认 160ms
    restoreDelayMs: 160
    # 为了到达已保存位置，最多自动翻页多久；默认 15s
    maxRestoreMs: 15000
    # 最多保留多少个文件的记录，超出按最久未读淘汰；默认 500
    maxDocs: 500
    # 打开控制台调试日志
    debug: false
```

## 隐私

- 所有记录只写入当前客户端的 `localStorage`，不联网、不上传、不进入会话记录，也不会被模型看到。
- 记录内容包括文件绝对路径、滚动像素/比例、视口高度、标题序号与偏移、更新时间。
- **不保存文档正文或标题文字**；标题只以序号参与恢复，正文内容不会离开渲染后的页面。
- 升级到本版本后首次激活时，会自动删除旧记录里已经保存过的标题文字。
- 文件绝对路径是恢复位置所需的本地索引；可以用上面的 `forget` / `clear` API 随时删除。
- 插件不读取凭据、环境变量或 profile 配置中的任何密钥。

## 兼容性

- 基于 DSH `0.2.1-rc.2` 的文档预览 DOM 契约实现，使用 `data-textpreview-*`、`data-document-markdown`、`data-textpreview-more` 等公开渲染属性。
- 如果 DSH 后续版本改动这些属性，插件可能需要适配；行为测试会覆盖主要的恢复路径。
- 只在右侧栏的 Markdown 预览中生效。把渲染器手动切换成“纯文本”后不跟踪。
- 同一个文件同时在两个面板里打开时，以最后一次滚动为准。

## 开发

目录结构：

```text
lib/index.js       宿主半区（空实现，只负责让 bundle 和客户端模块被发现）
lib/client.js      浏览器半区：观察预览 DOM、保存和恢复滚动位置
locale/en.json     英文显示名称与说明
locale/zh.json     中文显示名称与说明
cordis.patch.yml   profile bundle patch
test/              无头浏览器行为测试
```

运行测试：

```bash
npm test
# 或
node test/run.mjs
```

测试会在本地启动一个临时 HTTP 服务和无头 Chrome/Edge，覆盖持久化、重新挂载恢复、分页深位置恢复、隐藏后显示、绝对路径晚到、无记录不误跳，以及“不保存标题文字”的隐私约束。可以用 `CHROME_PATH` 指定浏览器可执行文件。

## 发布

```bash
npm publish
```

发布前建议：

- 确认包名 `dsh-doc-progress` 在 npm 上可用；如果被占用，改成带 scope 的包名（例如 `@your-scope/dsh-doc-progress`），并同步修改 `cordis.patch.yml` 里的 `name` 和 profile 依赖。
- 在 `package.json` 中补充 `repository`、`homepage` 等元数据。
- `files` 白名单只发布 `lib`、`locale`、`cordis.patch.yml`、`README.md` 和 `LICENSE`，不包含测试目录。

### 在 GitHub 发布

GitHub 上需要上传的是**源码目录本身**，不是 npm 的 `.tgz`：

- 上传 `package.json`、`README.md`、`LICENSE`、`.gitignore`、`cordis.patch.yml`、`lib/`、`locale/`、`test/`。
- 不要上传 `node_modules/`、测试生成的浏览器 profile、`*.tgz`；这些都在 `.gitignore` 里。
- 如果创建 GitHub Release，可以把 npm 生成的 `dsh-doc-progress-<version>.tgz` 作为 Release 附件上传，方便别人直接下载安装；它不是源码仓库的替代品。
- 仓库根目录保留 `package.json` 和 `dsh.bundle.patch` 后，可以直接从 GitHub 安装：

  ```bash
  dsh plugin --profile <profile> add github:<user>/<repo>
  ```

- GitHub Packages 是另一套 npm registry：需要把包名改成 `@<user>/dsh-doc-progress`，并配置 `.npmrc` 指向 `https://npm.pkg.github.com`。如果只是分享插件，源码仓库 + Release 更简单。

## English

### What it does

DSH keeps a preview tab's scroll offset in per-tab memory. When a session switch closes or recreates that tab, the offset is gone and the Markdown preview starts from the top again. This plugin mirrors the offset into `localStorage` under a stable file key and restores it when the preview mounts again.

### Install

```bash
dsh plugin --profile <profile> add dsh-doc-progress
```

For a local checkout:

```bash
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-doc-progress
```

Restart the client after installing. The `desktop` profile is managed by the desktop app; quit the app before installing there.

### Privacy

Positions are stored locally in `localStorage` only. The plugin sends nothing over the network, never reads credentials, and does not persist document text or heading text — only the file path, scroll offset/ratio, viewport size, heading ordinal/offset, and timestamp.

### Configuration

Override the `dsh-doc-progress` entry in the profile's `cordis.patch.yml` with `restoreDelayMs`, `maxRestoreMs`, `maxDocs`, or `debug`.

### Publishing

Run `npm publish` for npm. For GitHub, push the source tree (excluding `node_modules/` and `*.tgz`); a Release may attach the generated npm tarball as a download. GitHub Packages is a separate npm registry and requires a scoped package name plus an `.npmrc` pointing at `https://npm.pkg.github.com`.

### Development

```bash
npm test
```

The test launches a temporary HTTP server and headless Chrome/Edge. Set `CHROME_PATH` when the browser is not in a standard location.

## License

MIT. See [LICENSE](./LICENSE).
