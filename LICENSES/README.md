# 第三方组件与许可台账

本作品除下列第三方组件外，其余代码、关卡、AI 系统、界面、美术与音效均为原创。

## 运行时依赖

| 组件 | 版本 | 许可证 | 在仓库中的位置 | 用途 |
|---|---|---|---|---|
| Three.js | r187 | MIT | `vendor/three.module.js`、`vendor/three.core.js` | WebGL 渲染引擎 |

许可证全文：`LICENSES/three-r187-MIT.txt`（与 `vendor/LICENSE-three.txt` 内容一致）。

引入方式：直接拷贝官方发布的 ESM 构建产物，未做任何修改，未使用打包器。

## 开发期依赖（不随作品分发）

| 组件 | 用途 | 说明 |
|---|---|---|
| Playwright | 真浏览器自动化测试与截图 | 仅开发机使用，`checks/` 下的脚本；不进入交付产物 |
| Google Chrome | 测试运行环境 | 通过 `channel: 'chrome'` 复用本机浏览器，未下载 Chromium |

## 无外部素材声明

仓库内**不含**任何图片、音频、字体或模型文件，具体表现均由代码生成：

- 几何体：`src/entities.js`、`src/world.js` 中用 `BoxGeometry` / `CylinderGeometry` / `SphereGeometry` 等程序化构建。
- 贴图：`src/utils.js` 的 `makeFloorTexture` / `makeStripeTexture` / `createTextSprite` 用 Canvas 2D 实时绘制。
- 音效：`src/audio.js` 用 `OscillatorNode` 与程序生成的噪声缓冲合成。
- 字体：仅使用系统字体栈（Microsoft YaHei / PingFang SC / sans-serif），未内嵌字体文件。

因此不存在图片素材授权、音乐版权或字体商用授权问题。

## 与开源 FPS 项目的关系

本项目**没有** Fork 或改造任何完整的开源 FPS 游戏工程。立项阶段确认的边界是：

- 复用：Three.js 引擎，以及第一人称移动、碰撞、射线命中这类通用基础能力（自行实现）。
- 原创：核心玩法（自然语言指挥 AI 队友）、AI 队友行为与记忆系统、关卡、三波节奏、界面与全部美术音效。

详见仓库外的立项文档 `AI造游戏_FPS参赛方案_20261111.md` 第一节「参赛判断」。
