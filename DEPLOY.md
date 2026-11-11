# 部署到魔搭创空间（Static）

比赛要求作品部署在魔搭创空间且可公开试玩。本项目是纯静态站点，部署方式如下。

## 关键前提

- **`index.html` 必须在仓库根目录**，不能再套一层 `dist/` 或项目目录。
- 创空间的 **SDK 类型必须选 `Static`**（不要选 Gradio / Streamlit / Docker，那些会拉 Python 镜像跑后端，纯前端用不上还慢）。
- 所有资源都是相对路径（`./styles.css`、`./src/main.js`、`../vendor/three.module.js`），换域名、换子目录都不用改代码。

## 方式 A：网页上传（文件少，推荐）

1. 打开 <https://modelscope.cn/studios>，点右上角「创建创空间」。
2. 填空间名（建议 `orange-protocol`）、显示名「橘光行动 · AI 协防」、简介。
   可见性第一次先选**私有**，验收完再改公开。
3. 进入空间的「空间文件」页，把本目录下这些内容**整体上传**（保持目录结构）：

   ```
   index.html
   styles.css
   src/          （8 个 .js）
   vendor/       （three.module.js / three.core.js / LICENSE-three.txt）
   ```

   `checks/`、`screenshots/`、`README.md`、`SUBMISSION.md`、`server.mjs` 可以不传，不影响运行。
4. 进入「设置 / 部署设置」，SDK 类型选 **Static**，入口文件填 `index.html`，保存。
5. 等状态变成「运行中」，打开 `https://modelscope.cn/studios/<你的用户名>/orange-protocol`。

> 若平台要求 `README.md` 里写 `deployspec`，在空间仓库的 README 顶部加：
>
> ```yaml
> ---
> deployspec:
>   entry_file: index.html
> ---
> ```
>
> 这种情况请**只改空间里的那份 README**，别把 YAML 头写进项目 README（GitHub 上会把这段渲染成一张表）。

## 方式 B：git 推送

```bash
git remote add space https://www.modelscope.cn/studios/<用户名>/orange-protocol.git
git push space main
```

推完同样要去「部署设置」确认 SDK = Static、入口 = `index.html`。

## 部署后必做的验收

### 1. 打开空间首页，看 iframe 里能不能玩

创空间会把页面嵌在自己的 iframe 里。**浏览器默认不允许 iframe 拿指针锁定**，除非平台给 iframe 加了 `allow="pointer-lock"`。本作已经做了两层兜底：

- 检测到 `pointerlockerror` → 自动切换成 **按住左键拖动视角**，并在指令栏上方浮出一条提示；
- 检测到在 iframe 里运行 → 开始页多出一个「在新窗口打开」按钮。

**验收动作**：点开始 → 动鼠标看视角是否跟着转。

- 视角跟着转 → 指针锁定成功，正常。
- 视角不转、底部出现「指针锁定被拦截」→ 点提示里的「在新窗口打开」，在新标签页里玩。这条路径一定能拿到指针锁定。

如果希望评委默认就能在 iframe 里玩，去平台确认空间 iframe 是否带 `allow="pointer-lock"`；带不上就保留现在的兜底，并在提交说明里写一句「建议在新窗口打开获得最佳手感」。

### 2. 控制台零报错

F12 → Console，确认没有红色。重点看：

- `three.module.js` 404 → `vendor/` 没传全（`three.core.js` 必须和它放一起）；
- `Failed to load module script` → MIME 类型不对，通常是上传后文件名被改动。

### 3. 完整跑一局

开场 → 三波 → 结算。确认：

- 队友能听懂 `1`—`6` 和 `T` 打字的指令；
- 音效在首次点击后才有（浏览器自动播放策略，正常）；
- 结算页有评级和队长点评。

### 4. 换个屏幕尺寸

1080p 与 2K 各开一次，HUD 不应错位或被裁切（HUD 会按视口宽度等比缩放）。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开是空白页 | `index.html` 不在根目录 | 把所有文件铺到根，不要留子目录 |
| 页面能开但全黑 | `vendor/three.core.js` 缺失 | 补传该文件 |
| 点了开始没反应 | 控制台报错，看第一条红字 | 按报错定位 |
| 鼠标不能转视角 | iframe 未授予指针锁定 | 用「在新窗口打开」，或点提示条里的按钮 |
| 加载很慢 | 首次拉 2.1MB 的 three.js | 正常，后续走缓存 |
