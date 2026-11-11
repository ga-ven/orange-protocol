import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.URL || 'http://127.0.0.1:8790/';
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(outDir, { recursive: true });
const failures = [];
const assert = (condition, message) => {
  if (!condition) {
    failures.push(message);
    console.log('ASSERT_FAIL', message);
  } else {
    console.log('OK', message);
  }
};

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
const page = await browser.newPage({ viewport: { width: 1120, height: 700 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (error) => {
  errors.push(error.message);
  console.log('PAGEERROR', error.message);
});
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(message.text());
    console.log('CONSOLE_ERROR', message.text());
  }
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ORANGE_GAME__);
await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(500);

let state = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  phase: window.__ORANGE_GAME__.wavePhase,
}));
assert(state.state === 'playing', 'start button enters playing state');
assert(state.phase === 'prep', 'first run begins in preparation phase');

// Wave 1 through the real wave manager.
await page.evaluate(() => {
  window.__ORANGE_GAME__.waveTimer = 0.001;
});
await page.waitForFunction(() => window.__ORANGE_GAME__.wavePhase === 'combat');
await page.evaluate(() => window.__ORANGE_GAME__.updateWave(0.2));
let wave = await page.evaluate(() => ({
  index: window.__ORANGE_GAME__.currentWaveIndex,
  total: window.__ORANGE_GAME__.waveTotal,
  enemies: window.__ORANGE_GAME__.enemies.length,
}));
assert(wave.index === 0, 'wave 1 starts');
assert(wave.total === 5, 'wave 1 has five enemies configured');
assert(wave.enemies >= 1, 'wave manager spawns enemies');

// Clearing the wave should enter the break phase and repair the core.
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.pendingSpawns = [];
  for (const enemy of game.enemies) {
    if (!enemy.dead) {
      enemy.invulnerable = false;
      enemy.takeDamage(999, 'body', game);
    }
  }
  game.updateWave(0.016);
});
let breakState = await page.evaluate(() => ({
  phase: window.__ORANGE_GAME__.wavePhase,
  timer: window.__ORANGE_GAME__.waveTimer,
  core: window.__ORANGE_GAME__.world.core.health,
  coreMax: window.__ORANGE_GAME__.world.core.maxHealth,
  wave: window.__ORANGE_GAME__.currentWaveIndex,
}));
assert(breakState.phase === 'break', 'clearing wave enters break');
assert(breakState.timer > 5, 'break has a usable countdown');
assert(breakState.core >= breakState.coreMax, 'core is repaired between waves');

// Force next wave and verify second wave composition includes ranged units.
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.waveTimer = 0.001;
  game.updateWave(0.016);
});
wave = await page.evaluate(() => ({
  index: window.__ORANGE_GAME__.currentWaveIndex,
  total: window.__ORANGE_GAME__.waveTotal,
  types: window.__ORANGE_GAME__.pendingSpawns,
}));
assert(wave.index === 1, 'wave 2 starts after break');
assert(wave.total === 7, 'wave 2 has seven enemies configured');
assert(wave.types.includes('gunner'), 'wave 2 contains ranged gunners');

// Compound natural-language commands should create per-ally orders.
const commandResult = await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  const result = game.issueTextCommand('橙橙守住左边，闪闪从右边包抄');
  game.allies.forEach((ally) => ally.chooseGoal(game));
  return {
    result,
    orders: game.allies.map((ally) => ({
      name: ally.name,
      intent: ally.order,
      side: ally.orderSide,
      goalX: Math.round(ally.goal.x * 10) / 10,
      goalZ: Math.round(ally.goal.z * 10) / 10,
    })),
  };
});
assert(commandResult.result.ok, 'compound Chinese command parses');
assert(commandResult.orders[0].intent === 'defend' && commandResult.orders[0].side === 'left', '橙橙 gets defend-left order');
assert(commandResult.orders[1].intent === 'flank' && commandResult.orders[1].side === 'right', '闪闪 gets flank-right order');
assert(commandResult.orders[0].goalX < -3, 'defend-left goal shifts to west side');

// Memory is recorded when the core is hit and is surfaced to the player.
const memory = await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.damageCore(7, { spawnSide: 'east' });
  return {
    leakEast: game.allies[0].memory.leaks.east,
    suggestion: game.allies[0].waveSuggestion(2, game),
  };
});
assert(memory.leakEast > 0, 'core hit records the attack side in ally memory');
assert(memory.suggestion.includes('东侧'), 'ally memory suggestion references the weak side');

// Clear wave 2, then wave 3 and victory.
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.pendingSpawns = [];
  for (const enemy of game.enemies) {
    if (!enemy.dead) {
      enemy.invulnerable = false;
      enemy.takeDamage(999, 'body', game);
    }
  }
  game.updateWave(0.016);
  game.waveTimer = 0.001;
  game.updateWave(0.016);
});
let wave3 = await page.evaluate(() => ({
  index: window.__ORANGE_GAME__.currentWaveIndex,
  phase: window.__ORANGE_GAME__.wavePhase,
  total: window.__ORANGE_GAME__.waveTotal,
  types: window.__ORANGE_GAME__.pendingSpawns,
}));
assert(wave3.index === 2, 'wave 3 starts');
assert(wave3.total === 7, 'wave 3 has seven enemies configured');
assert(wave3.types.includes('elite'), 'wave 3 includes the elite');

await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.pendingSpawns = [];
  for (const enemy of game.enemies) {
    if (!enemy.dead) {
      enemy.invulnerable = false;
      enemy.takeDamage(999, 'body', game);
    }
  }
  game.updateWave(0.016);
  game.waveTimer = 0.001;
  game.updateWave(0.016);
});
await page.waitForTimeout(600);
const victoryState = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  victory: window.__ORANGE_GAME__.victory,
  resultVisible: !document.getElementById('result-screen').classList.contains('hidden'),
  title: document.getElementById('result-title').textContent,
  grade: document.getElementById('result-grade').textContent,
}));
assert(victoryState.state === 'result', 'clearing all three waves ends the run');
assert(victoryState.victory === true, 'all three waves produce victory');
assert(victoryState.resultVisible, 'victory screen is visible');
assert(victoryState.title.includes('守住'), 'victory title is correct');
await page.screenshot({ path: `${outDir}/06-victory.png` });

// Direct ray-shot integration: put a target in front and empty the magazine into it.
const shot = await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.startRun();
  game.wavePhase = 'idle';
  game.waveTimer = 999;
  game.spawnEnemy('runner');
  const enemy = game.enemies[0];
  enemy.position.set(0, 0, 8);
  enemy.group.position.copy(enemy.position);
  enemy.invulnerable = false;
  enemy.spawnTimer = 0;
  enemy.group.scale.setScalar(1);
  game.player.position.set(0, 0, 13.2);
  game.player.yaw = 0;
  game.player.pitch = -0.13;
  game.player.update(0.016, game, { keys: new Set(), mouseDown: false });
  enemy.group.updateMatrixWorld(true);
  game.scene.updateMatrixWorld(true);
  const origin = game.camera.getWorldPosition(new (game.camera.position.constructor)());
  const direction = game.player.getForward(new (game.camera.position.constructor)());
  for (let i = 0; i < 4; i += 1) {
    game.player.fireCooldown = 0;
    const shot = game.player.tryShoot();
    if (shot) game.handlePlayerShot(shot.origin, shot.direction);
  }
  return {
    kills: game.kills,
    enemyDead: enemy.dead,
    shotsFired: game.shotsFired,
    shotsHit: game.shotsHit,
    ammo: game.player.ammo,
  };
});
assert(shot.enemyDead, 'raycast shots can kill a target');
assert(shot.kills >= 1, 'kill count increments');
assert(shot.shotsHit >= 1 && shot.shotsFired >= 1, 'accuracy counters update');
assert(shot.ammo < 30, 'shooting consumes ammo');

// Defeat path: a destroyed core ends the run.
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.startRun();
  game.wavePhase = 'combat';
  game.currentWaveIndex = 0;
  game.damageCore(999);
});
await page.waitForTimeout(300);
const defeatState = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  victory: window.__ORANGE_GAME__.victory,
  title: document.getElementById('result-title').textContent,
}));
assert(defeatState.state === 'result' && defeatState.victory === false, 'destroyed core ends in defeat');
assert(defeatState.title.includes('失守'), 'defeat title is correct');
await page.screenshot({ path: `${outDir}/07-defeat.png` });

assert(errors.length === 0, 'no browser errors during full flow');
console.log('FAILURES', failures);
console.log('BROWSER_ERRORS', errors);
await browser.close();
if (failures.length > 0) process.exitCode = 1;
