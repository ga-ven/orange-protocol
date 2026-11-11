// 大模型链路端到端检查。
//
// 覆盖三件事：
//   1. 服务端有没有把令牌藏住（前端只看到 enabled/model，看不到 key）
//   2. 结算页的「队友复盘」能不能被模型生成的内容替换
//   3. 波次提醒、兜底解析能不能真的作用到游戏里
//
// 两种运行方式都支持：
//   没配令牌 → 断言"优雅降级"：enabled=false，页面照常用本地模板
//   配了令牌 → 断言"真的用到模型"：文案被替换、解析落到六种意图之一
//
// 用法：先起服务（带或不带 MODELSCOPE_API_KEY），再
//   URL=http://127.0.0.1:8796/ node checks/npc.mjs
import { chromium } from 'playwright';

const url = process.env.URL || 'http://127.0.0.1:8796/';
const failures = [];
const notes = [];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

// ---------------------------------------------------------------- 1. 探测
await page.goto(url, { waitUntil: 'networkidle' });
const probe = await page.evaluate(async () => {
  const response = await fetch('/api/npc');
  return { status: response.status, body: await response.json() };
});
const enabled = Boolean(probe.body && probe.body.enabled);
notes.push(`服务端状态：HTTP ${probe.status} · enabled=${enabled} · model=${probe.body?.model || '-'}`);
if (JSON.stringify(probe.body).includes('ms-')) {
  failures.push('探测接口把令牌泄露出去了');
}

await page.waitForFunction(() => window.__ORANGE_GAME__);
await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(600);

// ---------------------------------------------------------------- 2. 波次提醒
const banter = await page.evaluate(async () => {
  const game = window.__ORANGE_GAME__;
  const ally = game.allies[0];
  const before = ally.lastSaidText;
  game.requestBanter(ally, 2);
  for (let i = 0; i < 150; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (ally.lastSaidText && ally.lastSaidText !== before) {
      return { changed: true, text: ally.lastSaidText, elapsedMs: (i + 1) * 100 };
    }
  }
  return { changed: false, text: ally.lastSaidText, elapsedMs: 15000 };
});
if (enabled) {
  if (!banter.changed) failures.push('配了令牌但波次提醒没有落到队友嘴里');
  else notes.push(`波次提醒（${banter.elapsedMs}ms）：${banter.text}`);
} else if (banter.changed) {
  notes.push(`未配令牌，队友仍用本地台词：${banter.text}`);
}

// ---------------------------------------------------------------- 3. 兜底解析
const parseResult = await page.evaluate(async () => {
  const game = window.__ORANGE_GAME__;
  const { parseLocalCommand } = await import('/src/ai.js');
  // 挑一句本地解析一定失败的话，确认模型兜底真的会触发
  const candidates = [
    '这波有点顶不住了你们看着办',
    '别在中间杵着了，绕后面去把那个大的拖住',
    '你俩别傻站着了',
  ];
  let text = candidates.find((candidate) => !parseLocalCommand(candidate).ok);
  if (!text) return { skipped: true };
  const localFailed = !parseLocalCommand(text).ok;
  // 判据用 commandCount 而不是 ally.order：模型可能选到和当前一样的指令，
  // 那种情况下 order 不变，但命令确实执行了（之前就是这么误报的）。
  const beforeCount = game.commandCount;
  const reply = game.issueTextCommand(text);
  for (let i = 0; i < 150; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (game.commandCount > beforeCount) {
      return {
        text,
        localFailed,
        applied: true,
        elapsedMs: (i + 1) * 100,
        orders: game.allies.map((ally) => ally.order),
        source: game.brain.lastSource,
        localReply: reply?.ok,
      };
    }
  }
  return { text, localFailed, applied: false, source: game.brain.lastSource, localReply: reply?.ok };
});
if (parseResult.skipped) {
  notes.push('兜底解析：没找到本地必挂的句子，本项跳过');
} else if (enabled) {
  if (!parseResult.applied) failures.push(`兜底解析没生效：${parseResult.text}`);
  else {
    notes.push(
      `兜底解析（${parseResult.elapsedMs}ms）：${parseResult.text} → ${parseResult.orders.join(' / ')} · source=${parseResult.source}`,
    );
    if (!['follow', 'defend', 'flank', 'focus', 'retreat', 'hold'].includes(parseResult.orders[0])) {
      failures.push(`兜底解析落到了非白名单指令：${parseResult.orders[0]}`);
    }
  }
}

// ---------------------------------------------------------------- 4. 结算复盘
const debrief = await page.evaluate(async () => {
  const game = window.__ORANGE_GAME__;
  const before = document.querySelector('#result-insight p')?.textContent || '';
  game.endGame(true);
  const label = () => document.querySelector('#result-insight span')?.textContent || '';
  const body = () => document.querySelector('#result-insight p')?.textContent || '';
  for (let i = 0; i < 320; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (label().includes('大模型')) return { replaced: true, label: label(), text: body(), elapsedMs: (i + 1) * 100 };
  }
  return { replaced: false, label: label(), text: body(), before, elapsedMs: 32000 };
});
if (enabled) {
  if (!debrief.replaced) failures.push('配了令牌但结算复盘没有被模型内容替换');
  else {
    notes.push(`结算复盘（${debrief.elapsedMs}ms）：${debrief.text}`);
    if (debrief.text.length > 121) failures.push(`复盘文案超长（${debrief.text.length} 字）`);
    if (/[<>]/.test(debrief.text)) failures.push('复盘文案里混进了尖括号');
  }
} else {
  if (!debrief.text) failures.push('没配令牌时结算页连本地模板都没了');
  if (debrief.label.includes('大模型')) failures.push('没配令牌却标注成大模型生成');
  else notes.push(`未配令牌，结算走本地模板：${debrief.text}`);
}

await browser.close();

// ---------------------------------------------------------------- 输出
console.log('────────────────────────────────────────');
for (const note of notes) console.log(`· ${note}`);
if (errors.length) console.log(`BROWSER_ERRORS ${JSON.stringify(errors.slice(0, 5))}`);
if (failures.length) {
  console.log('FAILURES');
  for (const failure of failures) console.log(`  × ${failure}`);
  process.exitCode = 1;
} else {
  console.log('OK：大模型只做"会说话"和"兜底解析"，两处降级路径都正常');
}
