// 触屏端到端自检：真的要"用手指"把这个游戏打一遍。
// 全部走 CDP 的 Input.dispatchTouchEvent，产生的是 pointerType=touch 的真实指针事件——
// 用 page.mouse 模拟不出触屏，因为视角拖动那段专门忽略了 mouse 指针。
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.URL || 'http://127.0.0.1:8790/';
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const errors = [];
function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` · ${detail}` : ''}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`);
    failures.push(`${label}${detail ? ` · ${detail}` : ''}`);
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--no-proxy-server',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
  ],
});

const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
});
const cdp = await context.newCDPSession(page);

// ------------------------------------------------------------------ 触摸手势
async function touchStart(points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points.map((point, index) => ({ x: point.x, y: point.y, id: point.id ?? index + 1 })),
  });
}

async function touchMove(points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: points.map((point, index) => ({ x: point.x, y: point.y, id: point.id ?? index + 1 })),
  });
}

async function touchEnd() {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function box(selector) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 };
  }, selector);
}

// ------------------------------------------------------------------ 打开
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ORANGE_GAME__, null, { timeout: 25000 });
await page.waitForTimeout(700);

console.log('\n[1] 触屏识别');
const boot = await page.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  isTouch: document.body.classList.contains('is-touch'),
  hasControls: Boolean(window.__ORANGE_GAME__.touch),
  touchNote: getComputedStyle(document.querySelector('.demo-note .touch-only')).display,
  desktopNote: getComputedStyle(document.querySelector('.demo-note .desktop-only')).display,
  hudScale: getComputedStyle(document.documentElement).getPropertyValue('--hud-scale').trim(),
}));
assert(boot.coarse, '浏览器报告 pointer: coarse');
assert(boot.isTouch, 'body 挂上 is-touch');
assert(boot.hasControls, '实例化了触控层');
assert(boot.touchNote !== 'none' && boot.desktopNote === 'none', '开始页显示触屏文案、隐藏键鼠文案', `${boot.touchNote}/${boot.desktopNote}`);
assert(Number(boot.hudScale) === 1, '手机横屏 HUD 按 1:1 真实像素排', boot.hudScale);
const pixelRatio = await page.evaluate(() => window.__ORANGE_GAME__.renderer.getPixelRatio());
assert(pixelRatio <= 1, '渲染像素比降到 1.0', String(pixelRatio));
await page.screenshot({ path: `${outDir}/mobile-01-start.png` });

// ------------------------------------------------------------------ 开局
console.log('\n[2] 开始行动');
await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(900);
const started = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  layer: getComputedStyle(document.getElementById('touch-layer')).display,
  locked: document.pointerLockElement !== null,
  skillText: document.getElementById('touch-skill').textContent,
}));
assert(started.state === 'playing', '进入 playing', started.state);
assert(started.layer === 'block', '触控层显示出来', started.layer);
assert(!started.locked, '触屏不会去抢指针锁');
assert(started.skillText === '脉冲', '技能按钮显示就绪', started.skillText);
await page.screenshot({ path: `${outDir}/mobile-02-hud.png` });

// ------------------------------------------------------------------ 摇杆
console.log('\n[3] 左下摇杆走位');
const stick = await box('#stick-zone');
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.player.position.set(0, 0, 12);
  game.player.velocityY = 0;
  window.__startPos = { x: game.player.position.x, z: game.player.position.z };
});
await touchStart([{ x: stick.cx, y: stick.cy }]);
await touchMove([{ x: stick.cx, y: stick.cy - stick.h * 0.3 }]);
await page.waitForTimeout(120);
const stickPush = await page.evaluate(() => ({
  moveY: window.__ORANGE_GAME__.input.moveY,
  moveX: window.__ORANGE_GAME__.input.moveX,
  sprint: window.__ORANGE_GAME__.input.sprintTouch,
  knob: document.getElementById('stick-knob').style.transform,
}));
assert(stickPush.moveY > 0.6, '摇杆前推 → moveY 为正', stickPush.moveY.toFixed(2));
assert(Math.abs(stickPush.moveX) < 0.2, '没有横向漂移', stickPush.moveX.toFixed(2));
assert(stickPush.knob.includes('translate3d'), '滑块跟着手指走', stickPush.knob);
await page.waitForTimeout(700);
const moved = await page.evaluate(() => ({
  pos: { x: window.__ORANGE_GAME__.player.position.x, z: window.__ORANGE_GAME__.player.position.z },
  start: window.__startPos,
  sprinting: window.__ORANGE_GAME__.player.sprinting,
}));
const forwardDistance = moved.start.z - moved.pos.z;
assert(forwardDistance > 1.2, '人真的往前走了', `Δz=${forwardDistance.toFixed(2)}`);
await touchEnd();
await page.waitForTimeout(150);
const released = await page.evaluate(() => window.__ORANGE_GAME__.input.moveY);
assert(released === 0, '抬手后摇杆归零', String(released));
await page.screenshot({ path: `${outDir}/mobile-03-stick.png` });

// ------------------------------------------------------------------ 视角
console.log('\n[4] 右半屏滑动转视角');
const beforeYaw = await page.evaluate(() => window.__ORANGE_GAME__.player.yaw);
await touchStart([{ x: 620, y: 190, id: 1 }]);
for (let step = 1; step <= 6; step += 1) {
  await touchMove([{ x: 620 + step * 18, y: 190, id: 1 }]);
  await page.waitForTimeout(16);
}
await touchEnd();
await page.waitForTimeout(100);
const afterYaw = await page.evaluate(() => window.__ORANGE_GAME__.player.yaw);
assert(Math.abs(afterYaw - beforeYaw) > 0.1, '拖动改变了 yaw', `${beforeYaw.toFixed(2)} → ${afterYaw.toFixed(2)}`);
const firedWhileLooking = await page.evaluate(() => window.__ORANGE_GAME__.shotsFired);
assert(firedWhileLooking === 0, '单纯转视角不会走火', String(firedWhileLooking));

// ------------------------------------------------------------------ 开火
console.log('\n[5] 开火键按住射击');
const fire = await box('#touch-fire');
const shotsBefore = await page.evaluate(() => window.__ORANGE_GAME__.shotsFired);
await touchStart([{ x: fire.cx, y: fire.cy, id: 1 }]);
await page.waitForTimeout(120);
const holding = await page.evaluate(() => ({
  mouseDown: window.__ORANGE_GAME__.input.mouseDown,
  active: document.getElementById('touch-fire').classList.contains('is-active'),
}));
assert(holding.mouseDown === true, '按下开火键 → input.mouseDown', String(holding.mouseDown));
assert(holding.active, '开火键进入按下态');
await page.waitForTimeout(700);
await touchEnd();
await page.waitForTimeout(150);
const shotsAfter = await page.evaluate(() => ({
  shots: window.__ORANGE_GAME__.shotsFired,
  ammo: window.__ORANGE_GAME__.player.ammo,
  mouseDown: window.__ORANGE_GAME__.input.mouseDown,
}));
assert(shotsAfter.shots > shotsBefore, '真的打出了子弹', `${shotsBefore} → ${shotsAfter.shots}`);
assert(shotsAfter.ammo < 30, '弹匣有消耗', String(shotsAfter.ammo));
assert(shotsAfter.mouseDown === false, '抬手后停止射击');

// ------------------------------------------------------------------ 多指同按
console.log('\n[6] 边走边打（多指）');
const beforeMulti = await page.evaluate(() => ({
  shots: window.__ORANGE_GAME__.shotsFired,
  x: window.__ORANGE_GAME__.player.position.x,
  z: window.__ORANGE_GAME__.player.position.z,
}));
await touchStart([{ x: stick.cx, y: stick.cy, id: 1 }]);
await touchMove([{ x: stick.cx, y: stick.cy - stick.h * 0.3, id: 1 }]);
await page.waitForTimeout(80);
await touchStart([
  { x: stick.cx, y: stick.cy - stick.h * 0.3, id: 1 },
  { x: fire.cx, y: fire.cy, id: 2 },
]);
await page.waitForTimeout(700);
const multi = await page.evaluate(() => ({
  moveY: window.__ORANGE_GAME__.input.moveY,
  mouseDown: window.__ORANGE_GAME__.input.mouseDown,
  shots: window.__ORANGE_GAME__.shotsFired,
  x: window.__ORANGE_GAME__.player.position.x,
  z: window.__ORANGE_GAME__.player.position.z,
}));
await touchEnd();
assert(multi.moveY > 0.6 && multi.mouseDown, '摇杆和开火可以同时生效', `moveY=${multi.moveY.toFixed(2)} fire=${multi.mouseDown}`);
assert(multi.shots > beforeMulti.shots, '边走边打有输出', `${beforeMulti.shots} → ${multi.shots}`);
// 视角已经转过，此时"前进"不再等于 -Z，只能量水平位移总量
const multiDistance = Math.hypot(multi.x - beforeMulti.x, multi.z - beforeMulti.z);
assert(multiDistance > 0.4, '同时也在位移', `Δ=${multiDistance.toFixed(2)}`);
await page.waitForTimeout(150);
const multiReleased = await page.evaluate(() => ({
  moveY: window.__ORANGE_GAME__.input.moveY,
  mouseDown: window.__ORANGE_GAME__.input.mouseDown,
}));
assert(multiReleased.moveY === 0 && !multiReleased.mouseDown, '两根手指都抬起后全部归零', JSON.stringify(multiReleased));

// ------------------------------------------------------------------ 指令
console.log('\n[7] 底部指令按钮');
await page.evaluate(() => {
  window.__ORANGE_GAME__.player.ammo = 0;
  window.__ORANGE_GAME__.player.reloading = false;
});
await page.click('#quick-commands button[data-intent="flank"]');
await page.waitForTimeout(300);
const commanded = await page.evaluate(() => ({
  orders: window.__ORANGE_GAME__.allies.map((ally) => ally.order),
  count: window.__ORANGE_GAME__.commandCount,
  highlight: document.querySelectorAll('#quick-commands .active').length,
}));
assert(commanded.orders.every((order) => order === 'flank'), '点「包抄」→ 两名队友都收到包抄', commanded.orders.join(','));
assert(commanded.count === 1, '指令计数 +1', String(commanded.count));

// ------------------------------------------------------------------ 换弹 / 脉冲
console.log('\n[8] 换弹与脉冲');
// 前面打了十几秒，指挥官可能已经被打趴；先满血复活，否则换弹会在"倒地"分支里空转
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.player.alive = true;
  game.player.health = game.player.maxHealth;
  game.player.ammo = 0;
  game.player.reloading = false;
  game.ui.setHealth(game.player.health, game.player.maxHealth);
});
const reload = await box('#touch-reload');
await touchStart([{ x: reload.cx, y: reload.cy, id: 1 }]);
await touchEnd();
await page.waitForTimeout(120);
const reloading = await page.evaluate(() => ({
  reloading: window.__ORANGE_GAME__.player.reloading,
  timer: window.__ORANGE_GAME__.player.reloadTimer,
}));
assert(reloading.reloading, '点「换弹」开始换弹', `timer=${reloading.timer}`);
// 不能写死等待时间：软件渲染只有个位数帧率，dt 每帧夹到 0.08，游戏内时间比真实时间慢好几倍
const reloadDone = await page
  .waitForFunction(() => window.__ORANGE_GAME__.player.ammo === 30, null, { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
assert(reloadDone, '换弹结束后弹匣补满', String(await page.evaluate(() => window.__ORANGE_GAME__.player.ammo)));

const skill = await box('#touch-skill');
await touchStart([{ x: skill.cx, y: skill.cy, id: 1 }]);
await touchEnd();
await page.waitForTimeout(300);
const skilled = await page.evaluate(() => ({
  cooldown: window.__ORANGE_GAME__.player.skillCooldown,
  label: document.getElementById('touch-skill').textContent,
  cooling: document.getElementById('touch-skill').classList.contains('cooling'),
}));
assert(skilled.cooldown > 0, '「脉冲」进入冷却', skilled.cooldown.toFixed(1));
assert(skilled.cooling && /\d/.test(skilled.label), '按钮上显示倒计时', skilled.label);

// ------------------------------------------------------------------ 电台
console.log('\n[9] 战术电台');
const radio = await box('#touch-radio');
await touchStart([{ x: radio.cx, y: radio.cy, id: 1 }]);
await touchEnd();
await page.waitForTimeout(400);
const radioOpen = await page.evaluate(() => ({
  open: !document.getElementById('radio-modal').classList.contains('hidden'),
  layer: getComputedStyle(document.getElementById('touch-layer')).display,
  state: window.__ORANGE_GAME__.state,
}));
assert(radioOpen.open, '「电台」打开了输入面板');
assert(radioOpen.layer === 'none', '打开电台时收掉触控层，避免误触', radioOpen.layer);
await page.screenshot({ path: `${outDir}/mobile-04-radio.png` });
await page.fill('#radio-input', '都回来，守住核心');
await page.click('#radio-form .send-button');
await page.waitForTimeout(600);
const radioDone = await page.evaluate(() => ({
  count: window.__ORANGE_GAME__.commandCount,
  orders: window.__ORANGE_GAME__.allies.map((ally) => ally.order),
  state: window.__ORANGE_GAME__.state,
  focused: document.activeElement === document.getElementById('radio-input'),
}));
assert(radioDone.count === 2, '自然语言指令被接受', String(radioDone.count));
assert(radioDone.orders.every((order) => order === 'defend'), '两句话都落到守核心', radioDone.orders.join(','));
assert(!radioDone.focused, '提交后输入框失焦，手机键盘会收回去');

// ------------------------------------------------------------------ 暂停 / 继续
console.log('\n[10] 暂停与继续');
await page.waitForTimeout(400);
const pause = await box('#touch-pause');
await touchStart([{ x: pause.cx, y: pause.cy, id: 1 }]);
await touchEnd();
await page.waitForTimeout(400);
const paused = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  screen: !document.getElementById('pause-screen').classList.contains('hidden'),
  layer: getComputedStyle(document.getElementById('touch-layer')).display,
}));
assert(paused.state === 'paused', '顶部暂停键把游戏停下', paused.state);
assert(paused.screen, '弹出暂停面板');
assert(paused.layer === 'none', '暂停时收起触控层', paused.layer);
await page.screenshot({ path: `${outDir}/mobile-05-pause.png` });
await page.click('#resume-button');
await page.waitForTimeout(400);
const resumed = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  layer: getComputedStyle(document.getElementById('touch-layer')).display,
  locked: document.pointerLockElement !== null,
}));
assert(resumed.state === 'playing', '继续后回到 playing', resumed.state);
assert(resumed.layer === 'block', '触控层回来了', resumed.layer);
assert(!resumed.locked, '触屏继续时不请求指针锁');

// ------------------------------------------------------------------ 帧率
console.log('\n[11] 帧率');
await page.evaluate(() => {
  window.__frames = 0;
  window.__frameStart = performance.now();
  const tick = () => {
    window.__frames += 1;
    if (performance.now() - window.__frameStart < 2000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(2400);
const perf = await page.evaluate(() => ({
  frames: window.__frames,
  ms: performance.now() - window.__frameStart,
  calls: window.__ORANGE_GAME__.renderer.info.render.calls,
  triangles: window.__ORANGE_GAME__.renderer.info.render.triangles,
}));
const fps = (perf.frames / perf.ms) * 1000;
// headless + swiftshader 是纯 CPU 光栅化，帧率绝对值没有任何参考价值（实测同一套场景
// 桌面视口也只有几帧）。所以这里不做数值断言，只确认"还在持续出帧、没有卡死"，
// 真正的性能手段靠下面三条可验证的显存/像素预算。
assert(perf.frames > 2, '仍在持续出帧，没有卡死', `${fps.toFixed(1)} fps（swiftshader 软渲染，非真机数据）`);
console.log(`  info drawCalls=${perf.calls} triangles=${perf.triangles}`);
const budget = await page.evaluate(() => {
  const renderer = window.__ORANGE_GAME__.renderer;
  const canvas = renderer.domElement;
  return {
    pixelRatio: renderer.getPixelRatio(),
    antialias: renderer.getContext().getContextAttributes().antialias,
    backing: [canvas.width, canvas.height],
    css: [canvas.clientWidth, canvas.clientHeight],
  };
});
assert(budget.pixelRatio <= 1, '触屏像素比锁在 1.0', String(budget.pixelRatio));
assert(budget.antialias === false, '触屏关掉 MSAA', String(budget.antialias));
assert(
  budget.backing[0] === Math.round(budget.css[0] * budget.pixelRatio),
  '画布后备缓冲没有超采样',
  `${budget.backing.join('x')} vs ${budget.css.join('x')}`,
);
await page.screenshot({ path: `${outDir}/mobile-06-fight.png` });

// ------------------------------------------------------------------ 结算页
console.log('\n[12] 结算页');
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.score = 3120;
  game.kills = 17;
  game.shotsFired = 96;
  game.shotsHit = 58;
  game.elapsed = 402;
  game.core.health = 88;
  game.endGame(true);
});
await page.waitForTimeout(900);
const result = await page.evaluate(() => {
  const wrap = document.querySelector('.result-wrap');
  const rect = wrap.getBoundingClientRect();
  const stats = document.querySelector('.result-stats').getBoundingClientRect();
  const insight = document.getElementById('result-insight').getBoundingClientRect();
  return {
    layer: getComputedStyle(document.getElementById('touch-layer')).display,
    title: document.getElementById('result-title').textContent,
    grade: document.getElementById('result-grade').textContent,
    cells: document.querySelectorAll('.result-stats > div').length,
    overflowX: rect.left < -1 || rect.right > window.innerWidth + 1,
    // 卡片外面装得下不代表里面没被裁：内容宽过 wrap 就会被 overflow:hidden 切掉
    innerOverflow: Math.round(Math.max(stats.right, insight.right) - rect.right),
    scrolls: wrap.scrollHeight - wrap.clientHeight,
  };
});
assert(result.title.includes('守住'), '结算标题正常', result.title);
assert(result.cells === 6, '六项战绩都在', String(result.cells));
assert(result.layer === 'none', '结算时收起触控层', result.layer);
assert(!result.overflowX, '结算卡片没有横向溢出');
assert(result.innerOverflow <= 1, '六项战绩和复盘文字没被裁掉', `超出 ${result.innerOverflow}px`);
assert(result.scrolls <= 0, '一张屏装得下，不用滚动', `溢出 ${result.scrolls}px`);
await page.screenshot({ path: `${outDir}/mobile-07-result.png` });
await page.click('#again-button');
await page.waitForTimeout(900);
const again = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  layer: getComputedStyle(document.getElementById('touch-layer')).display,
}));
assert(again.state === 'playing' && again.layer === 'block', '「再守一次」能重新开局并恢复触控层', JSON.stringify(again));

// ------------------------------------------------------------------ 竖屏门槛
console.log('\n[13] 竖屏门槛');
const portrait = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const portraitPage = await portrait.newPage();
await portraitPage.goto(url, { waitUntil: 'networkidle' });
await portraitPage.waitForFunction(() => window.__ORANGE_GAME__, null, { timeout: 25000 });
await portraitPage.waitForTimeout(500);
const gate = await portraitPage.evaluate(() => ({
  warning: getComputedStyle(document.getElementById('mobile-warning')).display,
  rotate: getComputedStyle(document.querySelector('.mobile-card-rotate')).display,
  desktop: getComputedStyle(document.querySelector('.mobile-card-desktop')).display,
  rotateText: document.querySelector('.mobile-card-rotate h2').textContent,
}));
assert(gate.warning === 'grid', '竖屏时盖住整个界面', gate.warning);
assert(gate.rotate !== 'none' && gate.desktop === 'none', '只显示「请把手机横过来」', `${gate.rotate}/${gate.desktop}`);
assert(gate.rotateText.includes('横'), '提示文案正确', gate.rotateText);
await portraitPage.screenshot({ path: `${outDir}/mobile-07-portrait.png` });
await portrait.close();

// ------------------------------------------------------------------ 桌面不受影响
console.log('\n[14] 桌面路径没被改坏');
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const desktopPage = await desktop.newPage();
const desktopErrors = [];
desktopPage.on('pageerror', (error) => desktopErrors.push(error.message));
await desktopPage.goto(url, { waitUntil: 'networkidle' });
await desktopPage.waitForFunction(() => window.__ORANGE_GAME__, null, { timeout: 25000 });
await desktopPage.waitForTimeout(500);
const desktopState = await desktopPage.evaluate(() => ({
  coarse: window.matchMedia('(pointer: coarse)').matches,
  isTouch: document.body.classList.contains('is-touch'),
  hasControls: Boolean(window.__ORANGE_GAME__.touch),
  hudScale: getComputedStyle(document.documentElement).getPropertyValue('--hud-scale').trim(),
  mouseRelevant: window.__ORANGE_GAME__.touch === null,
}));
assert(!desktopState.coarse && !desktopState.isTouch && !desktopState.hasControls, '桌面不创建触控层', JSON.stringify(desktopState));
assert(Number(desktopState.hudScale) < 1, '桌面仍按设计稿缩放 HUD', desktopState.hudScale);
await desktopPage.evaluate(() => document.getElementById('start-button').click());
await desktopPage.waitForTimeout(600);
// 注意用 down 而不是 press：press 会立刻 up，测到的永远是空集合
await desktopPage.keyboard.down('KeyW');
await desktopPage.waitForTimeout(200);
const desktopMove = await desktopPage.evaluate(() => ({
  key: window.__ORANGE_GAME__.input.keys.has('KeyW'),
  moveY: window.__ORANGE_GAME__.input.moveY,
  touchMove: window.__ORANGE_GAME__.touch ? window.__ORANGE_GAME__.touch.stickPointer : 'n/a',
}));
await desktopPage.keyboard.up('KeyW');
assert(desktopMove.key, '桌面键盘输入照旧', JSON.stringify(desktopMove));
await desktop.close();

console.log('\nFAILURES', failures);
console.log('BROWSER_ERRORS', errors.concat(desktopErrors));
await browser.close();
if (failures.length || errors.length || desktopErrors.length) process.exitCode = 1;
