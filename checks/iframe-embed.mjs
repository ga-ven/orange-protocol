// 复现魔搭创空间的嵌入式播放条件，验证游戏在 iframe 里仍然可玩。
// 背景：创空间页面 iframe 的 allow 列表里没有 pointer-lock，且应用是跨域子域。
// 局限：无头 Chrome 不执行 Permissions Policy，连 allow="pointer-lock 'none'" 都拦不住，
//       所以这里无法复现"被拦"这一支；本脚本只断言"嵌入式下一定可玩 + 有兜底入口"。
// 被拦后的降级行为另由 `checks/flow.mjs` 之外的 enableDragLook 用例覆盖。
// 用法：先 `node server.mjs`，再 `node checks/iframe-embed.mjs`
import { chromium } from 'playwright';

const MODES = ['absent', 'mslike'];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const rows = [];
for (const mode of MODES) {
  await page.goto(`http://localhost:8790/checks/iframe-harness.html?mode=${mode}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const frame = page.frames().find((f) => f.url().startsWith('http://127.0.0.1:8790'));
  if (!frame) {
    rows.push({ mode, error: '找不到跨域 iframe' });
    continue;
  }

  const result = await frame.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('start-button').click();
    await sleep(400);
    const game = window.__ORANGE_GAME__;
    try {
      await game.canvas.requestPointerLock();
    } catch (error) {
      /* 被策略拦下是预期分支 */
    }
    await sleep(700);

    const yawBefore = game.player.yaw;
    const pill = document.getElementById('lock-fallback');
    const snapshot = {
      embedded: window.self !== window.top,
      openWindowHidden: document.getElementById('open-window')?.hidden,
      pointerLocked: document.pointerLockElement === game.canvas,
      dragLook: game.dragLook === true,
      pillShown: pill ? !pill.classList.contains('hidden') : false,
      state: game.state,
    };

    // 统一进拖拽模式（无头 Chrome 通常会真的锁上，先退出来才能测到拖拽分支）
    if (document.pointerLockElement) document.exitPointerLock();
    game.enableDragLook();
    await sleep(100);

    const yawBeforeDrag = game.player.yaw;
    game.lookDragRight = true;
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 60, movementY: 0 }));
    await sleep(60);
    snapshot.yawMoved = Math.abs(game.player.yaw - yawBeforeDrag) > 0.01;
    snapshot.pillShown = pill ? !pill.classList.contains('hidden') : false;

    // 左键只开火、不该再带动视角；右键才转视角
    game.lookDragRight = false;
    const yawBeforeLeft = game.player.yaw;
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 60, movementY: 0 }));
    await sleep(60);
    snapshot.leftDragLooks = Math.abs(game.player.yaw - yawBeforeLeft) > 0.01;
    snapshot.leftFires = game.input.mouseDown === true;
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));

    const yawBeforeRight = game.player.yaw;
    document.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 60, movementY: 0 }));
    await sleep(60);
    snapshot.rightDragLooks = Math.abs(game.player.yaw - yawBeforeRight) > 0.01;
    snapshot.rightDragFires = game.input.mouseDown === true;
    document.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
    return snapshot;
  });
  rows.push({ mode, ...result });
}

const failures = [];
for (const row of rows) {
  if (row.error) {
    failures.push(`${row.mode}: ${row.error}`);
    continue;
  }
  // 无论锁定是否被拦，嵌入式都必须满足：能看到新窗口按钮、视角能动、状态正常
  if (!row.embedded) failures.push(`${row.mode}: 没跑在 iframe 里，测试无效`);
  if (row.openWindowHidden !== false) failures.push(`${row.mode}: 未显示「在新窗口打开」按钮`);
  if (!row.yawMoved) failures.push(`${row.mode}: 视角无法移动`);
  if (row.state !== 'playing') failures.push(`${row.mode}: 状态异常 ${row.state}`);
  if (!row.pointerLocked && !row.pillShown) failures.push(`${row.mode}: 锁定被拦却没给提示`);
  if (!row.leftFires) failures.push(`${row.mode}: 左键没能开火`);
  if (!row.rightDragLooks) failures.push(`${row.mode}: 右键拖动没转视角`);
  if (row.rightDragFires) failures.push(`${row.mode}: 右键拖动不该开火`);
}

console.table(rows);
console.log('BROWSER_ERRORS', JSON.stringify(errors));
console.log('FAILURES', JSON.stringify(failures));
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);

