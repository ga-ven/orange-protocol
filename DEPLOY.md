# 部署到魔搭创空间（Docker 空间）

## 先看结论：照抄你已有的两个空间的路子

`mask-protocol`（假面协议）和 `cat-detective`（猫咪侦探所）用的是**同一套**：

| | 假面协议 | 猫咪侦探所 | 本项目 |
|---|---|---|---|
| 类型 | Docker 空间 | Docker 空间 | Docker 空间（同样） |
| 基础镜像 | `node:24-alpine` | `node:20-alpine` | `node:24-alpine` |
| 端口 | 7860 | 7860 | 7860 |
| README 头 | `license` / `tags` | `sdk: docker` / `app_port: 7860` | `sdk: docker` / `app_port: 7860` |
| 为什么需要后端 | 调 ModelScope API，token 必须留在服务端 | 匿名记事件 + 调模型 | **不需要**，纯静态；照样用 Docker 只是为了控制 MIME 和访问范围 |

本项目其实没有后端逻辑，理论上可以用「静态空间」。但仍然选了 Docker，理由只有一个：**ES Module 的 MIME 必须是 `text/javascript`**，一旦静态托管把它当成 `text/plain`，浏览器会直接拒绝加载 `src/main.js`，页面一片空白。用自己的 Node 服务器，这条 100% 可控。

## 已经做好的东西

- `Dockerfile` —— 只拷运行时文件，`USER node` 降权，`HOST=0.0.0.0`、`PORT=7860`、`STRICT=1`
- `server.mjs` —— 静态服务器：正确的 MIME 表、`Cache-Control: no-store`、`/health` 探活、路径穿越防护、`STRICT=1` 时屏蔽 `checks/` `screenshots/` `node_modules/` 和所有点开头文件
- `README.md` —— 顶部已加 `sdk: docker` / `app_port: 7860` 的 YAML 头

已在本地用**容器等价参数**验证过（`HOST=0.0.0.0 PORT=7862 STRICT=1`）：

```
/                        200 text/html
/src/main.js             200 text/javascript     ← 关键
/vendor/three.module.js  200 text/javascript
/health                  200 text/plain
/checks/flow.mjs         403
/.git/config             403
```

并在这个模式下跑完整回归：31 项断言全过、零 console 报错。

> 注意：本地 7860 常被你另一个项目的开发服务器占着（`netstat -ano | findstr :7860` 可查）。本地验证请换端口，比如 `PORT=7862`。

## 创建空间

1. <https://modelscope.cn/studios> → 右上角「创建创空间」。
2. 填名字，建议 `orange-protocol`；显示名「橘光行动 · AI 协防」。
3. 可见性先选**私有**，验收通过再改公开。
4. 创建后进入空间。

## 上传这些文件（保持目录结构）

```
README.md          ← 必须有，平台从它的 YAML 头读 sdk / app_port
Dockerfile
index.html
styles.css
server.mjs
src/               ← 8 个 .js
vendor/            ← three.module.js / three.core.js / LICENSE-three.txt
```

**不要传**：`.git/`（体积大且没必要）、`node_modules/`、`checks/`、`screenshots/`（2MB，运行时用不到）。

传完后确认根目录能直接看到 `Dockerfile` 和 `index.html`，不要多套一层文件夹。

## 部署与验收

保存后平台会开始构建（拉 `node:24-alpine` + 启动，通常 1—3 分钟）。状态变「运行中」后：

访问 `https://modelscope.cn/studios/try888/orange-protocol`，点「应用」标签。

验收清单：

- [ ] 开始页正常显示，标题「橘光行动」和开始按钮都在
- [ ] 点「开始行动」能进入第一人称视角
- [ ] 队友、敌人、核心都渲染出来（不是一片橙色或黑屏）
- [ ] F12 Console 无红色报错（尤其是 `Failed to load module script`）
- [ ] 完整打一局到结算页

## 关于鼠标锁定：这条对 FPS 特别重要

我查了你现有空间页面的 iframe 属性，`allow` 列表是这样的：

```
accelerometer; ambient-light-sensor; autoplay; ... fullscreen; ... wake-lock; xr-spatial-tracking
```

**里面没有 `pointer-lock`**，而应用是跑在 `try888-xxx.ms.show` 这个跨域子域上的。对打字和点击类的游戏（猫咪侦探所、假面协议）没影响，但对第一人称射击是致命的——没有指针锁定，鼠标就转不了视角。

已经做了两层兜底：

1. 检测到 `pointerlockerror` → 自动切成「按住左键拖动视角」，并在指令栏上方浮出提示条；
2. 检测到在 iframe 里运行 → 开始页多出「在新窗口打开」按钮。

另外，应用的**直链是跨域独立的页面**：

```
https://try888-orange-protocol.ms.show/
```

浏览器直接打开这个地址是顶层页面，指针锁定正常，手感最好。我实测这个域名只认浏览器 UA，用浏览器访问一律 200。

**建议**：提交时正文里给创空间链接（这是官方要求），同时在玩法说明第一行放一句「想要标准 FPS 手感，请打开直链」。评委多半会照做。

## 更新版本

改了代码重新上传对应文件即可。`Cache-Control: no-store` 已设，不用手动刷缓存。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 构建失败 | `Dockerfile` 不在根目录，或 `sdk` 不是 docker | 检查根目录结构与 README 头 |
| 打开是空白页 | `src/main.js` 或 `vendor/` 没传全 | 查 Network 面板哪个 404 |
| 全黑但有 HUD | WebGL 上下文没起来 | 换 Chrome / Edge，别用 Safari |
| 鼠标转不了视角 | iframe 没有指针锁定权限 | 用直链，或点提示条里的「在新窗口打开」 |
| 构建一直转圈 | 平台排队 | 等 3—5 分钟；超过就重新点部署 |
