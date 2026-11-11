import * as THREE from '../vendor/three.module.js';
import { COLORS, CONFIG } from './config.js';
import {
  createGlowSprite,
  createTextSprite,
  makeFloorTexture,
  makeStripeTexture,
  rand,
} from './utils.js';

const materials = new Map();

function standard(color, options = {}) {
  const key = `${color}-${JSON.stringify(options)}`;
  if (!options.unique && materials.has(key)) return materials.get(key);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.78,
    metalness: options.metalness ?? 0.04,
    flatShading: options.flatShading ?? true,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
  });
  if (!options.unique) materials.set(key, material);
  return material;
}

function box(scene, width, height, depth, material, x, y, z, rotationY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  scene.add(mesh);
  return mesh;
}

function cylinder(scene, radiusTop, radiusBottom, height, segments, material, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function addObstacle(obstacles, mesh, width, depth, height, padding = 0) {
  const minX = mesh.position.x - width / 2 - padding;
  const maxX = mesh.position.x + width / 2 + padding;
  const minZ = mesh.position.z - depth / 2 - padding;
  const maxZ = mesh.position.z + depth / 2 + padding;
  const box3 = new THREE.Box3(
    new THREE.Vector3(minX, 0.02, minZ),
    new THREE.Vector3(maxX, height, maxZ),
  );
  const obstacle = { mesh, minX, maxX, minZ, maxZ, height, rayBox: box3 };
  obstacles.push(obstacle);
  return obstacle;
}

function createCover(scene, obstacles, x, z, width, depth, height, rotationY = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  scene.add(group);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    standard(COLORS.creamDark, { roughness: 0.9 }),
  );
  base.position.y = height / 2;
  group.add(base);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.12, 0.14, depth + 0.12),
    standard(COLORS.cream, { roughness: 0.72 }),
  );
  top.position.y = height + 0.05;
  group.add(top);

  const topBand = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.32, 0.055, depth + 0.14),
    standard(COLORS.orange, { roughness: 0.58 }),
  );
  topBand.position.set(-width * 0.2, height + 0.13, 0);
  group.add(topBand);

  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.42, 0.08, depth + 0.14),
    standard(COLORS.teal, { roughness: 0.55 }),
  );
  stripe.position.y = height * 0.57;
  group.add(stripe);

  for (let i = -1; i <= 1; i += 2) {
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, depth * 0.75),
      standard(COLORS.orangeDeep, { roughness: 0.8 }),
    );
    foot.position.set((i * width) / 2, 0.11, 0);
    group.add(foot);
  }

  // Use the unrotated footprint. Layout only uses 0 / 90 degree rotations.
  const obstacleGroupPosition = group.position.clone();
  const actualWidth = Math.abs(Math.cos(rotationY)) > 0.5 ? width : depth;
  const actualDepth = Math.abs(Math.cos(rotationY)) > 0.5 ? depth : width;
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base.material);
  proxy.position.copy(obstacleGroupPosition);
  addObstacle(obstacles, proxy, actualWidth, actualDepth, height + 0.2);
  return group;
}

function createPlanter(scene, obstacles, x, z, color = COLORS.orange, scale = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  scene.add(group);

  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 0.82, 0.66, 8),
    standard(COLORS.orangeDeep, { roughness: 0.9 }),
  );
  pot.position.y = 0.33;
  group.add(pot);

  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.92, 0.92, 0.08, 8),
    standard(0x9b6140),
  );
  soil.position.y = 0.69;
  group.add(soil);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.19, 1.2, 7),
    standard(0x9b6140),
  );
  trunk.position.y = 1.25;
  group.add(trunk);

  const crownColors = color === COLORS.teal
    ? [COLORS.teal, COLORS.tealBright]
    : [COLORS.orange, COLORS.orangeBright];
  for (let i = 0; i < 4; i += 1) {
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.7 + (i % 2) * 0.18, 0),
      standard(crownColors[i % crownColors.length], { roughness: 0.82 }),
    );
    crown.position.set(
      Math.cos((i / 4) * Math.PI * 2) * 0.32,
      1.95 + (i % 2) * 0.32,
      Math.sin((i / 4) * Math.PI * 2) * 0.32,
    );
    crown.rotation.set(i * 0.3, i * 0.7, 0);
    group.add(crown);
  }

  const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pot.material);
  proxy.position.set(x, 0, z);
  addObstacle(obstacles, proxy, 1.7 * scale, 1.7 * scale, 2.5 * scale);
  return group;
}

function createGate(scene, x, z, rotationY, label) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  scene.add(group);

  const pillarMaterial = standard(COLORS.cream, { roughness: 0.85 });
  const orangeMaterial = standard(COLORS.orange, { roughness: 0.6 });
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.2, 1.2), pillarMaterial);
    pillar.position.set(side * 3.2, 2.1, 0);
    group.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.35, 1.5), orangeMaterial);
    cap.position.set(side * 3.2, 4.25, 0);
    group.add(cap);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.7, 1.25), orangeMaterial);
    stripe.position.set(side * 3.2, 3.05, 0);
    group.add(stripe);
  }

  const beam = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.66, 1.15), orangeMaterial);
  beam.position.y = 4.8;
  group.add(beam);

  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256;
  signCanvas.height = 96;
  const ctx = signCanvas.getContext('2d');
  ctx.fillStyle = '#fff2dc';
  ctx.beginPath();
  ctx.roundRect(3, 3, 250, 90, 20);
  ctx.fill();
  ctx.fillStyle = '#e95417';
  ctx.font = '700 42px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 49);
  const texture = new THREE.CanvasTexture(signCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.25, 0.85),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  );
  sign.position.set(0, 4.72, -0.6);
  group.add(sign);
  return group;
}

function createWallBanner(scene, x, z, rotationY) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  scene.add(group);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 3.4, 6),
    standard(0x9b6140),
  );
  pole.position.y = 1.7;
  group.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 1.35),
    new THREE.MeshStandardMaterial({
      color: COLORS.orange,
      side: THREE.DoubleSide,
      roughness: 0.8,
    }),
  );
  flag.position.set(0.48, 2.65, 0);
  group.add(flag);
  return flag;
}

export class EnergyCore {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    scene.add(this.group);
    this.position = this.group.position;
    this.health = CONFIG.core.maxHealth;
    this.maxHealth = CONFIG.core.maxHealth;
    this.hitFlash = 0;
    this.pulse = 0;
    this.radius = CONFIG.core.radius;

    const baseMat = standard(COLORS.creamDark, { roughness: 0.82 });
    const trimMat = standard(COLORS.orange, { roughness: 0.55 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.4, 0.52, 12), baseMat);
    base.position.y = 0.26;
    this.group.add(base);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.12, 8, 36), trimMat);
    trim.position.y = 0.55;
    trim.rotation.x = Math.PI / 2;
    this.group.add(trim);

    const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.42, 0.22, 12), standard(0xb98660));
    inner.position.y = 0.6;
    this.group.add(inner);

    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.05, 0),
      new THREE.MeshStandardMaterial({
        color: COLORS.orangeBright,
        emissive: COLORS.orange,
        emissiveIntensity: 1.8,
        roughness: 0.22,
        metalness: 0.1,
        flatShading: true,
        transparent: true,
        opacity: 0.94,
      }),
    );
    this.crystal.scale.y = 1.55;
    this.crystal.position.y = 2.45;
    this.group.add(this.crystal);

    this.ringA = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.045, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd28a }),
    );
    this.ringA.position.y = 2.45;
    this.ringA.rotation.x = 0.42;
    this.group.add(this.ringA);

    this.ringB = new THREE.Mesh(
      new THREE.TorusGeometry(2.05, 0.035, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff0d2 }),
    );
    this.ringB.position.y = 2.45;
    this.ringB.rotation.y = 1.1;
    this.ringB.rotation.x = 0.15;
    this.group.add(this.ringB);

    this.glow = createGlowSprite(COLORS.orange, 8.4, 0.48);
    this.glow.position.y = 2.45;
    this.group.add(this.glow);

    this.light = new THREE.PointLight(COLORS.orange, 2.35, 12, 2);
    this.light.position.set(0, 2.8, 0);
    this.group.add(this.light);

    for (let i = 0; i < 8; i += 1) {
      const shard = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.12 + Math.random() * 0.1),
        new THREE.MeshBasicMaterial({ color: 0xffd08a }),
      );
      shard.userData.angle = (i / 8) * Math.PI * 2;
      shard.userData.radius = 2.2 + Math.random() * 1.1;
      shard.userData.speed = 0.2 + Math.random() * 0.3;
      this.group.add(shard);
      if (!this.shards) this.shards = [];
      this.shards.push(shard);
    }
  }

  damage(amount) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hitFlash = 1;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  update(dt, elapsed) {
    this.crystal.rotation.y += dt * 0.55;
    this.crystal.rotation.z = Math.sin(elapsed * 0.7) * 0.08;
    this.crystal.position.y = 2.45 + Math.sin(elapsed * 1.4) * 0.12;
    this.ringA.rotation.z += dt * 0.4;
    this.ringB.rotation.x += dt * -0.31;
    this.ringB.rotation.y += dt * 0.2;
    this.glow.material.opacity = 0.4 + Math.sin(elapsed * 2) * 0.06;
    this.light.intensity = 2.1 + Math.sin(elapsed * 2.2) * 0.3;

    if (this.shards) {
      for (const shard of this.shards) {
        const angle = shard.userData.angle + elapsed * shard.userData.speed;
        shard.position.set(
          Math.cos(angle) * shard.userData.radius,
          1.35 + Math.sin(elapsed * 1.1 + shard.userData.angle) * 0.5,
          Math.sin(angle) * shard.userData.radius,
        );
        shard.rotation.x += dt;
        shard.rotation.y += dt * 1.3;
      }
    }

    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 3.5);
      this.crystal.material.emissiveIntensity = 1.18 + this.hitFlash * 2.4;
      this.crystal.material.color.setHex(this.hitFlash > 0 ? 0xffffff : COLORS.orangeBright);
      this.light.color.setHex(this.hitFlash > 0 ? 0xffffff : COLORS.orange);
    } else {
      this.crystal.material.emissiveIntensity = 1.18;
      this.crystal.material.color.setHex(COLORS.orangeBright);
      this.light.color.setHex(COLORS.orange);
    }

    const healthRatio = this.health / this.maxHealth;
    if (healthRatio < 0.34) {
      this.crystal.material.emissive.setHex(0xff3f27);
    } else {
      this.crystal.material.emissive.setHex(COLORS.orange);
    }
  }
}

function createSky(scene) {
  const skyGeometry = new THREE.SphereGeometry(120, 32, 18);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(COLORS.skyTop) },
      horizonColor: { value: new THREE.Color(COLORS.skyHorizon) },
      bottomColor: { value: new THREE.Color(0xffd7b3) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color = mix(bottomColor, horizonColor, smoothstep(-0.2, 0.16, h));
        color = mix(color, topColor, smoothstep(0.14, 0.75, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeometry, skyMaterial));

  const sun = createGlowSprite(0xffc06a, 32, 0.72);
  sun.position.set(-38, 32, -72);
  scene.add(sun);

  const sunCore = new THREE.Mesh(
    new THREE.CircleGeometry(3.8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe0a0, fog: false }),
  );
  sunCore.position.set(-38, 32, -73);
  sunCore.lookAt(0, 2, 0);
  scene.add(sunCore);

  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff5e5,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  for (let i = 0; i < 9; i += 1) {
    const cloud = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let j = 0; j < puffs; j += 1) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7 + Math.random(), 1), cloudMaterial);
      puff.position.set(j * 2.1 - puffs, Math.random() * 0.8, Math.random() * 1.2);
      puff.scale.y = 0.42;
      cloud.add(puff);
    }
    cloud.position.set(rand(-60, 60), 22 + rand(0, 13), rand(-70, -32));
    scene.add(cloud);
  }
}

function createHills(scene) {
  const hillMaterials = [
    standard(0xe8b98a, { unique: true }),
    standard(0xdcb18c, { unique: true }),
    standard(0xf0c79c, { unique: true }),
    standard(0xc8a585, { unique: true }),
  ];
  for (let i = 0; i < 28; i += 1) {
    const angle = (i / 28) * Math.PI * 2 + rand(-0.12, 0.12);
    const distance = rand(55, 82);
    const height = rand(7, 22);
    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(rand(7, 13), height, 5, 1),
      hillMaterials[i % hillMaterials.length],
    );
    hill.position.set(Math.cos(angle) * distance, height / 2 - 1.8, Math.sin(angle) * distance);
    hill.rotation.y = rand(0, Math.PI);
    scene.add(hill);
  }

  const outerGround = new THREE.Mesh(
    new THREE.CircleGeometry(130, 48),
    standard(0xd8ae84, { roughness: 1, unique: true }),
  );
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.24;
  scene.add(outerGround);
}

function createPerimeter(scene, obstacles) {
  const wallMaterial = standard(0xf0d6b3, { roughness: 0.92 });
  const capMaterial = standard(0xefa96f, { roughness: 0.7 });
  const half = CONFIG.arenaHalf + 0.7;
  for (const [x, z, width, depth] of [
    [0, -half, 51, 1.1],
    [0, half, 51, 1.1],
    [-half, 0, 1.1, 51],
    [half, 0, 1.1, 51],
  ]) {
    const wall = box(scene, width, 1.3, depth, wallMaterial, x, 0.65, z);
    addObstacle(obstacles, wall, width, depth, 1.3);
    const cap = box(scene, width + 0.1, 0.16, depth + 0.12, capMaterial, x, 1.34, z);
    cap.userData.decor = true;
  }

  for (const [x, z] of [
    [-24.7, -24.7],
    [24.7, -24.7],
    [-24.7, 24.7],
    [24.7, 24.7],
  ]) {
    box(scene, 1.3, 3.2, 1.3, capMaterial, x, 1.6, z);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffe6b0,
        emissive: 0xffa04d,
        emissiveIntensity: 2,
      }),
    );
    lamp.position.set(x, 3.35, z);
    scene.add(lamp);
    const glow = createGlowSprite(COLORS.orange, 2.4, 0.65);
    glow.position.copy(lamp.position);
    scene.add(glow);
  }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.banners = [];
    this.elapsed = 0;
    this.spawnPoints = [
      { id: 'north', label: '北侧', x: 0, z: -22 },
      { id: 'east', label: '东侧', x: 22, z: 0 },
      { id: 'south', label: '南侧', x: 0, z: 22 },
      { id: 'west', label: '西侧', x: -22, z: 0 },
    ];

    this.setupLights();
    createSky(scene);
    createHills(scene);
    this.setupGround();
    createPerimeter(scene, this.obstacles);
    this.core = new EnergyCore(scene);
    this.addCoreCollider();
    this.setupCover();
    this.setupGardens();
    this.setupGates();
    this.setupMotes();
  }

  setupLights() {
    this.scene.background = new THREE.Color(COLORS.skyHorizon);
    this.scene.fog = new THREE.Fog(0xffdfbd, 34, 95);
    const hemisphere = new THREE.HemisphereLight(0xfff1d5, 0xc39d72, 1.85);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffd7ac, 2.5);
    sun.position.set(-18, 30, 12);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xa9e4dc, 0.55);
    fill.position.set(16, 12, -18);
    this.scene.add(fill);
  }

  setupGround() {
    const texture = makeFloorTexture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(7, 7);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.94,
        metalness: 0,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    this.scene.add(floor);

    const centerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(5.8, 40),
      new THREE.MeshStandardMaterial({
        color: 0xf7dfbc,
        roughness: 0.8,
        transparent: true,
        opacity: 0.9,
      }),
    );
    centerDisc.rotation.x = -Math.PI / 2;
    centerDisc.position.y = 0.012;
    this.scene.add(centerDisc);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.8, 0.055, 5, 64),
      new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 0.7 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.025;
    this.scene.add(ring);

    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(0.1, 9),
        new THREE.MeshBasicMaterial({ color: 0xe1b787, transparent: true, opacity: 0.55 }),
      );
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = angle;
      line.position.set(Math.sin(angle) * 11, 0.018, Math.cos(angle) * 11);
      this.scene.add(line);
    }
  }

  addCoreCollider() {
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.set(0, 0, 0);
    addObstacle(this.obstacles, proxy, 3.1, 3.1, 3.2);
  }

  setupCover() {
    const covers = [
      [-7.1, -6.4, 4.4, 1.65, 1.18, 0],
      [7.1, -6.4, 4.4, 1.65, 1.18, 0],
      [-7.1, 6.4, 4.4, 1.65, 1.18, 0],
      [7.1, 6.4, 4.4, 1.65, 1.18, 0],
      [0, -11.2, 5.2, 1.75, 1.28, 0],
      [-14.5, 0, 1.6, 5.6, 1.45, 0],
      [14.5, 0, 1.6, 5.6, 1.45, 0],
      [-10.2, 13.5, 3.1, 1.35, 1.0, Math.PI / 2],
      [10.2, -13.5, 3.1, 1.35, 1.0, Math.PI / 2],
    ];
    for (const cover of covers) {
      createCover(this.scene, this.obstacles, ...cover);
    }

    const crateMaterial = standard(COLORS.cream, { roughness: 0.88 });
    const crateBand = standard(COLORS.teal, { roughness: 0.7 });
    for (const [x, z, s] of [
      [-13.2, 5.2, 1],
      [13.2, -5.2, 1],
      [-4.8, 17.2, 0.8],
      [4.8, -17.2, 0.8],
    ]) {
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      this.scene.add(group);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.45 * s, 1.45 * s, 1.45 * s), crateMaterial);
      crate.position.y = 0.725 * s;
      crate.rotation.y = 0.12;
      group.add(crate);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 0.18 * s, 1.5 * s), crateBand);
      band.position.y = 0.72 * s;
      group.add(band);
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), crate.material);
      proxy.position.set(x, 0, z);
      addObstacle(this.obstacles, proxy, 1.45 * s, 1.45 * s, 1.45 * s);
    }
  }

  setupGardens() {
    createPlanter(this.scene, this.obstacles, -15.6, -15.6, COLORS.orange, 1.2);
    createPlanter(this.scene, this.obstacles, 15.6, -15.6, COLORS.teal, 1.15);
    createPlanter(this.scene, this.obstacles, -15.6, 15.6, COLORS.teal, 1.08);
    createPlanter(this.scene, this.obstacles, 15.6, 15.6, COLORS.orange, 1.22);
    createPlanter(this.scene, this.obstacles, -19.5, 9, COLORS.orange, 0.86);
    createPlanter(this.scene, this.obstacles, 19.5, -9, COLORS.teal, 0.86);
  }

  setupGates() {
    createGate(this.scene, 0, -24, 0, '北门 A');
    createGate(this.scene, 0, 24, Math.PI, '南门 B');
    createGate(this.scene, -24, 0, Math.PI / 2, '西门 C');
    createGate(this.scene, 24, 0, -Math.PI / 2, '东门 D');

    for (const [x, z, rotation] of [
      [-23.7, -8, Math.PI / 2],
      [-23.7, 8, Math.PI / 2],
      [23.7, -8, -Math.PI / 2],
      [23.7, 8, -Math.PI / 2],
      [-8, -23.7, 0],
      [8, -23.7, 0],
      [-8, 23.7, Math.PI],
      [8, 23.7, Math.PI],
    ]) {
      this.banners.push(createWallBanner(this.scene, x, z, rotation));
    }

    const spawnLabels = [
      ['A', 0, -21.5],
      ['B', 0, 21.5],
      ['C', -21.5, 0],
      ['D', 21.5, 0],
    ];
    for (const [label, x, z] of spawnLabels) {
      const sprite = createTextSprite(label, '', {
        width: 160,
        height: 160,
        scale: 1.1,
        titleSize: 74,
        titleColor: '#e95417',
        background: 'rgba(255,244,226,0.68)',
        depthTest: false,
      });
      sprite.position.set(x, 0.2, z);
      sprite.material.rotation = 0;
      this.scene.add(sprite);
    }
  }

  setupMotes() {
    const count = 90;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = rand(-24, 24);
      positions[i * 3 + 1] = rand(0.4, 7.5);
      positions[i * 3 + 2] = rand(-24, 24);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffd18c,
      size: 0.12,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.motes = new THREE.Points(geometry, material);
    this.scene.add(this.motes);
    this.motePositions = positions;
  }

  update(dt, elapsed) {
    this.elapsed = elapsed;
    this.core.update(dt, elapsed);
    const positions = this.motePositions;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] += dt * (0.16 + (i % 7) * 0.008);
      positions[i] += Math.sin(elapsed * 0.25 + i) * dt * 0.055;
      if (positions[i + 1] > 8) positions[i + 1] = 0.35;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < this.banners.length; i += 1) {
      this.banners[i].rotation.z = Math.sin(elapsed * 1.4 + i * 0.8) * 0.08;
    }
    this.ringRotation = (this.ringRotation || 0) + dt;
  }
}

export function buildWorld(scene) {
  return new World(scene);
}
