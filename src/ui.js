import { CONFIG, INTENT_LABELS } from './config.js';

const $ = (id) => document.getElementById(id);

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.radioOpen = false;
    this.bannerTimer = null;
    this.dialogueTimers = new Map();
    this.lastAllySignature = '';
    this.lastCommand = null;
    this.muted = false;
    this.ammoTicksBuilt = false;

    this.el = {
      start: $('start-screen'),
      hud: $('hud'),
      pause: $('pause-screen'),
      radio: $('radio-modal'),
      result: $('result-screen'),
      startButton: $('start-button'),
      intelToggle: $('intel-toggle'),
      intelDrawer: $('intel-drawer'),
      openWindow: $('open-window'),
      lockFallback: $('lock-fallback'),
      lockFallbackOpen: $('lock-fallback-open'),
      muteStart: $('mute-start'),
      resume: $('resume-button'),
      restart: $('restart-button'),
      menu: $('menu-button'),
      resultAgain: $('again-button'),
      resultMenu: $('result-menu-button'),
      radioForm: $('radio-form'),
      radioInput: $('radio-input'),
      radioClose: $('radio-close'),
      radioHistory: $('radio-history'),
      quickButtons: Array.from(document.querySelectorAll('#quick-commands button')),
      suggestions: Array.from(document.querySelectorAll('.suggestion-row button')),
      skillButton: $('skill-button'),
      skillCooldown: $('skill-cooldown'),
      skillStatus: $('skill-status'),
      healthFill: $('health-fill'),
      healthValue: $('health-value'),
      healthState: $('health-state'),
      ammoValue: $('ammo-value'),
      ammoTicks: $('ammo-ticks'),
      reloadLabel: $('reload-label'),
      coreFill: $('core-fill'),
      coreValue: $('core-value'),
      corePercent: $('core-percent'),
      coreCard: document.querySelector('.core-card'),
      waveKicker: $('wave-kicker'),
      waveTitle: $('wave-title'),
      waveProgress: $('wave-progress-fill'),
      enemyCounter: $('enemy-counter'),
      score: $('score-value'),
      allyCards: $('ally-cards'),
      squadStatus: $('squad-status'),
      dialogueStack: $('dialogue-stack'),
      killFeed: $('kill-feed'),
      banner: $('wave-banner'),
      bannerKicker: $('banner-kicker'),
      bannerTitle: $('banner-title'),
      bannerSubtitle: $('banner-subtitle'),
      bannerBrief: $('banner-brief'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      interact: $('interact-prompt'),
      interactFill: $('interact-fill'),
      damageOverlay: $('damage-overlay'),
      minimap: $('minimap'),
      objective: $('objective-chip'),
      radioOpenButton: $('radio-open'),
      menuSceneLabel: $('menu-scene-label'),
      resultTitle: $('result-title'),
      resultSubtitle: $('result-subtitle'),
      resultEyebrow: $('result-eyebrow'),
      resultGrade: $('result-grade'),
      statWave: $('stat-wave'),
      statKills: $('stat-kills'),
      statAccuracy: $('stat-accuracy'),
      statCore: $('stat-core'),
      statCommands: $('stat-commands'),
      statTime: $('stat-time'),
      resultInsight: $('result-insight'),
    };

    this.bindEvents();
    this.setMuted(localStorage.getItem('orange-protocol-muted') === '1', false);
  }

  bindEvents() {
    this.el.startButton?.addEventListener('click', () => {
      this.game.audio.ensure();
      this.game.audio.startAmbient();
      this.game.startRun();
    });
    this.el.intelToggle?.addEventListener('click', () => {
      const open = this.el.intelDrawer.classList.toggle('open');
      this.el.intelDrawer.setAttribute('aria-hidden', String(!open));
      this.el.intelToggle.textContent = open ? '收起任务简报' : '查看任务简报';
      this.game.audio.uiClick();
    });
    // 嵌在 iframe 里时（例如魔搭创空间）指针锁定拿不到，全屏是 allow 列表里允许的，
    // 至少把画面撑满，配合右键拖动视角也能玩得像样
    const enterFullscreen = () => {
      const root = document.documentElement;
      const request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!request) return;
      try {
        const result = request.call(root);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch (error) {
        /* 全屏被拒不影响继续玩 */
      }
    };
    if (window.self !== window.top && this.el.openWindow) {
      this.el.openWindow.hidden = false;
      this.el.openWindow.addEventListener('click', enterFullscreen);
    }
    this.el.lockFallbackOpen?.addEventListener('click', enterFullscreen);
    this.el.muteStart?.addEventListener('click', () => this.toggleMute());
    this.el.resume?.addEventListener('click', () => this.game.resume());
    this.el.restart?.addEventListener('click', () => {
      this.game.audio.ensure();
      this.game.startRun();
    });
    this.el.menu?.addEventListener('click', () => this.game.toMenu());
    this.el.resultAgain?.addEventListener('click', () => {
      this.game.audio.ensure();
      this.game.startRun();
    });
    this.el.resultMenu?.addEventListener('click', () => this.game.toMenu());
    this.el.quickButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.game.quickCommand(button.dataset.intent);
      });
    });
    this.el.radioOpenButton?.addEventListener('click', () => this.openRadio());
    this.el.radioClose?.addEventListener('click', () => this.closeRadio(true));
    this.el.radioForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitRadio();
    });
    this.el.suggestions.forEach((button) => {
      button.addEventListener('click', () => {
        this.el.radioInput.value = button.dataset.command || '';
        this.el.radioInput.focus();
        this.el.radioInput.select();
      });
    });
    this.el.skillButton?.addEventListener('click', () => this.game.player.useSkill(this.game));
    this.el.radio?.addEventListener('mousedown', (event) => {
      if (event.target === this.el.radio) this.closeRadio(true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.code === 'KeyM' && !this.radioOpen) {
        this.toggleMute();
      }
    });
    window.addEventListener('beforeunload', () => {
      this.game.audio.setMuted(true);
    });
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  setMuted(muted, playFeedback = true) {
    this.muted = muted;
    this.game.audio.setMuted(muted);
    if (this.el.muteStart) this.el.muteStart.textContent = muted ? '声音：关' : '声音：开';
    localStorage.setItem('orange-protocol-muted', muted ? '1' : '0');
    if (!muted && playFeedback) {
      this.game.audio.ensure();
      this.game.audio.uiClick();
    }
  }

  showHud() {
    this.el.start.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.radio.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.menuSceneLabel.style.display = 'none';
    document.body.classList.add('is-playing');
  }

  // 指针锁定被浏览器拦截时（常见于 iframe 嵌入），提示改用拖拽视角
  showLockFallback() {
    this.el.lockFallback?.classList.remove('hidden');
  }

  showStart() {
    this.el.hud.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.radio.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.start.classList.remove('hidden');
    this.el.menuSceneLabel.style.display = '';
    document.body.classList.remove('is-playing');
    this.hideBanner();
    this.clearDialogues();
    this.clearKillFeed();
    this.closeRadio(false);
  }

  showPause() {
    this.el.pause.classList.remove('hidden');
  }

  hidePause() {
    this.el.pause.classList.add('hidden');
  }

  showResult(data) {
    this.el.hud.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.radio.classList.add('hidden');
    this.el.result.classList.remove('hidden');
    this.el.radioOpen = false;
    document.body.classList.remove('is-playing');
    this.el.menuSceneLabel.style.display = 'none';
    document.querySelector('.result-wrap')?.classList.toggle('defeat', !data.victory);
    this.el.resultEyebrow.textContent = data.victory ? 'MISSION COMPLETE' : 'MISSION FAILED';
    this.el.resultTitle.textContent = data.victory ? '防线守住了' : '核心失守';
    this.el.resultSubtitle.textContent = data.victory
      ? '你的队友把最后一句话记住了。'
      : '再试一次，把指令用在更关键的时刻。';
    this.el.resultGrade.textContent = data.grade;
    this.el.resultGrade.style.background = data.victory
      ? 'rgba(255, 248, 232, 0.12)'
      : 'rgba(95, 45, 27, 0.16)';
    this.el.statWave.textContent = `${data.waveReached} / ${data.waveTotal}`;
    this.el.statKills.textContent = String(data.kills);
    this.el.statAccuracy.textContent = `${data.accuracy}%`;
    this.el.statCore.textContent = `${data.corePercent}%`;
    this.el.statCommands.textContent = String(data.commands);
    this.el.statTime.textContent = formatTime(data.time);
    this.el.resultInsight.innerHTML = `
      <span>队友复盘</span>
      <p>${data.insight}</p>
    `;
  }

  setHealth(value, max) {
    const ratio = Math.max(0, Math.min(1, value / max));
    this.el.healthFill.style.width = `${ratio * 100}%`;
    this.el.healthValue.textContent = String(Math.ceil(value));
    this.el.healthState.textContent =
      value <= 0 ? '等待重新部署' : ratio < 0.3 ? '危险 · 寻找掩护' : ratio < 0.65 ? '护甲受损' : '状态稳定';
    this.el.healthFill.style.background =
      ratio < 0.3
        ? 'linear-gradient(90deg, #e65445, #ff9978)'
        : 'linear-gradient(90deg, var(--orange), #f6b364)';
  }

  setAmmo(ammo, max = CONFIG.weapon.magSize, reloading = false) {
    this.el.ammoValue.textContent = String(ammo).padStart(2, '0');
    if (!this.ammoTicksBuilt) {
      this.el.ammoTicks.innerHTML = Array.from({ length: max })
        .map(() => '<i class="ammo-tick"></i>')
        .join('');
      this.ammoTicksBuilt = true;
    }
    const ticks = Array.from(this.el.ammoTicks.children);
    ticks.forEach((tick, index) => {
      tick.classList.toggle('loaded', index < ammo);
    });
    this.el.reloadLabel.textContent = reloading ? '换弹中…' : ammo === 0 ? '弹匣空了 · 按 R' : 'R 换弹';
    this.el.reloadLabel.classList.toggle('active', reloading || ammo === 0);
  }

  setCore(value, max) {
    const ratio = Math.max(0, Math.min(1, value / max));
    this.el.coreFill.style.width = `${ratio * 100}%`;
    this.el.coreValue.textContent = String(Math.ceil(value));
    this.el.corePercent.textContent = `${Math.round(ratio * 100)}%`;
    this.el.coreCard.classList.toggle('danger', ratio > 0 && ratio < 0.3);
    this.el.coreFill.style.background =
      ratio < 0.3
        ? 'linear-gradient(90deg, #d94436, #ff8d73)'
        : ratio < 0.6
          ? 'linear-gradient(90deg, #e9862c, #ffc66f)'
          : 'linear-gradient(90deg, var(--orange), #ffb663)';
  }

  setWave(kicker, title, progress = 0, enemyText = '') {
    this.el.waveKicker.textContent = kicker;
    this.el.waveTitle.textContent = title;
    this.el.waveProgress.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    if (enemyText) this.el.enemyCounter.textContent = enemyText;
  }

  setEnemyCounter(text) {
    this.el.enemyCounter.textContent = text;
  }

  setScore(score) {
    this.el.score.textContent = String(score).padStart(4, '0');
  }

  setSkill(cooldown, max) {
    const ratio = Math.max(0, Math.min(1, cooldown / max));
    this.el.skillCooldown.style.transform = `scaleY(${ratio})`;
    this.el.skillButton.classList.toggle('cooling', cooldown > 0);
    this.el.skillButton.classList.toggle('ready', cooldown <= 0);
    this.el.skillStatus.textContent = cooldown <= 0 ? '就绪' : `${Math.ceil(cooldown)} 秒`;
  }

  setObjective(text) {
    const span = this.el.objective.querySelector('span');
    if (span) span.textContent = text;
  }

  updateAllies(allies) {
    const signature = allies
      .map((ally) => `${ally.name}-${ally.order}-${ally.downed}-${Math.ceil(ally.health / 10)}`)
      .join('|');
    if (signature === this.lastAllySignature) return;
    this.lastAllySignature = signature;
    this.el.allyCards.innerHTML = allies
      .map((ally) => {
        const healthRatio = Math.max(0, ally.health / ally.maxHealth) * 100;
        const order = ally.downed ? '失能' : INTENT_LABELS[ally.order] || '守核心';
        return `
          <div class="ally-card ${ally.color === 0xff7a2f ? 'orange' : 'teal'} ${ally.downed ? 'downed' : ''}">
            <div class="card-avatar">${ally.name.slice(0, 1)}</div>
            <div class="card-main">
              <div class="card-name">${ally.name}<em class="${ally.color === 0xff7a2f ? '' : 'teal'}">${ally.role}</em></div>
              <div class="card-health"><i style="width:${healthRatio}%"></i></div>
            </div>
            <span class="card-order ${ally.downed ? 'downed-label' : ''}">${order}</span>
          </div>
        `;
      })
      .join('');
    const active = allies.filter((ally) => !ally.downed).length;
    this.el.squadStatus.textContent = active === 0 ? '全员失能' : active === 1 ? '单兵协同' : '协同中';
  }

  updateCommandHighlight(intent) {
    const intents = Array.isArray(intent) ? intent : [intent];
    this.el.quickButtons.forEach((button) => {
      button.classList.toggle('active', intents.includes(button.dataset.intent));
    });
  }

  showBanner(data, duration = 3200) {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.el.bannerKicker.textContent = data.kicker || '行动更新';
    this.el.bannerTitle.textContent = data.title || '';
    this.el.bannerSubtitle.textContent = data.subtitle || '';
    this.el.bannerBrief.textContent = data.brief || '';
    this.el.bannerBrief.style.display = data.brief ? 'inline-block' : 'none';
    this.el.banner.classList.remove('hidden');
    this.bannerTimer = setTimeout(() => {
      this.el.banner.classList.add('hidden');
      this.bannerTimer = null;
    }, duration);
  }

  hideBanner() {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = null;
    this.el.banner.classList.add('hidden');
  }

  allySpeak(name, text, color = 'orange') {
    if (!text) return;
    if (this.el.dialogueStack.children.length >= 3) {
      this.el.dialogueStack.firstElementChild?.remove();
    }
    const item = document.createElement('div');
    item.className = `dialogue ${color}`;
    item.innerHTML = `
      <div class="dialogue-avatar">${name.slice(0, 1)}</div>
      <b>${name}</b>
      <span>${this.escapeHtml(text)}</span>
    `;
    this.el.dialogueStack.appendChild(item);
    const timer = setTimeout(() => {
      item.classList.add('fading');
      setTimeout(() => item.remove(), 260);
      this.dialogueTimers.delete(item);
    }, 4600);
    this.dialogueTimers.set(item, timer);
  }

  systemSay(text, name = '指挥部') {
    this.allySpeak(name, text, 'orange');
  }

  clearDialogues() {
    for (const timer of this.dialogueTimers.values()) clearTimeout(timer);
    this.dialogueTimers.clear();
    if (this.el.dialogueStack) this.el.dialogueStack.innerHTML = '';
  }

  killFeed(text, tag = 'AI 队友') {
    const line = document.createElement('div');
    line.className = 'kill-line';
    line.innerHTML = `<i></i><b>${this.escapeHtml(tag)}</b><span>${this.escapeHtml(text)}</span>`;
    this.el.killFeed.appendChild(line);
    while (this.el.killFeed.children.length > 4) {
      this.el.killFeed.removeChild(this.el.killFeed.firstElementChild);
    }
    setTimeout(() => {
      line.classList.add('fading');
      setTimeout(() => line.remove(), 300);
    }, 3200);
  }

  clearKillFeed() {
    if (this.el.killFeed) this.el.killFeed.innerHTML = '';
  }

  hitMarker(headshot = false) {
    const marker = this.el.hitmarker;
    marker.classList.remove('show', 'headshot');
    void marker.offsetWidth;
    marker.classList.add('show');
    if (headshot) marker.classList.add('headshot');
  }

  damageFlash() {
    const overlay = this.el.damageOverlay;
    overlay.classList.add('flash');
    clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => overlay.classList.remove('flash'), 90);
  }

  showRevivePrompt(show, name = '', progress = 0) {
    this.el.interact.classList.toggle('hidden', !show);
    if (show) {
      const span = this.el.interact.querySelector('span');
      if (span) span.textContent = `${name || '队友'}失去行动能力 · 按住 E 扶起`;
      this.el.interactFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    } else {
      this.el.interactFill.style.width = '0%';
    }
  }

  setInteractProgress(progress) {
    this.el.interactFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  openRadio() {
    if (this.radioOpen || this.game.state !== 'playing') return;
    this.radioOpen = true;
    this.el.radio.classList.remove('hidden');
    this.game.enterRadioMode();
    this.el.radioInput.value = '';
    this.populateRadioHistory();
    setTimeout(() => this.el.radioInput.focus(), 60);
  }

  populateRadioHistory() {
    const history = this.game.commandHistory.slice(-3);
    this.el.radioHistory.innerHTML = history.length
      ? history
          .map(
            (entry) =>
              `<div class="history-line"><b>你：</b>${this.escapeHtml(entry.text)} <span>→ ${entry.resultText || '已解析'}</span></div>`,
          )
          .join('')
      : '<div class="history-line">本地 AI 在线。你的指令会先被解析成意图，再由规则系统执行。</div>';
  }

  closeRadio(resume = true) {
    if (!this.radioOpen) {
      this.el.radio.classList.add('hidden');
      return;
    }
    this.radioOpen = false;
    this.el.radio.classList.add('hidden');
    if (resume) this.game.leaveRadioMode();
  }

  submitRadio() {
    const text = this.el.radioInput.value.trim();
    if (!text) {
      this.el.radioInput.focus();
      return;
    }
    const result = this.game.issueTextCommand(text);
    if (!result || !result.ok) {
      if (result?.message) {
        this.el.radioHistory.innerHTML = `<div class="history-line" style="color:#c74737"><b>解析失败：</b>${this.escapeHtml(result.message)}</div>`;
      }
      this.el.radioInput.select();
      this.game.audio.commandFail();
      return;
    }
    this.populateRadioHistory();
    this.el.radioInput.value = '';
    this.closeRadio(true);
  }

  setParserSource(source) {
    const badge = document.querySelector('.parser-badge span');
    if (!badge) return;
    if (source === 'remote') badge.textContent = 'AI ONLINE';
    else if (source === 'fallback') badge.textContent = 'LOCAL FALLBACK';
    else badge.textContent = 'LOCAL AI';
  }

  renderMinimap(game) {
    const canvas = this.el.minimap;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const scale = (size - 24) / (CONFIG.arenaHalf * 2 + 2);
    ctx.clearRect(0, 0, size, size);

    const gradient = ctx.createRadialGradient(center, center, 6, center, center, center);
    gradient.addColorStop(0, 'rgba(255, 249, 237, 0.68)');
    gradient.addColorStop(1, 'rgba(248, 226, 198, 0.42)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(92, 56, 38, 0.055)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i += 1) {
      const p = (i / 5) * size;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(92, 56, 38, 0.2)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(10, 10, size - 20, size - 20);

    const mapX = (x) => center + x * scale * 0.92;
    const mapY = (z) => center + z * scale * 0.92;

    ctx.fillStyle = 'rgba(120, 75, 48, 0.11)';
    for (const obstacle of game.world.obstacles) {
      const x = mapX(obstacle.minX);
      const y = mapY(obstacle.minZ);
      const w = (obstacle.maxX - obstacle.minX) * scale * 0.92;
      const h = (obstacle.maxZ - obstacle.minZ) * scale * 0.92;
      if (w > 2 && h > 2) {
        ctx.fillRect(x, y, w, h);
      }
    }

    ctx.save();
    ctx.translate(mapX(game.core.position.x), mapY(game.core.position.z));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#f0a14e';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();

    for (const enemy of game.enemies) {
      if (enemy.dead) continue;
      const x = mapX(enemy.position.x);
      const y = mapY(enemy.position.z);
      ctx.beginPath();
      ctx.fillStyle = enemy.type === 'elite' ? '#b5372e' : '#e35a49';
      ctx.arc(x, y, enemy.type === 'elite' ? 4.3 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (enemy.type === 'elite') {
        ctx.strokeStyle = 'rgba(181,55,46,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const ally of game.allies) {
      const x = mapX(ally.position.x);
      const y = mapY(ally.position.z);
      ctx.beginPath();
      ctx.fillStyle = ally.downed ? '#ad9888' : ally.color === 0xff7a2f ? '#f56b26' : '#1fa896';
      ctx.arc(x, y, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,251,242,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (game.player.alive) {
      ctx.save();
      ctx.translate(mapX(game.player.position.x), mapY(game.player.position.z));
      ctx.rotate(-game.player.yaw);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(74,48,36,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.2, 4.6);
      ctx.lineTo(0, 2.7);
      ctx.lineTo(-4.2, 4.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(74, 48, 36, 0.34)';
    ctx.font = '700 8px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', center, 8);
    ctx.textAlign = 'left';
    ctx.fillText('W', 2, center + 3);
  }

  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
