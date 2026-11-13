// 一键把《橘光行动》部署到魔搭创空间（Docker 空间）。
// 严格按官方技能文档 https://modelscope.cn/skills/modelscope/ModelScope-Studio 的
// 「完整部署工作流」实现：建空间 → 配 SDK → git 同步 master → 触发部署 → 轮询日志。
//
// 用法：
//   export MODELSCOPE_API_KEY=你的令牌      # https://modelscope.cn/my/myaccesstoken
//   node scripts/deploy.mjs
//
// 常用参数：
//   --repo=orange-protocol   空间名（默认取 package 目录名）
//   --visibility=private     建空间时的可见性：private | protected
//   --skip-push              只建空间/改设置，不推代码
//   --skip-deploy            不触发部署
//   --no-wait                不轮询构建与运行状态
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENDPOINT = (process.env.MODELSCOPE_ENDPOINT || 'https://modelscope.cn').replace(/\/+$/, '');
const API = `${ENDPOINT}/openapi/v1`;
const TOKEN = process.env.MODELSCOPE_API_KEY || '';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);

const REPO = args.get('repo') || 'orange-protocol';
const VISIBILITY = args.get('visibility') || 'private';
const HARDWARE = 'platform/2v-cpu-8g-mem'; // 当前唯一免费档位
const DISPLAY_NAME = '橘光行动 · AI 协防';
const SDK_TYPE = 'docker';

const log = (...parts) => console.log(...parts);
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

if (!TOKEN) {
  fail(
    '缺少 MODELSCOPE_API_KEY。\n'
    + '  1) 打开 https://modelscope.cn/my/myaccesstoken 复制令牌\n'
    + '  2) export MODELSCOPE_API_KEY=你的令牌\n'
    + '  3) 重新运行 node scripts/deploy.mjs',
  );
}

const redact = (text) => String(text).split(TOKEN).join('<token>');

async function api(method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 日志接口可能直接返回文本 */
  }
  return { ok: response.ok, status: response.status, json, text };
}

function git(gitArgs, options = {}) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: options.quiet ? 'pipe' : 'inherit',
      ...options,
    });
  } catch (error) {
    if (options.allowFail) return null;
    throw error;
  }
}

function tail(text, lines = 12) {
  return redact(text).trim().split('\n').slice(-lines).join('\n');
}

// ---------------------------------------------------------------- 身份

log('▸ 校验令牌');
const me = await api('GET', '/users/me');
if (!me.ok) fail(`令牌无效（HTTP ${me.status}）：${tail(me.text, 3)}`);
const OWNER = args.get('owner') || me.json?.data?.username || me.json?.data?.name || me.json?.data?.login;
if (!OWNER) fail(`拿不到用户名，接口返回：${tail(me.text, 4)}`);
log(`  身份 ${OWNER}`);

const SLUG = `${OWNER}/${REPO}`;

// ---------------------------------------------------------------- 空间

log(`\n▸ 检查空间 ${SLUG}`);
const existing = await api('GET', `/studios/${SLUG}`);
const exists = existing.ok;

if (!exists) {
  log(`  不存在，创建（${SDK_TYPE} / ${HARDWARE} / ${VISIBILITY}）`);
  const created = await api('POST', '/studios', {
    owner: OWNER,
    repo_name: REPO,
    sdk_type: SDK_TYPE,
    visibility: VISIBILITY,
    hardware: HARDWARE,
    display_name: DISPLAY_NAME,
  });
  if (!created.ok) fail(`创建失败（HTTP ${created.status}）：${tail(created.text, 6)}`);
} else {
  log(`  已存在：${existing.json?.data?.status || '未知状态'}`);
}

// sdk_type / hardware 改动需要重新部署才生效，这里每次都对齐一次，保证幂等
log('  对齐 SDK 设置');
const patched = await api('PATCH', `/studios/${SLUG}/settings`, {
  sdk_type: SDK_TYPE,
  hardware: HARDWARE,
});
if (!patched.ok) log(`  ⚠ 设置未更新（HTTP ${patched.status}）：${tail(patched.text, 4)}`);

// ---------------------------------------------------------------- 代码同步

if (!args.has('skip-push')) {
  log('\n▸ 同步代码到空间仓库（master）');
  const remoteUrl = `https://oauth2:${TOKEN}@${ENDPOINT.replace(/^https?:\/\//, '')}/studios/${SLUG}.git`;

  git(['remote', 'remove', 'modelscope'], { quiet: true, allowFail: true });
  git(['remote', 'add', 'modelscope', remoteUrl], { quiet: true });
  log('  远端已配置');

  // 空间仓库建好时自带一条初始提交，与本地历史无关，需要 --allow-unrelated-histories
  const fetched = git(['fetch', 'modelscope', 'master'], { quiet: true, allowFail: true });
  if (fetched === null) {
    log('  ⚠ 拉取远端失败，按空仓库处理');
  } else {
    const merged = git(
      ['merge', 'modelscope/master', '--allow-unrelated-histories', '-m', '合并空间仓库初始提交'],
      { quiet: true, allowFail: true },
    );
    if (merged === null) {
      log('  合并有冲突，保留本地版本');
      git(['checkout', '--ours', '.'], { quiet: true, allowFail: true });
      git(['add', '-A'], { quiet: true });
      git(['commit', '-m', '解决冲突，保留本地版本'], { quiet: true, allowFail: true });
    }
  }

  git(['add', '-A'], { quiet: true });
  git(['commit', '-m', 'Deploy to ModelScope Studio'], { quiet: true, allowFail: true });
  log('  推送中…');
  try {
    git(['push', '-u', 'modelscope', 'master'], { quiet: true });
  } catch (error) {
    fail(`推送失败：\n${tail(error.stderr || error.message, 10)}`);
  }
  log('  推送完成');
}

// ---------------------------------------------------------------- 部署

if (!args.has('skip-deploy')) {
  log('\n▸ 触发部署');
  const deployed = await api('POST', `/studios/${SLUG}/deploy`);
  if (!deployed.ok) fail(`部署请求失败（HTTP ${deployed.status}）：${tail(deployed.text, 6)}`);
  log('  已提交构建');
}

// ---------------------------------------------------------------- 轮询

if (!args.has('no-wait') && !args.has('skip-deploy')) {
  log('\n▸ 等待构建与启动（最多 12 分钟）');
  const deadline = Date.now() + 12 * 60 * 1000;
  let lastBuild = '';
  let lastRun = '';

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15000));

    const build = await api('GET', `/studios/${SLUG}/logs/build`);
    const buildText = build.json?.data ? JSON.stringify(build.json.data) : build.text;
    if (buildText && buildText !== lastBuild) {
      lastBuild = buildText;
      log(`  [build] ${tail(buildText, 6)}`);
    }

    const info = await api('GET', `/studios/${SLUG}`);
    const status = info.json?.data?.status || 'Unknown';
    log(`  状态：${status}`);

    if (status === 'Running') {
      const run = await api('GET', `/studios/${SLUG}/logs/run`);
      const runText = run.json?.data ? JSON.stringify(run.json.data) : run.text;
      if (runText) log(`  [run] ${tail(runText, 6)}`);
      break;
    }

    if (/Failed|Error|Stopped/i.test(status)) {
      const run = await api('GET', `/studios/${SLUG}/logs/${/Failed|Error/i.test(status) ? 'build' : 'run'}`);
      lastRun = run.json?.data ? JSON.stringify(run.json.data) : run.text;
      fail(`部署失败，状态 ${status}\n${tail(lastRun, 20)}`);
    }
  }
}

// ---------------------------------------------------------------- 验收

const final = await api('GET', `/studios/${SLUG}`);
const data = final.json?.data || {};
log('\n────────────────────────────────────────');
log(`空间页： ${ENDPOINT}/studios/${SLUG}`);
log(`直链：   ${data.host || `https://${OWNER}-${REPO}.ms.show`}`);
log(`状态：   ${data.status || '未知'}`);
log(`可见性： ${data.visibility || VISIBILITY}`);

if (data.host) {
  try {
    const response = await fetch(data.host, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36' },
    });
    if (response.status === 401 || response.status === 403) {
      // protected / private 空间不对匿名请求开放；已确认在线的公开空间用 curl 同样是 403，
      // 所以这里不是"没起来"，验收必须在带登录态的浏览器里做。
      // 平台在响应体里会给出 API 专用地址，但那个地址同样要令牌（匿名 401），别拿它当探针。
      log(`直链自检：HTTP ${response.status}（${data.visibility || VISIBILITY} 空间拒绝匿名访问，属正常）`);
      log('          请用浏览器登录后打开空间页验收，不要用 curl 判断死活。');
    } else {
      const html = await response.text();
      const looksRight = /橘光行动/.test(html);
      log(`直链自检：HTTP ${response.status}${looksRight ? ' · 命中「橘光行动」' : ' · 未命中标题，可能还在启动'}`);
    }
  } catch (error) {
    log(`直链自检：失败（${redact(error.message)}）`);
  }
}
log('提示：创空间页面会以跨域 iframe 播放，指针锁定拿不到，游戏已自动降级为右键拖动视角。');
