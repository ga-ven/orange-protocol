const INTENT_PATTERNS = [
  {
    intent: 'retreat',
    confidence: 0.97,
    patterns: [
      /(撤退|撤离|退回来|先撤|快撤|撤一下|回防|回能|回血|别硬撑|保命|退后|退到核心|都回来|回来)/,
      /(fall\s*back|retreat|regroup|heal)/i,
    ],
  },
  {
    intent: 'focus',
    confidence: 0.95,
    patterns: [
      /(集火|优先打|优先处理|先打|锁定|瞄准|攻击|干掉|解决|打掉|打那个|打他|打它|别管别的)/,
      /(focus|shoot|attack|target)/i,
    ],
  },
  {
    intent: 'flank',
    confidence: 0.94,
    patterns: [
      /(包抄|侧翼|绕后|绕侧|绕到|侧面|侧边|偷袭|夹击|拉开|从旁边)/,
      /(flank|side|ambush|circle)/i,
    ],
  },
  {
    intent: 'hold',
    confidence: 0.92,
    patterns: [
      /(待命|原地|停在|停住|别动|站着|守在这里|守在这|留在这里|守住这里|不要追)/,
      /(hold|stay|wait|stand\s*by)/i,
    ],
  },
  {
    intent: 'defend',
    confidence: 0.94,
    patterns: [
      /(守核心|守住核心|防守|保护核心|护住|回核心|守家|看住核心|守住|防守点|守点|守左边|守右边)/,
      /(defend|guard|protect)/i,
    ],
  },
  {
    intent: 'follow',
    confidence: 0.91,
    patterns: [
      /(跟我|跟随|跟着|贴着我|靠近我|过来|别离我太远|一起走|随我)/,
      /(follow|with\s*me|come\s*here)/i,
    ],
  },
];

const SIDE_PATTERNS = [
  { id: 'left', pattern: /(左边|左侧|左翼|左手边|往左|去左)/ },
  { id: 'right', pattern: /(右边|右侧|右翼|右手边|往右|去右)/ },
  { id: 'front', pattern: /(前面|前方|正面|往前)/ },
  { id: 'back', pattern: /(后面|后方|背后|往后)/ },
];

const ENEMY_PATTERNS = [
  { id: 'elite', pattern: /(大块头|精英|重装|守卫|大个子|boss)/i },
  { id: 'gunner', pattern: /(远程|炮台|泡泡炮|枪手|射手)/ },
  { id: 'runner', pattern: /(近战|蹦蹦虫|小怪|冲脸的)/ },
];

export function normalizeCommandText(text) {
  return String(text || '')
    .trim()
    .replace(/[，。！？、,.!?;；:："'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function detectIntent(text) {
  // Intent groups are ordered by tactical priority. First match wins, so
  // "守住这里" resolves to hold rather than the broader defend pattern.
  for (const group of INTENT_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(text)) {
        return { intent: group.intent, confidence: group.confidence };
      }
    }
  }
  return null;
}

function detectAllyName(text) {
  const hasOrange = /(橙橙|橙队|一号|小橙)/.test(text);
  const hasTeal = /(闪闪|闪队|二号|小闪)/.test(text);
  if (hasOrange && hasTeal) return null;
  if (hasOrange) return '橙橙';
  if (hasTeal) return '闪闪';
  return null;
}

function detectSide(text) {
  for (const entry of SIDE_PATTERNS) {
    if (entry.pattern.test(text)) return entry.id;
  }
  return null;
}

function detectEnemyType(text) {
  for (const entry of ENEMY_PATTERNS) {
    if (entry.pattern.test(text)) return entry.id;
  }
  return null;
}

function splitClauses(raw) {
  return raw
    .split(/[，,。；;！!？?\n]|然后|接着|随后|再(?=让|去|守|跟|包抄|集火|撤)/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function classifyClause(clause) {
  const normalized = normalizeCommandText(clause);
  const intent = detectIntent(normalized);
  if (!intent) return null;
  return {
    intent: intent.intent,
    confidence: intent.confidence,
    allyName: detectAllyName(normalized),
    side: detectSide(normalized),
    enemyType: detectEnemyType(normalized),
    text: clause,
  };
}

export function parseLocalCommand(text) {
  const raw = String(text || '').trim();
  const normalized = normalizeCommandText(raw);
  if (!normalized) {
    return {
      ok: false,
      reason: 'empty',
      message: '电台没有收到内容。说一句「守住核心」或「橙橙去包抄」试试。',
    };
  }

  let assignments = splitClauses(raw)
    .map(classifyClause)
    .filter(Boolean);

  if (assignments.length === 0) {
    const whole = classifyClause(raw);
    if (whole) assignments = [whole];
  }

  if (assignments.length === 0) {
    return {
      ok: false,
      reason: 'no_intent',
      message: '没听清战术意图。可以试试「跟我走」「守住左边」「集火大块头」或「都回来」。',
    };
  }

  // If several unnamed clauses are describing one order, the last clause is the
  // final instruction ("都回来，守住核心" resolves to defend).
  if (assignments.every((assignment) => !assignment.allyName) && assignments.length > 1) {
    assignments = [assignments[assignments.length - 1]];
  }

  // Multiple named clauses become per-ally assignments. The last order for the
  // same ally wins, matching how a radio call would be heard.
  if (assignments.some((assignment) => assignment.allyName)) {
    const byAlly = new Map();
    for (const assignment of assignments) {
      if (!assignment.allyName) continue;
      byAlly.set(assignment.allyName, assignment);
    }
    if (byAlly.size > 0) assignments = Array.from(byAlly.values());
  }

  const primary = assignments[0];
  return {
    ok: true,
    intent: primary.intent,
    confidence: Math.min(...assignments.map((assignment) => assignment.confidence)),
    allyName: assignments.length === 1 ? primary.allyName : null,
    side: primary.side,
    enemyType: primary.enemyType,
    assignments: assignments.map((assignment) => ({
      intent: assignment.intent,
      allyName: assignment.allyName,
      side: assignment.side,
      enemyType: assignment.enemyType,
      text: assignment.text,
      confidence: assignment.confidence,
    })),
    raw,
    normalized,
    source: 'local',
  };
}

export function describeParse(result) {
  if (!result || !result.ok) return '';
  const intentLabels = {
    follow: '跟随',
    defend: '守核',
    flank: '包抄',
    focus: '集火',
    retreat: '撤退',
    hold: '待命',
  };
  const sideLabels = { left: '左侧', right: '右侧', front: '前方', back: '后方' };
  const enemyLabels = { elite: '精英', gunner: '远程', runner: '近战' };
  const getDescription = (assignment) => {
    let description = intentLabels[assignment.intent] || assignment.intent;
    if (assignment.side) description += ` / ${sideLabels[assignment.side]}`;
    if (assignment.enemyType) description += ` / ${enemyLabels[assignment.enemyType] || assignment.enemyType}`;
    return description;
  };
  if (result.assignments && result.assignments.length > 1) {
    return result.assignments
      .map((assignment) => `${assignment.allyName || '全队'}：${getDescription(assignment)}`)
      .join(' · ');
  }
  const primary = result.assignments?.[0] || result;
  let description = getDescription(primary);
  if (primary.allyName) description = `${primary.allyName} · ${description}`;
  return description;
}

/**
 * The local parser is the guaranteed path. An optional remote endpoint can be
 * configured at runtime, but the game never stores a provider key in the browser.
 * The remote response is always reduced to the same whitelist used below.
 */
export class TacticalBrain {
  constructor() {
    this.mode = 'local';
    this.endpoint = null;
    this.lastSource = 'local';
  }

  setEndpoint(endpoint) {
    this.endpoint = endpoint || null;
    this.mode = endpoint ? 'hybrid' : 'local';
  }

  async parse(text, context = {}) {
    const local = parseLocalCommand(text);
    if (!this.endpoint) {
      this.lastSource = 'local';
      return local;
    }
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          allies: context.allies || [],
          wave: context.wave || 0,
          allowedIntents: ['follow', 'defend', 'flank', 'focus', 'retreat', 'hold'],
        }),
        signal: AbortSignal.timeout(1800),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const intent = String(data.intent || '');
      if (!['follow', 'defend', 'flank', 'focus', 'retreat', 'hold'].includes(intent)) {
        throw new Error('Intent outside whitelist');
      }
      const side = ['left', 'right', 'front', 'back'].includes(data.side) ? data.side : null;
      const enemyType = ['elite', 'gunner', 'runner'].includes(data.enemyType) ? data.enemyType : null;
      const allyName = data.allyName === '橙橙' || data.allyName === '闪闪' ? data.allyName : null;
      this.lastSource = 'remote';
      return {
        ok: true,
        intent,
        side,
        enemyType,
        allyName,
        confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0.8)),
        raw: text,
        source: 'remote',
        reply: typeof data.reply === 'string' ? data.reply.slice(0, 80) : '',
      };
    } catch (error) {
      this.lastSource = 'fallback';
      return { ...local, source: 'fallback', fallbackReason: error.message };
    }
  }
}

export function buildAllyReply(intent, allyIndex, side = null, enemyType = null) {
  const base = {
    follow: ['贴着你走，别把我甩太远。', '收到，跟上你的节奏。'],
    defend: ['回核心，站好防守位。', '核心交给我，你去看另一边。'],
    flank: ['我从侧面绕，给你拉角度。', '包抄路线收到，马上动。'],
    focus: ['集火收到，优先打掉它。', '锁定目标，我来补伤害。'],
    retreat: ['撤回来充能，不硬撑。', '收到，先保住自己。'],
    hold: ['原地待命，保持视野。', '停在这里，听你下一步。'],
  };
  const sideText = side === 'left' ? '左侧' : side === 'right' ? '右侧' : side === 'front' ? '正面' : side === 'back' ? '后方' : '';
  if (intent === 'defend' && sideText) {
    return `收到，${sideText}我来守。`;
  }
  if (intent === 'flank' && sideText) {
    return `我从${sideText}绕过去。`;
  }
  if (intent === 'focus' && enemyType === 'elite') {
    return '大块头交给我牵制，你打它的弱点。';
  }
  const choices = base[intent] || ['收到。', '明白。'];
  return choices[allyIndex % choices.length];
}
