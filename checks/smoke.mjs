import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.URL || 'http://127.0.0.1:8790/';
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
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
page.setDefaultTimeout(10000);
const logs = [];
const errors = [];
page.on('console', (message) => {
  logs.push(`${message.type()}: ${message.text()}`);
  if (message.type() === 'error') {
    errors.push(message.text());
    console.log('CONSOLE_ERROR', message.text());
  }
});
page.on('pageerror', (error) => {
  errors.push(`PAGEERROR: ${error.message}`);
  console.log('PAGEERROR', error.message);
});
page.on('requestfailed', (request) => {
  errors.push(`REQUESTFAIL: ${request.url()} ${request.failure()?.errorText}`);
  console.log('REQUESTFAIL', request.url(), request.failure()?.errorText);
});
page.on('crash', () => console.log('PAGE_CRASHED'));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ORANGE_GAME__, null, { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/01-start.png`, fullPage: false });

const boot = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  enemies: window.__ORANGE_GAME__.enemies.length,
  allies: window.__ORANGE_GAME__.allies.length,
  canvas: [window.__ORANGE_GAME__.renderer.domElement.width, window.__ORANGE_GAME__.renderer.domElement.height],
}));
console.log('BOOT', boot);

await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/02-hud.png` });
const playing = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  locked: document.pointerLockElement === window.__ORANGE_GAME__.canvas,
  wavePhase: window.__ORANGE_GAME__.wavePhase,
}));
console.log('PLAYING', playing);

await page.keyboard.press('2');
await page.evaluate(() => {
  window.__ORANGE_GAME__.waveTimer = 0.001;
});
await page.waitForTimeout(3200);
await page.screenshot({ path: `${outDir}/03-combat.png` });
const combat = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  wave: window.__ORANGE_GAME__.currentWaveIndex,
  phase: window.__ORANGE_GAME__.wavePhase,
  enemies: window.__ORANGE_GAME__.enemies.map((enemy) => ({
    type: enemy.type,
    alive: enemy.alive,
    x: Math.round(enemy.position.x),
    z: Math.round(enemy.position.z),
  })),
  allyOrders: window.__ORANGE_GAME__.allies.map((ally) => ({ name: ally.name, order: ally.order, side: ally.orderSide })),
  core: window.__ORANGE_GAME__.world.core.health,
}));
console.log('COMBAT', JSON.stringify(combat));

await page.keyboard.press('KeyT');
await page.waitForTimeout(300);
const radioOpen = await page.evaluate(() => !document.getElementById('radio-modal').classList.contains('hidden'));
console.log('RADIO', radioOpen);
if (radioOpen) {
  await page.fill('#radio-input', '橙橙守住左边，闪闪从右边包抄');
  await page.click('#radio-form .send-button');
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${outDir}/04-command.png` });
}
const afterCommand = await page.evaluate(() => ({
  state: window.__ORANGE_GAME__.state,
  locked: document.pointerLockElement === window.__ORANGE_GAME__.canvas,
  orders: window.__ORANGE_GAME__.allies.map((ally) => ({
    name: ally.name,
    order: ally.order,
    side: ally.orderSide,
  })),
  history: window.__ORANGE_GAME__.commandHistory,
  dialogue: document.querySelectorAll('.dialogue').length,
}));
console.log('AFTER_COMMAND', JSON.stringify(afterCommand));

await page.mouse.click(720, 450);
await page.waitForTimeout(500);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/05-shooting.png` });
const shotState = await page.evaluate(() => ({
  ammo: window.__ORANGE_GAME__.player.ammo,
  shotsFired: window.__ORANGE_GAME__.shotsFired,
  shotsHit: window.__ORANGE_GAME__.shotsHit,
  score: window.__ORANGE_GAME__.score,
  gameState: window.__ORANGE_GAME__.state,
}));
console.log('SHOT', shotState);

console.log('ERRORS', errors);
console.log('LOG_COUNT', logs.length);
await browser.close();
if (errors.length) process.exitCode = 1;
