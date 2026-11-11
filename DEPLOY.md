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
8. 直链自检：抓一次 `https://try888-orange-protocol.ms.show/`，确认 HTML 里有「橘光行动」

可选参数：`--repo=名字`、`--visibility=private|protected`、`--skip-push`、`--skip-deploy`、`--no-wait`。

## 方式 B：纯网页

不想用脚本就走界面：

1. <https://modelscope.cn/studios> → 「创建创空间」→ 名字 `orange-protocol`
2. 进空间 →「空间文件」→ 上传：`README.md`、`Dockerfile`、`index.html`、`styles.css`、`server.mjs`、`src/`、`vendor/`
   **不要传** `.git/`、`node_modules/`、`checks/`、`screenshots/`
3. 「设置」→ SDK 类型选 **Docker**，端口 **7860**
4. 保存 → 等状态变 `Running`

## 验收清单

- [ ] `https://modelscope.cn/studios/try888/orange-protocol` 能打开，点「应用」能进游戏
- [ ] 开始页正常，「开始行动」可点，第一人称视角出来了
- [ ] 队友、敌人、核心都渲染正常（不是一片橙色或纯黑）
- [ ] F12 Console 无红色；重点看有没有 `Failed to load module script`
- [ ] 完整打一局到结算页
- [ ] 直链 `https://try888-orange-protocol.ms.show/` 能独立打开

## 关于鼠标锁定（FPS 特有）

我查了你现有空间页面的 iframe 属性，`allow` 是这一串：

```
accelerometer; ambient-light-sensor; autoplay; ... fullscreen; ... wake-lock; xr-spatial-tracking
```

**里面没有 `pointer-lock`**，而应用跑在 `try888-xxx.ms.show` 跨域子域上。对打字和点击类游戏（猫咪侦探所、假面协议）没影响，
但对第一人称射击是致命的——鼠标转不了视角。

两层兜底已就位：

1. 检测到 `pointerlockerror` → 自动切成「按住左键拖动视角」，并在指令栏上方浮出提示条；
2. 检测到在 iframe 里运行 → 开始页多出「在新窗口打开」按钮。

另外直链是**独立顶层页面**，指针锁定正常。实测该域名只认浏览器 UA，浏览器访问一律 200。

**建议**：正文给创空间链接（官方要求），玩法说明第一行加一句「想要标准 FPS 手感请开直链」。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 构建报 `Address already in use` | 没监听在 `0.0.0.0:7860` | 本项目已按官方要求绑全网段 7860 |
| 构建失败 `COPY failed` | 文件没传到根目录 | 确认 `index.html`、`Dockerfile` 在根 |
| 打开空白页 | `src/main.js` 或 `vendor/` 缺失 | 查 Network 哪个 404 |
| 有 HUD 但全黑 | WebGL 上下文没起来 | 换 Chrome / Edge，别用 Safari |
| 鼠标转不了视角 | iframe 无指针锁定权限 | 用直链，或点提示条里的「在新窗口打开」 |
| `git push` 被拒 | 分支不是 `master` | 官方默认分支是 `master`，本项目已改名 |
| 合并冲突 | 空间仓库自带初始提交 | 用 `--allow-unrelated-histories`，冲突时 `git checkout --ours .` |
