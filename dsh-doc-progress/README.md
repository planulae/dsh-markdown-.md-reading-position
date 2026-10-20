# Markdown 阅读进度保持（dsh-doc-progress）

让 DSH 右侧栏的 Markdown 文档预览记住每个文件的阅读位置：切换会话、关闭再打开预览、重启客户端后，都会回到上次读到的位置。

## 它解决什么

DSH 的文档预览把滚动位置存在每个标签页自己的内存状态里。切换会话时标签页可能被关闭或作为新的 occurrence 重建，内存里的偏移就丢了，文件会重新渲染并从顶部开始。这个插件在浏览器端观察 Markdown 预览的滚动容器，把位置按文件绝对路径写进 `localStorage`，等预览再次挂载时再放回去。

- 只记录，不修改文件内容。
- 按文件绝对路径保存；同一个文件在不同会话里共享阅读位置。
- 位置较深、首屏还没加载到那里时，会自动点预览里的“加载更多”，一页页翻到原位置再定位。
- 保存时同时记录最近的标题锚点；窗口宽度变化导致重排后，优先按标题校正位置。
- 后台隐藏的会话不会在后台偷偷恢复或滚动；等它显示出来再恢复。

## 安装状态

本机已安装到 desktop profile：

- 插件目录：`D:\dsh-doc-progress`
- profile 链接：`C:\Users\liche\.dsh\profiles\desktop\node_modules\dsh-doc-progress`（junction）
- profile `package.json` 的 `dsh.profile.bundles` 已包含 `dsh-doc-progress`

修改 `package.json` 前已备份为 `package.json.bak-docprogress-<时间戳>`。

## 验证

已在本机 DSH 客户端里确认：

1. 客户端启动后，渲染进程的 `localStorage` 中出现 `dsh.document-reading-progress.v1`，说明插件已加载。
2. 打开一个长 Markdown 文件并滚动后，记录类似：

   ```json
   {
     "file:d:/cs_dsh/_doc-progress-test.md": {
       "top": 1400,
       "ratio": 0.1269,
       "height": 11770,
       "viewport": 860,
       "anchor": { "text": "第 6 节", "index": 6, "offset": 100 }
     }
   }
   ```

3. 切换到另一个会话再切回来，预览回到切换前的章节位置。

另外有一套无头浏览器测试，覆盖持久化、重新挂载恢复、分页深位置恢复、隐藏后显示、绝对路径晚到、无记录不误跳：

```powershell
node D:\dsh-doc-progress\test\run.mjs
```

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖（可选）：

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

## 调试与清理

客户端控制台里可以直接操作：

```js
__DSH_DOC_PROGRESS__.stats()        // 当前跟踪的预览数、记录数、配置
__DSH_DOC_PROGRESS__.dump()         // 查看保存的原始记录
__DSH_DOC_PROGRESS__.forget("foo")  // 删除路径包含 foo 的记录
__DSH_DOC_PROGRESS__.clear()        // 清空所有阅读位置
__DSH_DOC_PROGRESS__.saveNow()      // 立即落盘
```

## 卸载

1. 从 profile `package.json` 的 `dsh.profile.bundles` 和 `dependencies` 中移除 `dsh-doc-progress`。
2. 删除 `C:\Users\liche\.dsh\profiles\desktop\node_modules\dsh-doc-progress`。
3. 重启客户端。

## 已知边界

- 只处理右侧栏的 Markdown 预览（默认 Markdown 渲染器）；把渲染器手动切成“纯文本”后不跟踪。
- 同一个文件同时在两个面板里打开时，以最后一次滚动为准。
- 文件内容大幅改写后，标题锚点可能失效；此时按像素位置尽量靠近。
- 记录只存在本机 `localStorage`，不经过网络、不进会话记录、不影响模型。
