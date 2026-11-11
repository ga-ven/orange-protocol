# 部署到魔搭创空间（Docker 空间）

依据官方技能文档 <https://modelscope.cn/skills/modelscope/ModelScope-Studio> 的「完整部署工作流」，
并对照你已有的两个空间（`try888/mask-protocol`、`try888/cat-detective`）的真实配置。

## 你已有两个空间的实测配置

直接查 OpenAPI 拿到的（`GET /openapi/v1/studios/try888/<name>`，无需鉴权）：

| 字段 | 假面协议 | 猫咪侦探所 | 本项目（照抄） |
|---|---|---|---|
| `sdk_type` | `docker` | `docker` | `docker` |
| `sdk_version` | `""` | `""` | `""` |
| `hardware` | `platform/2v-cpu-8g-mem` | 同左 | 同左（当前唯一免费档） |
| `app_port` | `7860` | `7860` | `7860` |
| `visibility` | `protected` | `protected` | 先 `private`，验收后改 `protected` |
| `status` | `Running` | `Running` | — |
| `host` | `try888-mask-protocol.ms.show` | `try888-cat-detective.ms.show` | `try888-orange-protocol.ms.show` |

`protected` 的语义是**代码私有、体验公开**——两个已有空间都是这个状态，比赛要求"公开可试玩"，用它正好。

## 为什么还是用 Docker，而不是 static

官方判定表写得很清楚：

- `static`：目录里有 `index.html`（**已预构建**）→ 入口 `index.html`，**不支持构建步骤**，无需选硬件
- `docker`：目录里有 `Dockerfile` → 入口 `Dockerfile`，**端口必须为 7860**
- 官方建议："不确定时也请用 docker"

本项目是纯静态、无构建步骤，`static` 本来也合规。仍选 Docker 只有一个理由：**ES Module 的 MIME 必须是 `text/javascript`**。
一旦静态托管把它当 `text/plain`，浏览器直接拒绝加载 `src/main.js`，页面就是空白。自己的 Node 服务器 100% 可控。

> ⚠️ Docker 空间有前置条件：**完成阿里云账号绑定 + ModelScope 实名认证**，否则无法构建镜像
> （<https://modelscope.cn/docs/studios/docker>）。你两个已有空间都是 Running，说明这步早就过了。

## 已经准备好的文件

| 文件 | 作用 |
|---|---|
| `Dockerfile` | `node:24-alpine`，只拷运行时文件，`USER node` 降权，`HOST=0.0.0.0 PORT=7860 STRICT=1` |
| `server.mjs` | 静态服务：正确 MIME、`no-store`、`/health` 探活、防路径穿越；`STRICT=1` 时屏蔽 `checks/`/`screenshots/`/点开头文件 |
| `README.md` | 顶部 YAML 头含 `sdk: docker` / `app_port: 7860` |
| `scripts/deploy.mjs` | 一键跑完官方 10 步：建空间 → 配 SDK → 推 `master` → 触发部署 → 轮询日志 → 直链自检 |

本地已用**容器等价参数**（`HOST=0.0.0.0 PORT=7862 STRICT=1`）验证过：

```
/                        200 text/html
/src/main.js             200 text/javascript     ← 关键
/vendor/three.module.js  200 text/javascript
/health                  200 text/plain
/checks/flow.mjs         403
/.git/config             403
```

并在这个模式下跑完整回归：31 项断言全过、零 console 报错。

> 本地 7860 常被别的项目占着，验证请换端口，比如 `PORT=7862`。

## 方式 A：一键脚本（推荐）

```bash
# 1. 取令牌：https://modelscope.cn/my/myaccesstoken
export MODELSCOPE_API_KEY=你的令牌

# 2. 部署（默认建私有空间 orange-protocol，推 master，触发部署，等构建完）
cd ai-fps-contest
node scripts/deploy.mjs
```

脚本做的事，全部对应官方接口：

1. `GET /users/me` 拿 owner
2. `GET /studios/{o}/{r}` 判断是否已存在
3. 不存在 → `POST /studios`（`sdk_type=docker`、`hardware=platform/2v-cpu-8g-mem`）
4. `PATCH /studios/{o}/{r}/settings` 对齐 SDK 与硬件（幂等，改动需重新部署才生效）
5. `git remote add modelscope https://oauth2:<token>@modelscope.cn/studios/{o}/{r}.git`
   → `fetch master` → `merge --allow-unrelated-histories`（空间仓库自带初始提交，必须加这个参数）
   → `push -u modelscope master`
6. `POST /studios/{o}/{r}/deploy`
7. 轮询 `GET /logs/build` 与空间状态，直到 `Running` 或报错
8. 直链自检：抓一次 `https://try888-orange-protocol.ms.show/`
   （protected 空间会返回 403 —— 这是正常的，脚本会提示改用浏览器验收，不会误判成部署失败）

可选参数：`--repo=名字`、`--visibility=private|protected`、`--skip-push`、`--skip-deploy`、`--no-wait`。

## 方式 B：纯网页

不想用脚本就走界面：

1. <https://modelscope.cn/studios> → 「创建创空间」→ 名字 `orange-protocol`
2. 进空间 →「空间文件」→ 上传：`README.md`、`Dockerfile`、`index.html`、`styles.css`、`server.mjs`、`src/`、`vendor/`
   **不要传** `.git/`、`node_modules/`、`checks/`、`screenshots/`
3. 「设置」→ SDK 类型选 **Docker**，端口 **7860**
4. 保存 → 等状态变 `Running`

## 接上大模型（可选，但建议开）

没有令牌游戏照样完整可玩，只是「复盘 / 波次提醒 / 兜底解析」走本地模板。
要开模型，只需要在**服务端**放一个令牌，前端一行都不用改：

1. 空间页 →「设置」→「环境变量管理」→ 新增
   - 名称：`MODELSCOPE_API_KEY`
   - 值：你的魔搭令牌（<https://modelscope.cn/my/myaccesstoken>）
2. 保存后**重新上线一次**（环境变量要重新拉起容器才生效）
3. 可选：`NPC_MODEL` 换模型（默认 `Qwen/Qwen3.8-Flash-Next`），`NPC_TIMEOUT_MS` 调超时（默认 25000）

验证：打开游戏，`GET /api/npc` 应返回 `{"enabled":true,"model":"..."}`；
打一局到结算页，「队友复盘」的标签会变成「队友复盘 · 大模型现场生成」。
没配令牌时返回 `enabled:false`，标签保持「队友复盘」——这条降级路径有测试守着（`checks/npc.mjs`）。

> 令牌只存在容器环境变量里，仓库和前端的任何地方都不会出现它。
> 另外记得：这个推理接口**只提供流式**，非流式请求会直接挂住；服务端已经按流式解析。

## 验收清单

- [x] `https://modelscope.cn/studios/try888/orange-protocol` 可访问，状态 `Running`
- [x] `sdk_type=docker`、`app_port=7860`、`hardware=platform/2v-cpu-8g-mem`
- [x] 浏览器里打开首页、`styles.css`、`src/main.js`、`vendor/three*.js` 全部 200，且 `.js` 的 MIME 是 `text/javascript`
      ⚠️ **必须用浏览器（带登录态）验收**：`.ms.show` 对匿名请求一律 403，`curl` 拿到的 403 不代表应用挂了
      —— 已确认在线的猫咪侦探所，用 `curl` 同样是 403。
- [x] 在真实嵌入环境里点「开始行动」进入 `playing`，两名队友在场
- [x] 指针锁定被拒时自动降级，右键转视角、左键开火，提示条正常显示
- [ ] 完整打一局到结算页（需要人工玩一遍）
- [ ] 提交前在手机宽屏 / 2K 屏各看一眼 HUD

## 关于鼠标锁定（FPS 特有，已实测）

创空间**没有"顶层页面"这种形态**。浏览器打开 `.ms.show` 会被跳到
`https://www.modelscope.cn/studios/{owner}/{repo}?mode=full`，那是一个**铺满视口的跨域 iframe**：

```
iframe src = https://try888-orange-protocol.ms.show/?t=...&__theme=light
iframe allow = accelerometer; ...; fullscreen; ...; wake-lock; xr-spatial-tracking   ← 没有 pointer-lock
```

用**有头 Chrome** 在真实嵌入环境里点「开始行动」，实测结果：

```
locked: false          ← 指针锁定被拒
dragLook: true         ← 自动降级生效
state: playing         ← 游戏正常进行
rightDragRotates: true  rightDragFires: false
```

所以兜底不是假设，是必需品。现在的方案：

- **右键拖动**转视角、**左键**照常开火（按住左键拖动也能微调准星，但会同时射击）；
- 底部浮出提示条说明当前模式，附一个**全屏**按钮（`fullscreen` 在 allow 列表里，可用）；
- 检测到在 iframe 里运行，开始页也会多一个「全屏游玩」。

**给评委的建议**：先点「全屏」，再按提示用右键转视角。不要写"请打开直链"——直链会跳回同一个 iframe，没有用。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 构建报 `Address already in use` | 没监听在 `0.0.0.0:7860` | 本项目已按官方要求绑全网段 7860 |
| 构建失败 `COPY failed` | 文件没传到根目录 | 确认 `index.html`、`Dockerfile` 在根 |
| 打开空白页 | `src/main.js` 或 `vendor/` 缺失 | 查 Network 哪个 404 |
| 有 HUD 但全黑 | WebGL 上下文没起来 | 换 Chrome / Edge，别用 Safari |
| 鼠标转不了视角 | iframe 的 `allow` 列表没有 `pointer-lock` | 正常现象，游戏会自动降级：**右键拖动**转视角、**左键**开火。想更沉浸就点提示条或开始页的「全屏」（`fullscreen` 在 allow 列表里）。注意**不要**指望「直链 / 新窗口」——`.ms.show` 会 302 回 `modelscope.cn/studios/...?mode=full`，还是同一个 iframe |
| `git push` 被拒 | 分支不是 `master` | 官方默认分支是 `master`，本项目已改名 |
| 合并冲突 | 空间仓库自带初始提交 | 用 `--allow-unrelated-histories`，冲突时 `git checkout --ours .` |
