// 生成 README / 提交材料用的定版截图（1440x900）。
// 用法：先 `node server.mjs`，再 `node checks/shots.mjs`
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.URL || 'http://127.0.0.1:8790/';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const outDir = `${root}screenshots`;
fs.mkdirSync(outDir, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ORANGE_GAME__);
await page.waitForTimeout(700);

await page.screenshot({ path: `${outDir}/01-title.png` });

await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(900);

// 摆一个紧凑的交战场景：三种敌人、两名队友、核心受损
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.wavePhase = 'idle';
  game.waveTimer = 999;
  game.currentWaveIndex = 0;
  const placements = [
    ['runner', -2.6, 5.2],
    ['runner', 4.6, 6.4],
    ['gunner', -5.8, 2.3],
    ['gunner', 6.5, 2.8],
    ['elite', 0.8, 3.3],
    ['runner', 8.1, 8.2],
  ];
  for (const [type, x, z] of placements) {
    game.spawnEnemy(type);
    const enemy = game.enemies.at(-1);
    enemy.position.set(x, 0, z);
    enemy.group.position.copy(enemy.position);
    enemy.group.scale.setScalar(1);
    enemy.spawnTimer = 0;
    enemy.invulnerable = true;
    enemy.group.rotation.y = Math.PI;
    enemy.health = Math.max(1, enemy.maxHealth * 0.65);
    enemy.healthBar.sprite.visible = enemy.type !== 'runner';
    enemy.update = () => {};
  }
  game.allies[0].position.set(-3.9, 0, 10.2);
  game.allies[0].group.position.copy(game.allies[0].position);
  game.allies[0].group.rotation.y = Math.PI;
  game.allies[1].position.set(4.2, 0, 9.4);
  game.allies[1].group.position.copy(game.allies[1].position);
  game.allies[1].group.rotation.y = Math.PI;
  game.player.position.set(0, 0, 13.2);
  game.player.yaw = 0;
  game.player.pitch = -0.035;
  game.player.update(0.016, game, { keys: new Set(), mouseDown: false });
  game.camera.updateMatrixWorld(true);
  game.ui.hideBanner();
  game.ui.setWave('第 1 波 / 3', '探路者', 0.56, '剩余敌人 6 / 12');
  game.ui.setHealth(82, 100);
  game.ui.setCore(132, 160);
  game.ui.setScore(1240);
  game.ui.updateAllies(game.allies);
  game.ui.allySpeak('橙橙', '左侧压力上来了，我先拦。', 'orange');
  game.ui.allySpeak('闪闪', '我从外圈找角度。', 'teal');
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/02-combat.png` });

// 一句自然语言指令拆成两条不同站位的命令
await page.evaluate(() => {
  const game = window.__ORANGE_GAME__;
  game.issueTextCommand('橙橙守住左边，闪闪从右边包抄');
  game.ui.showBanner(
    {
      kicker: 'TACTICAL UPDATE',
      title: '指令已执行',
      subtitle: 'AI 队友正在改变站位。',
      brief: '橙橙：守核 / 左侧 · 闪闪：包抄 / 右侧',
    },
    6000,
  );
});
await page.waitForTimeout(750);
await page.screenshot({ path: `${outDir}/03-command.png` });

// 结算界面
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
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/04-result.png` });

console.log('ERRORS', JSON.stringify(errors));
await browser.close();
