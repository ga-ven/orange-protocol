import * as THREE from '../vendor/three.module.js';
import { CONFIG, COLORS, ENEMY_TYPES, INTENT_LABELS } from './config.js';
import { World } from './world.js';
import { Ally, Enemy, EnemyProjectile, Player } from './entities.js';
import { AudioManager } from './audio.js';
import { buildAllyReply, describeParse, parseLocalCommand, TacticalBrain } from './ai.js';
import { NpcVoice } from './npc.js';
import { TouchControls } from './touch.js';
import {
  clamp,
  damp,
  dist2D,
  pick,
  rand,
  raycasterHitsBox,
} from './utils.js';

// 触屏判定：pointer: coarse 覆盖手机/平板；?touch=1 / ?touch=0 用于手动覆盖（自检脚本要用）
function detectTouch() {
  const forced = new URLSearchParams(window.location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    // 触屏 = 手机上跑。这里就要定下来，因为抗锯齿/像素比是创建 renderer 时的一次性决策。
    const touchMode = detectTouch();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // 手机 GPU 上 4x MSAA 太贵：关掉抗锯齿，把像素让给分辨率更划算
      antialias: !touchMode,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      74,
      window.innerWidth / window.innerHeight,
      0.025,
      180,
    );
    this.world = new World(this.scene);
    this.core = this.world.core;
    this.player = new Player(this.scene, this.camera, this.world);
    this.audio = new AudioManager();
    this.brain = new TacticalBrain();
    // 大模型只负责说话与兜底解析；服务端没配令牌时会自己保持 enabled=false
    this.voice = new NpcVoice();
    this.voice.probe();
    this.voicePending = false;
    this.ui = null;

    this.allies = [
      new Ally(this.scene, this.world, {
        index: 0,
        name: '橙橙',
        role: '护卫',
        color: COLORS.orange,
        x: -3.6,
        z: 14.3,
      }),
      new Ally(this.scene, this.world, {
        index: 1,
        name: '闪闪',
        role: '游击',
        color: COLORS.teal,
        x: 3.6,
        z: 14.3,
      }),
    ];

    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.input = {
      keys: new Set(),
      mouseDown: false,
      // 触屏通道（桌面端恒为 0/false，键盘路径完全不变）
      moveX: 0,
      moveY: 0,
      sprintTouch: false,
      interactHold: false,
    };
    this.dragLook = false;
    this.lookDragLeft = false;
    this.lookDragRight = false;
    this.lockBlocked = false;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = CONFIG.weapon.range;

    this.state = 'menu';
    this.pausedForRadio = false;
    this.elapsed = 0;
    this.worldClock = 0;
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.commandCount = 0;
    this.commandHistory = [];
    this.lastCommand = null;
    this.currentWaveIndex = -1;
    this.wavePhase = 'idle';
    this.waveTimer = 0;
    this.pendingSpawns = [];
    this.waveTotal = 0;
    this.waveKilled = 0;
    this.spawnTimer = 0;
    this.spawnCursor = 0;
    this.shake = 0;
    this.aimEnemy = null;
    this.aimTimer = 0;
    this.reviveTarget = null;
    this.reviveProgress = 0;
    this.minimapTimer = 0;
    this.allyUiTimer = 0;
    this.hintAt = 0;
    this.coreChatterCooldown = 0;
    this.footstepTimer = 0;
    this.victory = false;
    this.resultData = null;
    this.runToken = 0;
    this.lastAimState = false;

    this.menuCameraPosition = new THREE.Vector3(19, 9.5, 20);
    this.camera.position.copy(this.menuCameraPosition);
    this.camera.lookAt(0, 1.4, 0);
    this.player.viewmodel.visible = false;
    this.allies[0].group.rotation.y = Math.PI;
    this.allies[1].group.rotation.y = Math.PI;

    // 触屏设备上额外挂一层摇杆/按钮。桌面端不创建，鼠标键盘路径保持原样。
    this.touch = touchMode ? new TouchControls(this) : null;
    if (this.touch) this.touch.mount();

    this.bindEvents();
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
    window.__ORANGE_GAME__ = this;
  }

  setUI(ui) {
    this.ui = ui;
    this.ui.showStart();
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setAmmo(this.player.ammo, CONFIG.weapon.magSize, false);
    this.ui.setCore(this.world.core.health, this.world.core.maxHealth);
    this.ui.setSkill(0, CONFIG.skill.cooldown);
    this.ui.updateAllies(this.allies);
    this.ui.setScore(0);
    this.ui.setWave('准备阶段', '接入战场', 0, '敌人 0 / 0');
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    // 触屏上这些鼠标语义全都不该生效：手机点一下画布会被浏览器合成为 mousedown，
    // 不拦住就会出现"想转视角结果开枪"，还会去请求指针锁。
    const mouseRelevant = () => !this.touch;
    document.addEventListener('pointerlockchange', () => {
      if (!mouseRelevant()) return;
      // 拖拽模式下本来就没有锁定，不能因为「没锁」就暂停
      if (this.dragLook) return;
      if (document.pointerLockElement !== this.canvas && this.state === 'playing') {
        this.pause();
      }
    });
    // iframe 里拿不到指针锁时（创空间就是这样），退化成「拖动视角」：
    // 右键拖动只转视角，左键仍是开火；按住左键拖动则两者同时进行。
    document.addEventListener('pointerlockerror', () => {
      if (mouseRelevant()) this.enableDragLook();
    });
    document.addEventListener('mousemove', (event) => {
      if (!mouseRelevant()) return;
      if (this.state !== 'playing' || this.ui?.radioOpen) return;
      const locked = document.pointerLockElement === this.canvas;
      if (locked || (this.dragLook && this.isDragLooking())) {
        this.player.applyLook(event.movementX, event.movementY, CONFIG.player.mouseSensitivity);
      }
    });
    document.addEventListener('mousedown', (event) => {
      if (!mouseRelevant()) return;
      if (this.state !== 'playing' || this.ui?.radioOpen) return;
      if (event.button === 2) {
        if (this.dragLook) this.lookDragRight = true;
        return;
      }
      if (event.button !== 0) return;
      if (document.pointerLockElement !== this.canvas && !this.lockBlocked) {
        this.requestPointerLock();
      }
      this.input.mouseDown = true;
      if (this.dragLook) this.lookDragLeft = true;
      this.audio.ensure();
    });
    document.addEventListener('mouseup', (event) => {
      if (!mouseRelevant()) return;
      if (event.button === 0) {
        this.input.mouseDown = false;
        this.lookDragLeft = false;
      }
      if (event.button === 2) this.lookDragRight = false;
    });
    document.addEventListener('contextmenu', (event) => {
      if (this.dragLook) event.preventDefault();
    });
    this.canvas.addEventListener('click', () => {
      if (!mouseRelevant()) return;
      if (this.state === 'playing' && document.pointerLockElement !== this.canvas && !this.lockBlocked) {
        this.requestPointerLock();
      }
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('keydown', (event) => this.handleKeyDown(event));
    document.addEventListener('keyup', (event) => {
      this.input.keys.delete(event.code);
      if (event.code === 'KeyE') {
        this.reviveProgress = Math.max(0, this.reviveProgress - 0.2);
      }
    });
    window.addEventListener('blur', () => {
      this.input.mouseDown = false;
      this.lookDragLeft = false;
      this.lookDragRight = false;
      this.input.keys.clear();
      this.touch?.releaseAll();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.input.mouseDown = false;
        this.lookDragLeft = false;
        this.lookDragRight = false;
        this.input.keys.clear();
        this.touch?.releaseAll();
        if (this.state === 'playing') this.pause();
      }
    });
    window.addEventListener('error', (event) => {
      console.error('[Orange Protocol]', event.error || event.message);
    });
  }

  handleKeyDown(event) {
    if (this.ui?.radioOpen) {
      if (event.code === 'Escape') {
        event.preventDefault();
        this.ui.closeRadio(true);
      }
      return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }

    if (this.state === 'paused') {
      if (event.code === 'Escape' || event.code === 'KeyP') {
        this.resume();
      }
      return;
    }
    if (this.state !== 'playing') return;

    if (event.code === 'KeyT') {
      this.ui.openRadio();
      return;
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      this.pause();
      return;
    }
    if (event.code === 'KeyR') {
      if (this.player.startReload()) this.audio.reloadStart();
      return;
    }
    if (event.code === 'KeyQ') {
      this.player.useSkill(this);
      return;
    }
    if (event.code.startsWith('Digit')) {
      const index = Number(event.code.replace('Digit', '')) - 1;
      if (index >= 0 && index < CONFIG.commands.length) {
        this.quickCommand(CONFIG.commands[index].id);
      }
      return;
    }
    this.input.keys.add(event.code);
  }

  isDragLooking() {
    return this.lookDragLeft || this.lookDragRight;
  }

  enableDragLook() {
    if (this.dragLook) return;
    this.dragLook = true;
    this.lockBlocked = true;
    this.ui?.showLockFallback();
  }

  requestPointerLock() {
    if (this.touch) return; // 触屏没有指针锁这回事
    if (document.pointerLockElement === this.canvas || this.lockBlocked) return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          // 浏览器拒绝合成事件触发的指针锁定：退回拖拽视角，不中断这一局
          this.enableDragLook();
        });
      }
    } catch (error) {
      this.enableDragLook();
    }
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // 手机 GPU 撑不住 1.35 倍渲染分辨率；1.0 已经是"像素级"，观感损失很小、帧率收益很大
    const ratioCap = this.touch ? 1 : 1.35;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratioCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.touch) {
      // 触屏 HUD 用真实像素排（见 styles.css 的 body.is-touch 那套），但平板横屏有 768 高，
      // 1:1 会让所有面板挤在角落里，所以按高度补一点放大；手机上 390 高正好乘 1。
      const touchScale = Math.min(1.25, Math.max(1, height / 420));
      document.documentElement.style.setProperty('--hud-scale', touchScale.toFixed(3));
      this.touch.measure();
      return;
    }
    // HUD 按设计稿宽度等比缩放，避免高分屏下所有面板缩成一团
    const hudScale = Math.min(1.5, Math.max(0.82, width / 1440));
    document.documentElement.style.setProperty('--hud-scale', hudScale.toFixed(3));
  }

  startRun() {
    this.runToken += 1;
    this.state = 'playing';
    this.pausedForRadio = false;
    this.victory = false;
    this.resultData = null;
    this.elapsed = 0;
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.commandCount = 0;
    this.commandHistory = [];
    this.lastCommand = null;
    this.currentWaveIndex = -1;
    this.wavePhase = 'prep';
    this.waveTimer = 3.6;
    this.pendingSpawns = [];
    this.waveTotal = 0;
    this.waveKilled = 0;
    this.spawnTimer = 0;
    this.spawnCursor = 0;
    this.shake = 0;
    this.aimEnemy = null;
    this.reviveTarget = null;
    this.reviveProgress = 0;
    this.hintAt = 0;
    this.coreChatterCooldown = 0;
    this.input.mouseDown = false;
    this.input.keys.clear();
    this.touch?.releaseAll();

    this.clearTransientObjects();
    this.player.reset();
    this.player.viewmodel.visible = true;
    this.world.core.health = this.world.core.maxHealth;
    this.world.core.hitFlash = 0;
    for (const ally of this.allies) {
      ally.health = ally.maxHealth;
      ally.alive = true;
      ally.downed = false;
      ally.downedTimer = 0;
      ally.reviveProgress = 0;
      ally.order = 'defend';
      ally.orderUntil = Infinity;
      ally.previousOrder = 'defend';
      ally.orderSide = null;
      ally.focusFilter = null;
      ally.damageSince = 0;
      ally.memory = {
        commandCounts: {},
        leaks: { north: 0, east: 0, south: 0, west: 0 },
        lastLeak: null,
        lastLeakSide: null,
        downedCount: 0,
        combatHighlights: [],
      };
      ally.group.rotation.set(0, 0, 0);
      ally.group.position.y = 0;
      ally.model.ring.visible = true;
    }
    this.allies[0].position.set(-3.6, 0, 14.3);
    this.allies[1].position.set(3.6, 0, 14.3);
    this.allies[0].group.position.copy(this.allies[0].position);
    this.allies[1].group.position.copy(this.allies[1].position);
    this.allies[0].group.rotation.y = Math.PI;
    this.allies[1].group.rotation.y = Math.PI;
    this.allies[1].setLabel('闪闪 · 游击');
    this.allies[0].setLabel('橙橙 · 护卫');

    this.audio.ensure();
    this.audio.startAmbient();
    this.ui.showHud();
    this.ui.hidePause();
    this.ui.closeRadio(false);
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setAmmo(this.player.ammo, CONFIG.weapon.magSize, false);
    this.ui.setCore(this.world.core.health, this.world.core.maxHealth);
    this.ui.setSkill(0, CONFIG.skill.cooldown);
    this.ui.setScore(0);
    this.ui.setWave('准备阶段', '接入战场', 0, '敌人 0 / 0');
    this.ui.setObjective('目标：守住能源核心');
    this.ui.updateCommandHighlight('defend');
    this.ui.showRevivePrompt(false);
    this.ui.updateAllies(this.allies);
    this.ui.showBanner(
      {
        kicker: '行动开始',
        title: '守住能源核心',
        subtitle: '撑过三波进攻，别让核心稳定度归零。',
        brief: this.touch
          ? '点底部 1—6 下令；点右下「电台」，直接对队友说人话。'
          : '按 1—6 快速下令；按 T 打开战术电台，直接对队友说人话。',
      },
      5000,
    );
    this.requestPointerLock();
  }

  toMenu() {
    this.runToken += 1;
    this.state = 'menu';
    this.pausedForRadio = false;
    this.input.mouseDown = false;
    this.input.keys.clear();
    this.touch?.releaseAll();
    this.clearTransientObjects();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.player.viewmodel.visible = false;
    this.world.core.health = this.world.core.maxHealth;
    this.world.core.hitFlash = 0;
    this.allies.forEach((ally, index) => {
      ally.health = ally.maxHealth;
      ally.downed = false;
      ally.alive = true;
      ally.group.rotation.set(0, Math.PI, 0);
      ally.group.position.set(index === 0 ? -3.6 : 3.6, 0, 14.3);
      ally.model.ring.visible = true;
    });
    this.ui.showStart();
    this.audio.stopAmbient();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.mouseDown = false;
    this.input.keys.clear();
    this.touch?.releaseAll();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.ui.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hidePause();
    this.audio.ensure();
    this.requestPointerLock();
  }

  enterRadioMode() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausedForRadio = true;
    this.input.mouseDown = false;
    this.input.keys.clear();
    this.touch?.releaseAll();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  leaveRadioMode() {
    if (!this.pausedForRadio) return;
    this.pausedForRadio = false;
    this.state = 'playing';
    this.ui.hidePause();
    this.requestPointerLock();
  }

  playFootstep() {
    this.audio.noise({
      duration: 0.07,
      volume: 0.018,
      filterFrequency: 190,
      filterType: 'lowpass',
    });
  }

  quickCommand(intent) {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    if (this.pausedForRadio) return;
    const active = this.allies.filter((ally) => !ally.downed);
    if (active.length === 0) {
      this.ui.systemSay('没有可响应的队友。先扶起他们。', '指挥部');
      this.audio.commandFail();
      return null;
    }
    const command = CONFIG.commands.find((entry) => entry.id === intent);
    for (const ally of active) {
      ally.orderSide = null;
      ally.focusFilter = null;
      ally.setOrder(intent, { duration: command?.duration || 30 }, this, false);
    }
    this.commandCount += 1;
    this.lastCommand = intent;
    this.ui.updateCommandHighlight(intent);
    this.ui.systemSay(`已下达：${command?.label || INTENT_LABELS[intent] || intent}`, '指令');
    this.audio.command();
    this.commandHistory.push({
      text: `快速指令：${command?.label || intent}`,
      resultText: INTENT_LABELS[intent] || intent,
    });
    this.ui.updateAllies(this.allies);
    return { ok: true, intent };
  }

  issueTextCommand(text) {
    if (this.state !== 'playing' && !this.pausedForRadio) {
      return { ok: false, message: '当前不在行动中，无法下达战术指令。' };
    }
    const parsed = parseLocalCommand(text);
    this.brain.lastSource = parsed.source || 'local';
    if (!parsed.ok) {
      this.audio.commandFail();
      this.requestVoiceParse(text);
      return parsed;
    }

    let selected = this.allies.filter((ally) => !ally.downed);
    if (parsed.allyName) {
      selected = selected.filter((ally) => ally.name === parsed.allyName);
    }
    if (selected.length === 0) {
      this.audio.commandFail();
      return {
        ok: false,
        message: parsed.allyName ? `${parsed.allyName}现在无法响应，先扶起她。` : '没有可响应的队友。',
      };
    }

    const assignments = parsed.assignments?.length
      ? parsed.assignments
      : [{
          intent: parsed.intent,
          allyName: parsed.allyName,
          side: parsed.side,
          enemyType: parsed.enemyType,
        }];
    const active = this.allies.filter((ally) => !ally.downed);
    for (const assignment of assignments) {
      const targets = assignment.allyName
        ? active.filter((ally) => ally.name === assignment.allyName)
        : active;
      const command = CONFIG.commands.find((entry) => entry.id === assignment.intent);
      for (const ally of targets) {
        ally.setOrder(
          assignment.intent,
          {
            duration: command?.duration || 28,
            side: assignment.side,
            enemyType: assignment.enemyType,
          },
          this,
          true,
        );
        ally.say(
          buildAllyReply(assignment.intent, ally.index, assignment.side, assignment.enemyType),
          this,
        );
      }
    }

    this.commandCount += 1;
    this.lastCommand = parsed.intent;
    this.ui.updateCommandHighlight(assignments.map((assignment) => assignment.intent));
    this.ui.setParserSource(parsed.source || 'local');
    this.audio.command();
    const resultText = describeParse(parsed);
    this.commandHistory.push({ text: parsed.raw, resultText, parsed });
    this.ui.updateAllies(this.allies);
    return { ...parsed, resultText };
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.08);
    this.worldClock += dt;
    if (this.state === 'playing') {
      this.updateGame(dt);
    } else if (this.state === 'menu') {
      this.updateMenuScene(dt);
    } else {
      this.updateAmbientActors(dt);
    }
    this.world.update(dt, this.worldClock);
    this.updateEffects(this.state === 'playing' ? dt : dt * 0.2);
    this.renderer.render(this.scene, this.camera);
  }

  updateMenuScene(dt) {
    const angle = Math.sin(this.worldClock * 0.075) * 0.18;
    const radius = 26;
    this.camera.position.set(
      Math.cos(0.68 + angle) * radius,
      8.6 + Math.sin(this.worldClock * 0.1) * 0.35,
      Math.sin(0.68 + angle) * radius,
    );
    this.camera.lookAt(0, 1.7, 0);
    this.player.viewmodel.visible = false;
    this.updateAmbientActors(dt);
  }

  updateAmbientActors(dt) {
    for (const ally of this.allies) {
      if (!ally.downed) {
        ally.model.ring.material.opacity = 0.45 + Math.sin(this.worldClock * 2.2 + ally.index) * 0.08;
      }
    }
  }

  updateGame(dt) {
    this.elapsed += dt;
    this.coreChatterCooldown = Math.max(0, this.coreChatterCooldown - dt);
    this.player.update(dt, this, this.input);

    this.aimTimer -= dt;
    if (this.aimTimer <= 0) {
      this.aimTimer = 0.105;
      this.updateAimTarget();
    }

    for (const ally of this.allies) ally.update(dt, this);
    for (const enemy of this.enemies) enemy.update(dt, this);
    for (const projectile of this.projectiles) projectile.update(dt, this);
    this.updateWave(dt);
    this.updateReviveInteraction(dt);

    if (!this.player.alive && this.player.respawnTimer <= 0 && this.state === 'playing') {
      this.respawnPlayer();
    }

    this.enemies = this.enemies.filter((enemy) => {
      if (enemy.dead && enemy.deathTimer > 1.15) {
        this.scene.remove(enemy.group);
        if (enemy.healthBar?.texture) enemy.healthBar.texture.dispose();
        return false;
      }
      return true;
    });
    this.projectiles = this.projectiles.filter((projectile) => projectile.alive);

    if (this.shake > 0.001) {
      this.shake = damp(this.shake, 0, 7, dt);
      this.camera.position.x += rand(-this.shake, this.shake) * 0.35;
      this.camera.position.y += rand(-this.shake, this.shake) * 0.25;
      this.camera.rotation.z += rand(-this.shake, this.shake) * 0.08;
    }

    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setAmmo(this.player.ammo, CONFIG.weapon.magSize, this.player.reloading);
    this.ui.setCore(this.world.core.health, this.world.core.maxHealth);
    this.ui.setSkill(this.player.skillCooldown, CONFIG.skill.cooldown);
    this.ui.setScore(this.score);

    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1;
      this.ui.renderMinimap(this);
    }
    this.allyUiTimer -= dt;
    if (this.allyUiTimer <= 0) {
      this.allyUiTimer = 0.24;
      this.ui.updateAllies(this.allies);
    }
  }

  updateAimTarget() {
    if (!this.player.alive) {
      this.aimEnemy = null;
      return;
    }
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const direction = this.player.getForward(new THREE.Vector3());
    this.raycaster.set(origin, direction);
    this.raycaster.far = CONFIG.weapon.range;
    const meshes = [];
    for (const enemy of this.enemies) {
      if (!enemy.dead) meshes.push(...enemy.hitMeshes);
    }
    const intersections = this.raycaster.intersectObjects(meshes, false);
    let candidate = null;
    if (intersections.length > 0) {
      const hit = intersections[0];
      let closestWorld = Infinity;
      for (const obstacle of this.world.obstacles) {
        closestWorld = Math.min(
          closestWorld,
          raycasterHitsBox(origin, direction, hit.distance, obstacle.rayBox),
        );
      }
      if (hit.distance <= closestWorld + 0.03) {
        candidate = hit.object.userData.actor || null;
        if (candidate?.dead || candidate?.invulnerable) candidate = null;
      }
    }
    this.aimEnemy = candidate;
  }

  getFocusEnemy(ally) {
    let enemies = this.enemies.filter((enemy) => !enemy.dead && enemy.alive);
    if (ally?.focusFilter) {
      const filtered = enemies.filter((enemy) => enemy.type === ally.focusFilter);
      if (filtered.length) enemies = filtered;
    }
    if (enemies.length === 0) return null;

    if (ally?.orderSide === 'left' || ally?.orderSide === 'right') {
      const forward = this.player.getForward(new THREE.Vector3());
      forward.y = 0;
      forward.normalize();
      const right = this.player.getRight(new THREE.Vector3());
      const sign = ally.orderSide === 'right' ? 1 : -1;
      const sideEnemies = enemies.filter((enemy) => {
        return (enemy.position.x - this.player.position.x) * right.x * sign +
          (enemy.position.z - this.player.position.z) * right.z * sign > 0;
      });
      if (sideEnemies.length) enemies = sideEnemies;
    }

    if (this.aimEnemy && enemies.includes(this.aimEnemy)) return this.aimEnemy;

    let best = null;
    let bestScore = Infinity;
    const origin = this.player.position;
    const forward = this.player.getForward(new THREE.Vector3());
    forward.y = 0;
    forward.normalize();
    for (const enemy of enemies) {
      const dx = enemy.position.x - origin.x;
      const dz = enemy.position.z - origin.z;
      const distance = Math.hypot(dx, dz) || 1;
      const dot = (dx / distance) * forward.x + (dz / distance) * forward.z;
      const score = distance * (1.25 - clamp(dot, -1, 1) * 0.55);
      if (score < bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    return best;
  }

  updateWave(dt) {
    if (this.wavePhase === 'prep') {
      this.waveTimer -= dt;
      this.ui.setWave(
        '准备阶段',
        '接入战场',
        clamp(1 - this.waveTimer / 3.6, 0, 1),
        '敌人 0 / 0',
      );
      if (this.waveTimer <= 0) this.startWave(0);
      return;
    }

    if (this.wavePhase === 'combat') {
      const alive = this.enemies.filter((enemy) => !enemy.dead).length;
      this.spawnTimer -= dt;
      if (this.pendingSpawns.length > 0 && this.spawnTimer <= 0) {
        const nextType = this.pendingSpawns.shift();
        this.spawnEnemy(nextType);
        const data = CONFIG.waves[this.currentWaveIndex];
        this.spawnTimer = data.spawnInterval * rand(0.68, 1.15);
      }
      const remaining = this.pendingSpawns.length + alive;
      const cleared = this.waveTotal - remaining;
      this.ui.setWave(
        `第 ${this.currentWaveIndex + 1} 波 / ${CONFIG.waves.length}`,
        CONFIG.waves[this.currentWaveIndex].name.split(' · ')[1] || CONFIG.waves[this.currentWaveIndex].name,
        this.waveTotal ? cleared / this.waveTotal : 0,
        `剩余敌人 ${remaining} / ${this.waveTotal}`,
      );
      if (this.hintAt && this.elapsed >= this.hintAt) {
        this.hintAt = 0;
        const ally = this.allies[this.currentWaveIndex % this.allies.length];
        if (ally && !ally.downed) {
          ally.say(ally.waveSuggestion(this.currentWaveIndex, this), this);
        }
      }
      if (this.pendingSpawns.length === 0 && alive === 0) {
        this.completeWave();
      }
      return;
    }

    if (this.wavePhase === 'break') {
      this.waveTimer -= dt;
      this.ui.setWave(
        '波次间休整',
        `下一波 ${Math.max(0, Math.ceil(this.waveTimer))} 秒`,
        clamp(1 - this.waveTimer / 11, 0, 1),
        '调整防线 · 可下达新指令',
      );
      if (this.hintAt && this.elapsed >= this.hintAt) {
        this.hintAt = 0;
        const ally = this.allies[this.currentWaveIndex % this.allies.length];
        if (ally && !ally.downed) {
          ally.say(ally.waveSuggestion(this.currentWaveIndex + 1, this), this);
          this.requestBanter(ally, this.currentWaveIndex + 1);
        }
      }
      if (this.waveTimer <= 0) {
        this.startWave(this.currentWaveIndex + 1);
      }
      return;
    }

    if (this.wavePhase === 'victoryDelay') {
      this.waveTimer -= dt;
      this.ui.setWave('防线稳定', '正在回收战场数据', 1, '全部波次已清除');
      if (this.waveTimer <= 0) this.endGame(true);
    }
  }

  startWave(index) {
    if (index >= CONFIG.waves.length) {
      this.endGame(true);
      return;
    }
    this.currentWaveIndex = index;
    const data = CONFIG.waves[index];
    this.wavePhase = 'combat';
    this.waveKilled = 0;
    this.waveTotal = data.enemies.reduce((sum, group) => sum + group.count, 0);
    this.pendingSpawns = [];
    for (const group of data.enemies) {
      for (let i = 0; i < group.count; i += 1) this.pendingSpawns.push(group.type);
    }
    // The elite arrives after the first few units rather than at the very end.
    if (index === CONFIG.waves.length - 1) {
      const eliteIndex = this.pendingSpawns.indexOf('elite');
      if (eliteIndex >= 0) {
        this.pendingSpawns.splice(eliteIndex, 1);
        this.pendingSpawns.splice(Math.floor(this.pendingSpawns.length * 0.45), 0, 'elite');
      }
    }
    this.spawnTimer = 0.1;
    this.hintAt = 0;
    this.ui.setObjective(`目标：清除第 ${index + 1} 波敌人`);
    this.ui.showBanner(
      {
        kicker: `WAVE 0${index + 1} / 0${CONFIG.waves.length}`,
        title: data.name,
        subtitle: data.subtitle,
        brief: this.touch && data.briefTouch ? data.briefTouch : data.brief,
      },
      4000,
    );
    this.audio.waveStart();
    const suggestionAlly = this.allies[index % 2];
    if (suggestionAlly && !suggestionAlly.downed) {
      this.hintAt = this.elapsed + 4.6;
    }
  }

  spawnEnemy(type) {
    const spawnPoint = this.world.spawnPoints[this.spawnCursor % this.world.spawnPoints.length];
    this.spawnCursor += 1;
    const inwardX = spawnPoint.x === 0 ? rand(-1.4, 1.4) : 0;
    const inwardZ = spawnPoint.z === 0 ? rand(-1.4, 1.4) : 0;
    const spawn = {
      x: spawnPoint.x + inwardX,
      z: spawnPoint.z + inwardZ,
    };
    const enemy = new Enemy(this.scene, type, spawn, spawnPoint.id);
    this.enemies.push(enemy);
    this.spawnSpawnPortal(spawn);
  }

  completeWave() {
    if (this.wavePhase !== 'combat') return;
    const isFinal = this.currentWaveIndex >= CONFIG.waves.length - 1;
    this.wavePhase = isFinal ? 'victoryDelay' : 'break';
    this.waveTimer = isFinal ? 1.8 : 11;
    this.pendingSpawns = [];
    for (const projectile of this.projectiles) {
      if (projectile.alive) projectile.destroy(this, false);
    }
    if (isFinal) {
      this.ui.showBanner(
        {
          kicker: '最后一波清除',
          title: '核心稳定',
          subtitle: '三名作战单位全部在线。',
          brief: '',
        },
        2200,
      );
      return;
    }
    const healthGain = 15;
    this.world.core.heal(healthGain);
    this.ui.setCore(this.world.core.health, this.world.core.maxHealth);
    this.ui.showBanner(
      {
        kicker: `WAVE 0${this.currentWaveIndex + 1} CLEARED`,
        title: '这一波守住了',
        subtitle: `核心稳定度 +${healthGain} · 下一波即将到达`,
        brief: '利用休整时间调整指令，队友会给出她们记住的战场判断。',
      },
      3600,
    );
    this.ui.setObjective('目标：调整防线，准备下一波');
    this.hintAt = this.elapsed + 3;
    this.audio.revive();
  }

  onEnemyKilled(enemy, headshot) {
    this.kills += 1;
    this.waveKilled += 1;
    if (headshot) this.headshots += 1;
    const base = ENEMY_TYPES[enemy.type].score;
    this.score += Math.round(base * (headshot ? 1.35 : 1));
    this.ui.setScore(this.score);
    this.audio.enemyDown();
    this.spawnImpact(
      new THREE.Vector3(enemy.position.x, enemy.type === 'elite' ? 1.5 : 0.9, enemy.position.z),
      enemy.type === 'elite' ? 0xffc06a : 0xff8b62,
      enemy.type === 'elite' ? 28 : 13,
      enemy.type === 'elite' ? 4.2 : 2.6,
    );
    const label = ENEMY_TYPES[enemy.type].label;
    this.ui.killFeed(`${label} 已击破`, headshot ? '爆头' : '橘光小队');
    if (enemy.type === 'elite') {
      this.world.core.heal(20);
      this.ui.setCore(this.world.core.health, this.world.core.maxHealth);
      this.ui.systemSay('精英单位击破，核心回收了 20 点稳定度。', '指挥部');
      this.shake = Math.min(0.26, this.shake + 0.12);
    }
    if (this.wavePhase === 'combat' && this.pendingSpawns.length === 0) {
      const alive = this.enemies.some((candidate) => !candidate.dead && candidate !== enemy);
      if (!alive) this.completeWave();
    }
  }

  handlePlayerShot(origin, direction) {
    if (!this.player.alive) return;
    this.shotsFired += 1;
    this.audio.shoot();
    this.player.gunKick = Math.min(1.4, this.player.gunKick + 0.45);

    const meshes = [];
    for (const enemy of this.enemies) {
      if (!enemy.dead) meshes.push(...enemy.hitMeshes);
    }
    this.raycaster.set(origin, direction);
    this.raycaster.far = CONFIG.weapon.range;
    const intersections = this.raycaster.intersectObjects(meshes, false);
    let closestWorld = CONFIG.weapon.range;
    for (const obstacle of this.world.obstacles) {
      closestWorld = Math.min(
        closestWorld,
        raycasterHitsBox(origin, direction, CONFIG.weapon.range, obstacle.rayBox),
      );
    }

    const firstHit = intersections[0];
    const enemyHit =
      firstHit && firstHit.distance < closestWorld + 0.04 ? firstHit : null;
    const muzzle = this.player.getMuzzleWorld(new THREE.Vector3());
    let endPoint;
    if (enemyHit) {
      endPoint = enemyHit.point.clone();
      const enemy = enemyHit.object.userData.actor;
      if (enemy && !enemy.dead) {
        const part = enemyHit.object.userData.actorPart || 'body';
        const dealt = enemy.takeDamage(CONFIG.weapon.damage, part, this);
        if (dealt > 0) {
          this.shotsHit += 1;
          const headshot = part === 'head';
          this.ui.hitMarker(headshot);
          this.audio.hit(headshot);
          this.spawnImpact(endPoint, headshot ? 0xffe6aa : 0xff966e, headshot ? 13 : 7, 2.2);
          this.score += Math.round(dealt * 0.4);
          this.ui.setScore(this.score);
        } else {
          this.spawnImpact(endPoint, 0xffddb0, 4, 1.2);
        }
      }
    } else {
      const distance = Math.min(closestWorld, CONFIG.weapon.range);
      endPoint = origin.clone().addScaledVector(direction, distance);
      if (closestWorld < CONFIG.weapon.range) {
        this.spawnImpact(endPoint, 0xffcd9e, 5, 1.4);
      }
    }
    this.spawnTracer(muzzle, endPoint, 0xffa24d, 0.017);
  }

  allyShoot(ally, enemy) {
    if (!enemy || enemy.dead) return;
    const origin = ally.model.muzzle.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(enemy.position.x, 1.05, enemy.position.z);
    const distance = origin.distanceTo(target);
    const hitChance = clamp(0.93 - distance * 0.012, 0.62, 0.92);
    const didHit = Math.random() < hitChance;
    if (didHit) {
      const part = Math.random() < 0.12 ? 'head' : 'body';
      const amount = CONFIG.ally.damage * rand(0.88, 1.12);
      enemy.takeDamage(amount, part, this);
      this.spawnImpact(target, ally.color === COLORS.orange ? 0xffb15f : 0x7ce0cf, 5, 1.6);
    }
    const end = didHit
      ? target
      : target.clone().add(new THREE.Vector3(rand(-0.8, 0.8), rand(-0.3, 0.5), rand(-0.8, 0.8)));
    this.spawnTracer(origin, end, ally.color === COLORS.orange ? 0xffba73 : 0x66d8c6, 0.011);
  }

  damagePlayer(amount) {
    if (this.state !== 'playing') return;
    this.player.takeDamage(amount, this);
  }

  damageAlly(ally, amount) {
    if (this.state !== 'playing') return;
    ally.takeDamage(amount, this);
    this.ui.updateAllies(this.allies);
  }

  damageCore(amount, enemy = null, hitPosition = null) {
    if (this.state !== 'playing' || this.world.core.health <= 0) return;
    this.world.core.damage(amount);
    this.shake = Math.min(0.22, this.shake + 0.045);
    this.audio.coreHit();
    this.ui.setCore(this.world.core.health, this.world.core.maxHealth);
    this.ui.damageFlash();
    const side = enemy?.spawnSide || this.sideFromPosition(hitPosition);
    for (const ally of this.allies) ally.recordLeak(side, this);
    if (this.world.core.health > 0 && this.coreChatterCooldown <= 0) {
      this.coreChatterCooldown = 9;
      const sideLabel = side ? { north: '北侧', east: '东侧', south: '南侧', west: '西侧' }[side] : '正面';
      this.ui.systemSay(`核心受到攻击，${sideLabel}压力升高。`, '橙橙');
    }
    if (this.world.core.health <= 0) {
      this.endGame(false);
    }
  }

  sideFromPosition(position) {
    if (!position) return pick(['north', 'east', 'south', 'west']);
    if (Math.abs(position.x) > Math.abs(position.z)) return position.x < 0 ? 'west' : 'east';
    return position.z < 0 ? 'north' : 'south';
  }

  onPlayerDown() {
    if (this.state !== 'playing') return;
    this.ui.systemSay('指挥官失去意识，4 秒后重新部署。队友仍在坚守。', '指挥部');
    this.ui.showBanner(
      {
        kicker: 'SIGNAL LOST',
        title: '意识中断',
        subtitle: '正在重新部署，请守住核心。',
        brief: '',
      },
      2600,
    );
    this.spawnImpact(
      new THREE.Vector3(this.player.position.x, 0.8, this.player.position.z),
      0xff8a5a,
      18,
      3,
    );
  }

  respawnPlayer() {
    this.player.position.set(0, 0, 14.6);
    this.player.velocityY = 0;
    this.player.revive();
    this.player.invulnerableTimer = 3;
    this.player.yaw = 0;
    this.player.pitch = -0.03;
    this.ui.systemSay('重新接入战场。核心还在，继续指挥。', '指挥部');
    this.ui.setHealth(this.player.health, this.player.maxHealth);
  }

  updateReviveInteraction(dt) {
    if (!this.player.alive) {
      this.reviveTarget = null;
      this.ui.showRevivePrompt(false);
      return;
    }
    let nearest = null;
    let nearestDistance = 2.65;
    for (const ally of this.allies) {
      if (!ally.downed) continue;
      const distance = dist2D(this.player.position, ally.position);
      if (distance < nearestDistance) {
        nearest = ally;
        nearestDistance = distance;
      }
    }
    if (!nearest) {
      if (this.reviveTarget) {
        this.reviveTarget = null;
        this.reviveProgress = 0;
        this.ui.showRevivePrompt(false);
      }
      return;
    }
    if (this.reviveTarget !== nearest) {
      this.reviveTarget = nearest;
      this.reviveProgress = 0;
    }
    // 触屏没有 E 键，走触控层的「扶起」按钮（input.interactHold）
    const holding = this.input.keys.has('KeyE') || this.input.interactHold;
    if (holding) {
      this.reviveProgress = Math.min(1, this.reviveProgress + dt / CONFIG.ally.reviveTime);
      this.ui.setInteractProgress(this.reviveProgress);
    } else {
      this.reviveProgress = Math.max(0, this.reviveProgress - dt * 0.45);
      this.ui.setInteractProgress(this.reviveProgress);
    }
    this.ui.showRevivePrompt(true, nearest.name, this.reviveProgress);
    if (this.reviveProgress >= 1) {
      nearest.revive(this, false);
      this.reviveTarget = null;
      this.reviveProgress = 0;
      this.ui.showRevivePrompt(false);
      this.ui.updateAllies(this.allies);
      this.score += 50;
      this.ui.setScore(this.score);
    }
  }

  activatePulse() {
    if (this.state !== 'playing') return;
    this.audio.skill();
    this.shake = Math.min(0.3, this.shake + 0.16);
    const center = this.player.position.clone();
    this.spawnPulse(center);
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const distance = dist2D(center, enemy.position);
      if (distance <= CONFIG.skill.radius) {
        const falloff = 1 - (distance / CONFIG.skill.radius) * 0.45;
        enemy.takeDamage(CONFIG.skill.damage * falloff, 'body', this);
        const dirX = enemy.position.x - center.x;
        const dirZ = enemy.position.z - center.z;
        const length = Math.hypot(dirX, dirZ) || 1;
        enemy.position.x += (dirX / length) * 1.15;
        enemy.position.z += (dirZ / length) * 1.15;
        this.spawnImpact(
          new THREE.Vector3(enemy.position.x, 0.9, enemy.position.z),
          0xffc17a,
          6,
          2.2,
        );
      }
    }
    for (const projectile of this.projectiles) {
      if (projectile.alive && dist2D(center, projectile.position) < CONFIG.skill.radius) {
        projectile.destroy(this, true);
      }
    }
    this.ui.systemSay('橘光脉冲释放：周围敌人被击退。', '橙橙');
  }

  updateEffects(dt) {
    for (const effect of this.effects) {
      effect.life -= dt;
      if (effect.type === 'tracer') {
        effect.mesh.material.opacity = clamp(effect.life / effect.maxLife, 0, 1) * effect.opacity;
        effect.mesh.scale.x = 1 + (1 - effect.life / effect.maxLife) * 1.8;
        effect.mesh.scale.z = 1 + (1 - effect.life / effect.maxLife) * 1.8;
      } else if (effect.type === 'particles') {
        const positions = effect.geometry.attributes.position.array;
        for (let i = 0; i < effect.velocities.length; i += 1) {
          const velocity = effect.velocities[i];
          velocity.y -= 5.4 * dt;
          positions[i * 3] += velocity.x * dt;
          positions[i * 3 + 1] += velocity.y * dt;
          positions[i * 3 + 2] += velocity.z * dt;
        }
        effect.geometry.attributes.position.needsUpdate = true;
        effect.points.material.opacity = clamp(effect.life / effect.maxLife, 0, 1);
      } else if (effect.type === 'pulse') {
        const progress = 1 - effect.life / effect.maxLife;
        effect.mesh.scale.setScalar(1 + progress * 8.4);
        effect.mesh.material.opacity = (1 - progress) * 0.8;
        if (effect.glow) {
          effect.glow.scale.setScalar(5 + progress * 16);
          effect.glow.material.opacity = (1 - progress) * 0.42;
        }
      } else if (effect.type === 'muzzle') {
        effect.sprite.material.opacity = clamp(effect.life / effect.maxLife, 0, 1);
        effect.sprite.scale.setScalar(effect.baseScale * (1 + (1 - effect.life / effect.maxLife) * 1.6));
      }
    }
    const expired = this.effects.filter((effect) => effect.life <= 0);
    for (const effect of expired) {
      if (effect.glow) {
        this.scene.remove(effect.glow);
        effect.glow.material.dispose();
      }
      this.scene.remove(effect.mesh || effect.points || effect.sprite);
      const object = effect.mesh || effect.points || effect.sprite;
      object?.traverse?.((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      if (object?.geometry) object.geometry.dispose();
      if (object?.material) object.material.dispose();
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);
  }

  spawnTracer(from, to, color, width = 0.02) {
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length < 0.03) return;
    const geometry = new THREE.CylinderGeometry(width, width * 0.72, length, 4, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    this.effects.push({ type: 'tracer', mesh, life: 0.075, maxLife: 0.075, opacity: 0.9 });
  }

  spawnImpact(position, color, count = 8, speed = 2) {
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      const direction = new THREE.Vector3(rand(-1, 1), rand(0.05, 1.2), rand(-1, 1)).normalize();
      velocities.push(direction.multiplyScalar(rand(0.4, speed)));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: 0.085,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.effects.push({ type: 'particles', points, geometry, velocities, life: 0.5, maxLife: 0.5 });
  }

  spawnPulse(center) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.09, 6, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffb264,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(center.x, 0.35, center.z);
    this.scene.add(mesh);
    const glow = this.createTransientGlow(0xff8a42, center.clone().setY(0.7), 5, 0.5);
    this.effects.push({
      type: 'pulse',
      mesh,
      glow,
      life: 0.58,
      maxLife: 0.58,
    });
    const ring2 = mesh.clone();
    ring2.material = mesh.material.clone();
    ring2.material.color.setHex(0xffe0ad);
    ring2.position.y = 0.55;
    ring2.rotation.x = 0;
    ring2.rotation.z = Math.PI / 2;
    this.scene.add(ring2);
    this.effects.push({ type: 'tracer', mesh: ring2, life: 0.35, maxLife: 0.35, opacity: 0.8 });
  }

  spawnEnemyMuzzle(position) {
    const sprite = this.createTransientGlow(0xff8a5c, position, 1.8, 0.9);
    this.effects.push({
      type: 'muzzle',
      sprite,
      life: 0.08,
      maxLife: 0.08,
      baseScale: 1.8,
    });
  }

  spawnMeleeSwipe(from, target) {
    const start = new THREE.Vector3(from.x, 1.1, from.z);
    const end = new THREE.Vector3(target.x, 1.0, target.z);
    this.spawnTracer(start, end, 0xff8266, 0.025);
  }

  spawnSpawnPortal(position) {
    const glow = this.createTransientGlow(0xff6d3e, new THREE.Vector3(position.x, 1.0, position.z), 3.4, 0.5);
    this.effects.push({ type: 'muzzle', sprite: glow, life: 0.44, maxLife: 0.44, baseScale: 3.4 });
  }

  createTransientGlow(color, position, scale, opacity) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.world.core.glow.material.map,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.scale.setScalar(scale);
    sprite.position.copy(position);
    this.scene.add(sprite);
    return sprite;
  }

  spawnEnemyProjectile(origin, target, speed, damage, big) {
    const projectile = new EnemyProjectile(
      this.scene,
      origin,
      target,
      speed,
      damage,
      big,
    );
    this.projectiles.push(projectile);
  }

  endGame(victory) {
    if (this.state === 'result') return;
    this.victory = victory;
    this.state = 'result';
    this.input.mouseDown = false;
    this.input.keys.clear();
    this.touch?.releaseAll();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (victory) this.audio.victory();
    else this.audio.defeat();
    this.audio.stopAmbient();
    const corePercent = Math.round((this.world.core.health / this.world.core.maxHealth) * 100);
    const accuracy = this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    const waveReached = victory
      ? CONFIG.waves.length
      : Math.max(1, this.currentWaveIndex + 1);
    let grade = 'D';
    if (victory) {
      if (corePercent >= 70 && accuracy >= 34 && this.commandCount >= 4) grade = 'S';
      else if (corePercent >= 42 && accuracy >= 24) grade = 'A';
      else grade = 'B';
    } else if (waveReached >= 2) {
      grade = 'C';
    }
    const ally = this.allies.find((candidate) => (candidate.memory.downedCount || 0) === 0) || this.allies[0];
    const leaks = Object.entries(ally.memory.leaks).sort((a, b) => b[1] - a[1]);
    const sideLabels = { north: '北侧', east: '东侧', south: '南侧', west: '西侧' };
    const leakLine =
      leaks[0] && leaks[0][1] > 0 ? `${sideLabels[leaks[0][0]]}承受了最多压力。` : '核心周围没有明显的防守缺口。';
    const commandLine =
      this.commandCount >= 4
        ? `你一共下达了 ${this.commandCount} 次战术指令，队友真的按你的话改变了站位。`
        : '这次只用了少量指令；下次多让队友换位，会更容易守住核心。';
    const insight = `${commandLine} ${leakLine} ${ally.name}记住了这局的压力方向。`;
    this.resultData = {
      victory,
      corePercent,
      accuracy,
      waveReached,
      waveTotal: CONFIG.waves.length,
      time: this.elapsed,
      kills: this.kills,
      headshots: this.headshots,
      commands: this.commandCount,
      grade,
      insight,
    };
    this.ui.showResult(this.resultData);
    this.requestDebrief(ally, leaks);
  }

  // 结算页先显示本地模板，大模型回来后再替换（失败就一直是模板）
  requestDebrief(ally, leaks) {
    if (!this.voice.enabled) return;
    const sideLabels = { north: '北侧', east: '东侧', south: '南侧', west: '西侧' };
    const leakSide = leaks[0] && leaks[0][1] > 0 ? sideLabels[leaks[0][0]] : null;
    this.voice
      .debrief({
        victory: this.resultData.victory,
        grade: this.resultData.grade,
        corePercent: this.resultData.corePercent,
        accuracy: this.resultData.accuracy,
        kills: this.resultData.kills,
        commands: this.resultData.commands,
        waveReached: this.resultData.waveReached,
        leakSide,
        allyName: ally.name,
        downed: ally.memory.downedCount || 0,
      })
      .then((text) => {
        if (text) this.ui.setInsight(text, 'ai');
      });
  }

  // 波次间让队友用自己的话交代下一波
  requestBanter(ally, waveIndex) {
    if (!this.voice.enabled || !ally || ally.downed) return;
    const sideLabels = { north: '北侧', east: '东侧', south: '南侧', west: '西侧' };
    const leaks = Object.entries(ally.memory.leaks).sort((a, b) => b[1] - a[1]);
    const leakSide = leaks[0] && leaks[0][1] > 0 ? sideLabels[leaks[0][0]] : null;
    const counts = Object.entries(ally.memory.commandCounts || {}).sort((a, b) => b[1] - a[1]);
    const mostUsed = counts[0] ? INTENT_LABELS[counts[0][0]] || '守核心' : '守核心';
    this.voice
      .banter({ wave: waveIndex, leakSide, mostUsed, downed: ally.memory.downedCount || 0 })
      .then((text) => {
        if (!text || this.state !== 'playing' || ally.downed) return;
        ally.say(text, this);
      });
  }

  // 本地解析没听懂时的兜底：走模型，但只接受六种意图，绝不接受坐标或数值
  requestVoiceParse(text) {
    if (!this.voice.enabled || this.voicePending) return;
    if (this.state !== 'playing' && !this.pausedForRadio) return;
    this.voicePending = true;
    this.ui.systemSay('没听懂，正在让大模型解析…', '指挥部');
    this.voice.parseIntent(text).then((result) => {
      this.voicePending = false;
      if (this.state !== 'playing' && !this.pausedForRadio) return;
      if (!result) {
        this.ui.systemSay('大模型也没抓到战术意图，换个说法试试。', '指挥部');
        return;
      }
      this.brain.lastSource = 'remote';
      this.quickCommand(result.intent);
      // 明确告诉玩家这次是大模型补的，不假装是本地解析
      this.ui.systemSay(`大模型兜底解析：${INTENT_LABELS[result.intent] || result.intent}`, '指挥部');
    });
  }

  clearTransientObjects() {
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.group);
      if (enemy.healthBar?.texture) enemy.healthBar.texture.dispose();
    }
    for (const projectile of this.projectiles) {
      this.scene.remove(projectile.group);
    }
    for (const effect of this.effects) {
      if (effect.glow) {
        this.scene.remove(effect.glow);
        effect.glow.material.dispose();
      }
      const object = effect.mesh || effect.points || effect.sprite;
      if (object) {
        this.scene.remove(object);
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      }
    }
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
  }
}
