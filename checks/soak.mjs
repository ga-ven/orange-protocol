// 长局稳定性 / 寻路可用性检查。
// 不做渲染，直接以固定步长推进逻辑，观察：
//   1. 队友是否会卡死在掩体上（位移长期为 0）
//   2. 敌人是否能真的走到核心附近（而不是堵在半路）
//   3. 是否出现 NaN 坐标、异常状态或报错
// 用法：先 `node server.mjs`，再 `node checks/soak.mjs`
import { chromium } from 'playwright';

const url = process.env.URL || 'http://127.0.0.1:8790/';
const STEP = 1 / 60;
const SECONDS = Number(process.env.SOAK_SECONDS || 150);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ORANGE_GAME__);
await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(400);

const report = await page.evaluate(
  ({ step, seconds }) => {
    const game = window.__ORANGE_GAME__;
    game.waveTimer = 0.001;

    const samples = { ally: new Map(), enemy: new Map() };
    let stuckWindows = [];
    let nanFrame = -1;
    let minEnemyCoreDistance = Infinity;
    const killCount = { start: game.kills };

    const allyStart = game.allies.map((a) => ({ x: a.position.x, z: a.position.z }));
    const lastPos = game.allies.map((a) => ({ x: a.position.x, z: a.position.z }));
    const stillTime = game.allies.map(() => 0);

    const totalSteps = Math.round(seconds / step);
    for (let i = 0; i < totalSteps; i += 1) {
      game.updateGame(step);

      // 敌人离核心最近能到多近
      for (const enemy of game.enemies) {
        if (!enemy.alive) continue;
        const d = Math.hypot(enemy.position.x - game.core.position.x, enemy.position.z - game.core.position.z);
        if (Number.isFinite(d)) minEnemyCoreDistance = Math.min(minEnemyCoreDistance, d);
      }

      if (i % 30 === 0) {
        game.allies.forEach((ally, index) => {
          const dx = ally.position.x - lastPos[index].x;
          const dz = ally.position.z - lastPos[index].z;
          const moved = Math.hypot(dx, dz);
          if (!Number.isFinite(ally.position.x) || !Number.isFinite(ally.position.z)) {
            if (nanFrame < 0) nanFrame = i;
          }
          // 待命(hold)、倒地、以及已经站在目标点上都算合理静止；只有"没动又没到位"才算卡住
          const exempt = ally.downed || ally.order === 'hold';
          const goalGap = Math.hypot(ally.position.x - ally.goal.x, ally.position.z - ally.goal.z);
          const atPost = goalGap < 1.4;
          stillTime[index] = exempt || atPost ? 0 : moved < 0.02 ? stillTime[index] + 0.5 : 0;
          if (stillTime[index] >= 6) {
            stuckWindows.push({
              ally: ally.name,
              at: (i * step).toFixed(1),
              order: ally.order,
              goalGap: Number(goalGap.toFixed(2)),
              pos: [Number(ally.position.x.toFixed(1)), Number(ally.position.z.toFixed(1))],
            });
            stillTime[index] = 0;
          }
          lastPos[index] = { x: ally.position.x, z: ally.position.z };
        });
      }
    }

    const allyTravel = game.allies.map((ally, index) => {
      const dx = ally.position.x - allyStart[index].x;
      const dz = ally.position.z - allyStart[index].z;
      return { name: ally.name, order: ally.order, net: Number(Math.hypot(dx, dz).toFixed(2)) };
    });

    // 每个队友在整个过程中累计走过的路程
    return {
      elapsed: Number(game.elapsed.toFixed(1)),
      kills: game.kills - killCount.start,
      coreHealth: Math.round(game.core.health),
      allyTravel,
      stuckWindows: stuckWindows.slice(0, 8),
      stuckCount: stuckWindows.length,
      nanFrame,
      minEnemyCoreDistance: Number(minEnemyCoreDistance.toFixed(2)),
      liveEnemies: game.enemies.filter((e) => e.alive).length,
      wavePhase: game.wavePhase,
      state: game.state,
    };
  },
  { step: STEP, seconds: SECONDS },
);

const failures = [];
if (report.nanFrame >= 0) failures.push('出现 NaN 坐标');
if (report.stuckCount > 3) failures.push(`队友卡住 ${report.stuckCount} 次（阈值 3）`);
if (report.minEnemyCoreDistance > 14) failures.push(`敌人从未接近核心（最近 ${report.minEnemyCoreDistance}）`);
if (report.kills === 0) failures.push('整局没有击杀，说明战斗未真正发生');
if (!Number.isFinite(report.coreHealth)) failures.push('核心血量异常');
if (report.state === 'error') failures.push('状态机进入 error');

console.log(JSON.stringify(report, null, 2));
console.log('BROWSER_ERRORS', JSON.stringify(errors));
console.log('FAILURES', JSON.stringify(failures));
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
