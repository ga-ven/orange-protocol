// 难度基线对照：把「这个游戏是不是非玩不可」量成数字。
//
// 两种玩家，走同一条时间线（同样从开局开始，同样不做战术指令）：
//   idle   —— 完全不操作。不移动、不射击、不下指令。
//   active —— 站桩但每帧把准星对准最近的敌人并持续开火。
//             「满命中、不移动」= 会打但不会躲的玩家，是难度上界而非平均水平。
//
// 判据：
//   idle 必须打不过（核心被拆）  → 否则说明光看队友就能过，玩家不是必需品
//   active 必须能赢且留有余量    → 否则说明难度劝退
//
// 用法：先起服务（node server.mjs），再
//   URL=http://127.0.0.1:8795/ node checks/baseline.mjs
// 可选：BASELINE_SECONDS=240（模拟上限秒数）、MODES=idle,active
import { chromium } from 'playwright';

const url = process.env.URL || 'http://127.0.0.1:8795/';
const STEP = 1 / 60;
const SECONDS = Number(process.env.BASELINE_SECONDS || 240);
const MODES = (process.env.MODES || 'idle,active').split(',').map((m) => m.trim());
const EYE = 1.68; // CONFIG.player.eyeHeight

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});

const results = {};
const allErrors = [];

for (const mode of MODES) {
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
    ({ step, seconds, mode, eye }) => {
      const game = window.__ORANGE_GAME__;
      game.waveTimer = 0.001; // 跳过开局等待

      const steps = Math.round(seconds / step);
      let peakEnemies = 0;
      let minCore = game.world.core.health;
      let peakCore = minCore;

      for (let i = 0; i < steps; i += 1) {
        if (mode === 'active') {
          const player = game.player;
          if (player.alive) {
            let target = null;
            let targetDistance = Infinity;
            for (const enemy of game.enemies) {
              if (enemy.dead) continue;
              const distance = Math.hypot(
                enemy.position.x - player.position.x,
                enemy.position.z - player.position.z,
              );
              if (distance < targetDistance) {
                targetDistance = distance;
                target = enemy;
              }
            }
            if (target) {
              // 胸口高度：普通单位 0.85m，精英更高
              const aimY = target.position.y + (target.type === 'elite' ? 1.35 : 0.85);
              const dx = target.position.x - player.position.x;
              const dy = aimY - (player.position.y + eye);
              const dz = target.position.z - player.position.z;
              // getForward 的逆运算：forward = (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch))
              player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
              player.yaw = Math.atan2(-dx, -dz);
            }
            game.input.mouseDown = true;
          } else {
            game.input.mouseDown = false;
          }
        }

        // 关键：这一循环不渲染，场景矩阵不会自己更新。
        // Raycaster 依赖 matrixWorld，不手动刷就会一直拿"上一帧渲染时"的敌人位置，
        // 表现为"枪枪开火、枪枪脱靶"（曾实测 515 发 0 命中）。
        game.scene.updateMatrixWorld(true);
        game.updateGame(step);

        const core = game.world.core.health;
        if (core < minCore) minCore = core;
        if (core > peakCore) peakCore = core;
        if (game.enemies.length > peakEnemies) peakEnemies = game.enemies.length;

        if (game.state === 'result') break;
      }

      return {
        mode,
        state: game.state,
        wavePhase: game.wavePhase,
        victory: game.victory,
        elapsed: Math.round(game.elapsed),
        coreHealth: Math.round(game.world.core.health),
        coreMax: game.world.core.maxHealth,
        minCore: Math.round(minCore),
        kills: game.kills,
        shotsFired: game.shotsFired,
        shotsHit: game.shotsHit,
        accuracy: game.shotsFired > 0 ? Math.round((game.shotsHit / game.shotsFired) * 100) : 0,
        peakEnemies,
      };
    },
    { step: STEP, seconds: SECONDS, mode, eye: EYE },
  );

  results[mode] = report;
  allErrors.push(...errors.map((e) => `${mode}: ${e}`));
  console.log(JSON.stringify(report, null, 2));
  await page.close();
}

await browser.close();

// ------------------------------------------------------------------ 判据

const problems = [];
const idle = results.idle;
const active = results.active;

if (idle) {
  if (idle.victory === true) {
    problems.push(
      `挂机也能通关（核心剩 ${idle.coreHealth}/${idle.coreMax}，队友清掉 ${idle.kills} 个）→ 玩家不是必需品`,
    );
  } else if (idle.state !== 'result') {
    problems.push(`挂机 ${SECONDS}s 没打出结果，时间线上限不够或被卡住（phase=${idle.wavePhase}）`);
  }
}

if (active) {
  if (active.victory !== true) {
    problems.push(`站桩满命中也打不过（核心 ${active.coreHealth}/${active.coreMax}）→ 难度过高`);
  } else if (active.coreHealth / active.coreMax < 0.35) {
    problems.push(`站桩能赢但只剩 ${active.coreHealth}/${active.coreMax}，余量偏小`);
  }
}

console.log('\n────────────────────────────────────────');
if (allErrors.length) {
  console.log(`BROWSER_ERRORS ${JSON.stringify(allErrors)}`);
}
if (problems.length) {
  console.log('FAILURES');
  for (const problem of problems) console.log(`  · ${problem}`);
  process.exitCode = 1;
} else {
  console.log('OK：挂机必败、认真打必赢，玩家确实是胜负手');
}
