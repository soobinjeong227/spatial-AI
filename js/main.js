import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, EXTENT, N, CELL, SURFACES, TRAFFIC, FURNITURE_TYPES, SIZES } from './world.js';

const world = new World();

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe6f2');
scene.fog = new THREE.Fog('#cfe6f2', 70, 150);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 400);
camera.position.set(22, 34, 30);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minDistance = 8;
controls.maxDistance = 120;

scene.add(new THREE.HemisphereLight('#ffffff', '#7d8f6a', 1.0));
const sun = new THREE.DirectionalLight('#fff3dd', 1.8);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 140 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: '#8daf72' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ visible: false }));
pickPlane.rotation.x = -Math.PI / 2;
pickPlane.position.y = 0.1;
scene.add(pickPlane);

const staticGroup = new THREE.Group();
const furnitureGroup = new THREE.Group();
const carGroup = new THREE.Group();
const humanGroup = new THREE.Group();
const pathGroup = new THREE.Group();
scene.add(staticGroup, furnitureGroup, carGroup, humanGroup, pathGroup);

// ---------- helpers ----------
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
const sphere = new THREE.SphereGeometry(0.5, 16, 12);
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}
function mesh(parent, geo, material, pos, scale = [1, 1, 1], { shadow = true, rotY = 0 } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.y = rotY;
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
// Seeded random so decorations stay put between rebuilds.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// Box spanning along-range [a0,a1] and lateral-range [l0,l1] of a street.
function streetBox(parent, s, a0, a1, l0, l1, y0, y1, material, shadow = false) {
  const c = world.toWorld(s, (a0 + a1) / 2, (l0 + l1) / 2);
  const sa = a1 - a0, sl = l1 - l0;
  const scale = s.axis === 'x' ? [sa, y1 - y0, sl] : [sl, y1 - y0, sa];
  return mesh(parent, box, material, [c.x, (y0 + y1) / 2, c.z], scale, { shadow });
}

const SURFACE_LOOK = {
  road: {
    good: { color: '#3d4148', roughness: 0.9 },
    wet: { color: '#2b3036', roughness: 0.18, metalness: 0.25 },
    icy: { color: '#b8cad8', roughness: 0.12, metalness: 0.1 },
    damaged: { color: '#4d4842', roughness: 1 },
  },
  sidewalk: {
    good: { color: '#cdc9c0', roughness: 0.9 },
    wet: { color: '#9a9893', roughness: 0.2, metalness: 0.15 },
    icy: { color: '#e6f0f6', roughness: 0.1, metalness: 0.05 },
    damaged: { color: '#b9ab96', roughness: 1 },
  },
};
const surfMat = (kind, cond) => { const l = SURFACE_LOOK[kind][cond]; return mat(l.color, { roughness: l.roughness, metalness: l.metalness ?? 0 }); };

export const SIDEWALK_Y = 0.18, ROAD_Y = 0.06;

// ---------- static world (streets, crosswalks, buildings, signals) ----------
const signalHeads = [];
function buildStatic() {
  staticGroup.clear();
  signalHeads.length = 0;
  const [main, oak] = world.streets;

  // Intersection box.
  mesh(staticGroup, box, surfMat('road', 'good'), [0, ROAD_Y / 2, 0], [oak.width, ROAD_Y, main.width], { shadow: false });

  for (const s of world.streets) {
    const o = world.other(s);
    const isFirst = s === world.streets[0];
    const roadSegs = [[-EXTENT, -o.width / 2], [o.width / 2, EXTENT]];
    // Sidewalk corners belong to the first street (same as World.classify).
    const walkCut = isFirst ? o.width / 2 : o.width / 2 + o.sidewalk;
    const walkSegs = [[-EXTENT, -walkCut], [walkCut, EXTENT]];

    for (const [a0, a1] of roadSegs) streetBox(staticGroup, s, a0, a1, -s.width / 2, s.width / 2, 0, ROAD_Y, surfMat('road', s.surface_condition));
    for (const side of [-1, 1]) {
      for (const [a0, a1] of walkSegs) {
        const l0 = side * s.width / 2, l1 = side * (s.width / 2 + s.sidewalk);
        streetBox(staticGroup, s, a0, a1, Math.min(l0, l1), Math.max(l0, l1), 0, SIDEWALK_Y, surfMat('sidewalk', s.surface_condition));
        // Curb.
        const lc = side * (s.width / 2 + 0.08);
        streetBox(staticGroup, s, a0, a1, lc - 0.08, lc + 0.08, 0, SIDEWALK_Y + 0.01, mat('#a9a59c'));
      }
    }
    decorateSurface(s, roadSegs, walkSegs);
    paintMarkings(s, roadSegs);
  }

  buildBuildings(main, oak);
  buildSignals(main, oak);
}

function decorateSurface(s, roadSegs, walkSegs) {
  const r = rng(s.id === 'main' ? 7 : 13);
  const cond = s.surface_condition;
  if (cond === 'good') return;
  const look = {
    wet: { color: '#5b6a78', count: 26, size: [1.2, 3], opts: { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.7 } },
    icy: { color: '#f4fbff', count: 30, size: [0.8, 2.4], opts: { roughness: 0.05, transparent: true, opacity: 0.8 } },
    damaged: { color: '#26231f', count: 34, size: [0.3, 1.2], opts: { roughness: 1 } },
  }[cond];
  const m = mat(look.color, look.opts);
  for (let k = 0; k < look.count; k++) {
    const onRoad = r() < 0.6;
    const segs = onRoad ? roadSegs : walkSegs;
    const [a0, a1] = segs[Math.floor(r() * 2)];
    const a = a0 + r() * (a1 - a0);
    const side = r() < 0.5 ? -1 : 1;
    const lat = onRoad ? (r() - 0.5) * (s.width - 1) : side * (s.width / 2 + 0.4 + r() * (s.sidewalk - 0.8));
    const sz = look.size[0] + r() * (look.size[1] - look.size[0]);
    const p = world.toWorld(s, a, lat);
    const y = (onRoad ? ROAD_Y : SIDEWALK_Y) + 0.004;
    const scale = cond === 'damaged' && r() < 0.5 ? [sz * 2.2, 0.006, 0.08] : [sz, 0.006, sz * (0.5 + r() * 0.5)];
    mesh(staticGroup, cond === 'damaged' && scale[2] === 0.08 ? box : cyl, m, [p.x, y, p.z], scale, { shadow: false, rotY: r() * Math.PI });
  }
}

function paintMarkings(s, roadSegs) {
  const white = mat('#f4f2ea', { roughness: 0.6 });
  const yellow = mat('#f2c230', { roughness: 0.6 });
  const y0 = ROAD_Y, y1 = ROAD_Y + 0.008;
  const cws = world.crosswalks(s);
  const lanes = world.lanes(s);

  for (const [a0, a1] of roadSegs) {
    if (s.traffic_direction === 'two-way') {
      for (const l of [-0.12, 0.12]) streetBox(staticGroup, s, a0, a1, l - 0.05, l + 0.05, y0, y1, yellow);
    } else if (lanes.length > 1) {
      for (let a = a0 + 1; a < a1 - 2; a += 4) streetBox(staticGroup, s, a, a + 2, -0.06, 0.06, y0, y1, white);
    }
    for (const side of [-1, 1]) {
      const l = side * (s.width / 2 - 0.35);
      streetBox(staticGroup, s, a0, a1, l - 0.05, l + 0.05, y0, y1, white);
    }
  }
  // Direction arrows per lane.
  const arrowGeo = new THREE.ConeGeometry(0.45, 1.6, 3);
  arrowGeo.rotateX(Math.PI / 2);
  for (const lane of lanes) {
    for (const a of [-30, -17, 17, 30]) {
      const p = world.toWorld(s, a, lane.lat);
      const m = mesh(staticGroup, arrowGeo, white, [p.x, y1, p.z], [1, 0.02, 1], { shadow: false });
      const fx = s.axis === 'x' ? lane.dir : 0, fz = s.axis === 'x' ? 0 : lane.dir;
      m.rotation.y = Math.atan2(fx, fz);
    }
  }
  // Zebra crosswalks.
  for (const cw of cws) {
    for (let l = -s.width / 2 + 0.6; l < s.width / 2 - 0.4; l += 1.0) {
      streetBox(staticGroup, s, cw.at - cw.half, cw.at + cw.half, l, l + 0.5, y0, y1 + 0.002, white);
    }
  }
  // Stop lines.
  for (const dir of [1, -1]) {
    const dirLanes = lanes.filter((ln) => ln.dir === dir);
    if (!dirLanes.length) continue;
    const at = world.stopLine(s, dir);
    const ls = dirLanes.map((ln) => ln.lat);
    const half = s.traffic_direction === 'two-way' ? s.width / 4 : s.width / 2 / dirLanes.length;
    const l0 = Math.min(...ls) - half + 0.2, l1 = Math.max(...ls) + half - 0.2;
    streetBox(staticGroup, s, at - 0.2, at + 0.2, Math.max(l0, -s.width / 2 + 0.2), Math.min(l1, s.width / 2 - 0.2), y0, y1, white);
  }
}

function buildBuildings(main, oak) {
  const r = rng(42);
  const palette = ['#d9c7a7', '#b9c4cf', '#c98f6f', '#e8e1d3', '#9aa8b5', '#d4a373', '#a3b18a'];
  const x0 = oak.width / 2 + oak.sidewalk + 1.5, z0 = main.width / 2 + main.sidewalk + 1.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // A row of buildings along each street frontage of this block.
      for (let a = x0; a < EXTENT - 4; a += 0) {
        const w = 6 + r() * 6, d = 6 + r() * 4, h = 2.8 + r() * 4;
        if (a + w > EXTENT) break;
        mesh(staticGroup, box, mat(palette[Math.floor(r() * palette.length)]), [sx * (a + w / 2), h / 2, sz * (z0 + d / 2)], [w, h, d]);
        a += w + 1 + r() * 2;
      }
      for (let a = z0 + 14; a < EXTENT - 4; a += 0) {
        const w = 6 + r() * 6, d = 6 + r() * 3, h = 2.8 + r() * 4;
        if (a + w > EXTENT) break;
        mesh(staticGroup, box, mat(palette[Math.floor(r() * palette.length)]), [sx * (x0 + d / 2), h / 2, sz * (a + w / 2)], [d, h, w]);
        a += w + 1 + r() * 2;
      }
    }
  }
}

function buildSignals(main, oak) {
  const pole = mat('#3a3f45');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (oak.width / 2 + 0.5), z = sz * (main.width / 2 + 0.5);
      mesh(staticGroup, cyl, pole, [x, 1.8, z], [0.14, 3.6, 0.14]);
      // One head facing each street.
      for (const s of [main, oak]) {
        const head = mesh(staticGroup, box, pole, [x, 3.4, z], [0.35, 0.9, 0.35]);
        const lamp = mesh(staticGroup, sphere, new THREE.MeshStandardMaterial({ color: '#333', emissive: '#000' }),
          [x + (s === main ? 0 : 0), 3.4, z], [0.22, 0.22, 0.22], { shadow: false });
        if (s === main) { head.position.y = 3.4; lamp.position.y = 3.6; } else { head.position.y = 2.6; lamp.position.y = 2.8; }
        signalHeads.push({ streetId: s.id, lamp });
      }
    }
  }
}

const SIGNAL_COLOR = { green: '#2ecc71', yellow: '#f1c40f', red: '#e74c3c' };
function updateSignals() {
  for (const h of signalHeads) {
    const c = SIGNAL_COLOR[world.signalFor(h.streetId)];
    h.lamp.material.color.set(c);
    h.lamp.material.emissive.set(c);
  }
}

// ---------- street furniture ----------
function buildFurnitureMesh(f) {
  const g = new THREE.Group();
  const { w, d, h } = world.furnitureDims(f);
  const k = SIZES[f.size];
  const metal = mat('#4b5258'), wood = mat('#9a6a3d'), green = mat('#3f7d3a');
  switch (f.type) {
    case 'bench':
      mesh(g, box, wood, [0, 0.45 * k, 0], [w, 0.08, d]);
      mesh(g, box, wood, [0, 0.8 * k, -d / 2 + 0.05], [w, 0.4 * k, 0.06]);
      for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) mesh(g, box, metal, [x, 0.22 * k, 0], [0.08, 0.45 * k, d * 0.9]);
      break;
    case 'lamp':
      mesh(g, cyl, metal, [0, h / 2, 0], [0.14 * k, h, 0.14 * k]);
      mesh(g, box, metal, [0, h, 0.4], [0.18, 0.1, 0.9]);
      mesh(g, sphere, mat('#fff6c8', { emissive: '#d8c060' }), [0, h - 0.08, 0.8], [0.3, 0.18, 0.3], { shadow: false });
      break;
    case 'bin':
      mesh(g, cyl, mat('#2f6d4f'), [0, h / 2, 0], [w, h, d]);
      mesh(g, cyl, metal, [0, h + 0.03, 0], [w * 1.05, 0.06, d * 1.05]);
      break;
    case 'planter':
      mesh(g, box, mat('#8c7b6a'), [0, h * 0.35, 0], [w, h * 0.7, d]);
      mesh(g, sphere, green, [0, h * 0.85, 0], [w * 0.9, h * 0.7, d * 0.9]);
      break;
    case 'tree':
      mesh(g, box, mat('#6b5a45'), [0, 0.02, 0], [w, 0.04, d], { shadow: false });
      mesh(g, cyl, mat('#6d4c2f'), [0, h * 0.3, 0], [0.25 * k, h * 0.6, 0.25 * k]);
      mesh(g, sphere, green, [0, h * 0.72, 0], [2.4 * k, 2.6 * k, 2.4 * k]);
      break;
    case 'bollard':
      mesh(g, cyl, mat('#2d3238'), [0, h / 2, 0], [w, h, d]);
      mesh(g, cyl, mat('#f1c40f'), [0, h * 0.8, 0], [w * 1.02, 0.08, d * 1.02]);
      break;
    case 'hydrant':
      mesh(g, cyl, mat('#c0392b'), [0, h / 2, 0], [w, h, d]);
      mesh(g, sphere, mat('#c0392b'), [0, h, 0], [w, w * 0.8, d]);
      mesh(g, cyl, mat('#c0392b'), [0, h * 0.6, 0], [w * 1.5, 0.12, 0.12]);
      break;
    case 'bus_stop':
      mesh(g, box, mat('#9fd3f0', { transparent: true, opacity: 0.45, roughness: 0.1 }), [0, h / 2, -d / 2 + 0.05], [w, h, 0.05]);
      for (const x of [-w / 2, w / 2]) mesh(g, box, metal, [x, h / 2, 0], [0.08, h, d]);
      mesh(g, box, mat('#2d6cdf'), [0, h, 0], [w + 0.2, 0.12, d + 0.2]);
      mesh(g, box, wood, [0, 0.45, -d / 4], [w * 0.8, 0.08, 0.4]);
      break;
    case 'barrier':
      for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) mesh(g, box, metal, [x, h / 2, z], [0.06, h, 0.06]);
      for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) {
        mesh(g, box, mat('#e74c3c'), [0, h * 0.85, z], [w, 0.18, 0.05]);
        mesh(g, box, mat('#f5f5f5'), [0, h * 0.55, z], [w, 0.18, 0.05]);
      }
      mesh(g, cyl, mat('#ff7b00'), [0, 0.35, 0], [0.4, 0.7, 0.4]);
      break;
    case 'manhole':
      mesh(g, cyl, mat('#55595e', { metalness: 0.5, roughness: 0.5 }), [0, 0.012, 0], [w, 0.025, d], { shadow: false });
      break;
    case 'grate':
      mesh(g, box, mat('#3b3f44', { metalness: 0.5 }), [0, 0.012, 0], [w, 0.025, d], { shadow: false });
      break;
  }
  // Obstacle footprint (obstacle_status = true) vs. passable (false).
  const fp = mesh(g, box, new THREE.MeshBasicMaterial({
    color: f.obstacle_status ? '#ff3b30' : '#34c759', transparent: true, opacity: 0.28, depthWrite: false,
  }), [0, 0.015, 0], [w + 0.1, 0.01, d + 0.1], { shadow: false });
  fp.userData.footprint = true;
  const s = world.street(f.streetId);
  const p = world.furniturePos(f);
  g.position.set(p.x, SIDEWALK_Y, p.z);
  // Local +z faces the roadway; local x runs along the street.
  const toRoad = -f.side;
  g.rotation.y = s.axis === 'x' ? (toRoad > 0 ? 0 : Math.PI) : (toRoad > 0 ? Math.PI / 2 : -Math.PI / 2);
  g.userData.furnitureId = f.id;
  return g;
}

function buildFurniture() {
  furnitureGroup.clear();
  for (const f of world.furniture) furnitureGroup.add(buildFurnitureMesh(f));
}

// ---------- cars ----------
const carMeshes = new Map();
function carMesh(c) {
  const g = new THREE.Group();
  const body = mat(c.color, { roughness: 0.35, metalness: 0.3 });
  mesh(g, box, body, [0, 0.55, 0], [1.8, 0.6, 4.2]);
  mesh(g, box, mat('#24303a', { roughness: 0.2 }), [0, 1.05, -0.2], [1.6, 0.5, 2.2]);
  for (const x of [-0.8, 0.8]) for (const z of [-1.3, 1.3]) {
    const wheel = mesh(g, cyl, mat('#1b1b1b'), [x, 0.32, z], [0.62, 0.25, 0.62]);
    wheel.rotation.z = Math.PI / 2;
  }
  for (const x of [-0.6, 0.6]) mesh(g, box, mat('#fffbe0', { emissive: '#d9d29a' }), [x, 0.6, 2.11], [0.35, 0.15, 0.02], { shadow: false });
  for (const x of [-0.6, 0.6]) mesh(g, box, mat('#8a1010', { emissive: '#400' }), [x, 0.6, -2.11], [0.35, 0.15, 0.02], { shadow: false });
  return g;
}
function updateCars() {
  const live = new Set();
  for (const c of world.cars) {
    live.add(c.id);
    let g = carMeshes.get(c.id);
    if (!g) { g = carMesh(c); carMeshes.set(c.id, g); carGroup.add(g); }
    const s = world.street(c.streetId);
    const p = world.carPos(c);
    g.position.set(p.x, ROAD_Y, p.z);
    g.rotation.y = s.axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
    g.visible = Math.abs(c.along) < EXTENT + 2;
  }
  for (const [id, g] of carMeshes) if (!live.has(id)) { carGroup.remove(g); carMeshes.delete(id); }
}

// ---------- humans ----------
const MOVEMENT_COLOR = {
  moving: '#34c759', avoiding: '#ff9500', rerouting: '#af52de', waiting: '#ffcc00',
  turning: '#5ac8fa', stopped: '#ff3b30', arrived: '#8e8e93',
};
const humanViews = new Map();
const ringGeo = new THREE.RingGeometry(0.42, 0.55, 32);
ringGeo.rotateX(-Math.PI / 2);
const selRingGeo = new THREE.RingGeometry(0.7, 0.8, 40);
selRingGeo.rotateX(-Math.PI / 2);
const noseGeo = new THREE.ConeGeometry(0.12, 0.35, 10);
noseGeo.rotateX(Math.PI / 2);

function humanView(h) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  mesh(body, new THREE.CapsuleGeometry(0.22, 0.75, 4, 12), mat(h.color), [0, 0.62, 0]);
  mesh(body, sphere, mat('#f1c9a5'), [0, 1.42, 0], [0.32, 0.34, 0.32]);
  mesh(body, noseGeo, mat('#ffffff'), [0, 1.0, 0.3], [1, 1, 1], { shadow: false });
  const ring = mesh(g, ringGeo, new THREE.MeshBasicMaterial({ color: '#34c759', side: THREE.DoubleSide }), [0, 0.02, 0], [1, 1, 1], { shadow: false });
  const sel = mesh(g, selRingGeo, new THREE.MeshBasicMaterial({ color: '#1f6feb', side: THREE.DoubleSide }), [0, 0.03, 0], [1, 1, 1], { shadow: false });
  g.userData.humanId = h.id;
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: h.color, dashSize: 0.5, gapSize: 0.3 }));
  const flag = new THREE.Group();
  mesh(flag, cyl, mat('#555'), [0, 0.9, 0], [0.06, 1.8, 0.06]);
  const cloth = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 3), mat(h.color));
  cloth.rotation.z = -Math.PI / 2;
  cloth.position.set(0.4, 1.55, 0);
  flag.add(cloth);
  pathGroup.add(line, flag);
  humanGroup.add(g);
  return { g, body, ring, sel, line, flag, y: SIDEWALK_Y };
}

function updateHumans(t, dt) {
  const live = new Set();
  for (const h of world.humans) {
    live.add(h.id);
    let v = humanViews.get(h.id);
    if (!v) { v = humanView(h); humanViews.set(h.id, v); }
    const kind = world.kindAt(h.position.x, h.position.z);
    const targetY = kind === 'sidewalk' ? SIDEWALK_Y : ROAD_Y;
    v.y += (targetY - v.y) * Math.min(1, dt * 12);
    v.g.position.set(h.position.x, v.y, h.position.z);
    v.g.rotation.y = Math.atan2(Math.cos(h.direction), Math.sin(h.direction));
    v.body.position.y = h.speed > 0.2 ? Math.abs(Math.sin(t * 9 + h.id)) * 0.06 : 0;
    v.ring.material.color.set(MOVEMENT_COLOR[h.movement] ?? '#fff');
    v.sel.visible = selection?.type === 'human' && selection.id === h.id;

    // Remaining route + destination flag.
    const pts = h.mode === 'route' && h.path.length ? [h.position, ...h.path.slice(h.pathIndex)] : [];
    v.line.visible = pts.length > 1 && showPaths;
    if (v.line.visible) {
      v.line.geometry.setFromPoints(pts.map((p) => new THREE.Vector3(p.x, SIDEWALK_Y + 0.12, p.z)));
      v.line.computeLineDistances();
    }
    v.flag.visible = !!h.goal && showPaths && h.movement !== 'arrived';
    if (h.goal) v.flag.position.set(h.goal.x, SIDEWALK_Y, h.goal.z);
  }
  for (const [id, v] of humanViews) {
    if (live.has(id)) continue;
    humanGroup.remove(v.g);
    pathGroup.remove(v.line, v.flag);
    humanViews.delete(id);
  }
}

// ---------- traversable overlay ----------
const overlayData = new Uint8Array(N * N * 4);
const overlayTex = new THREE.DataTexture(overlayData, N, N);
overlayTex.magFilter = THREE.NearestFilter;
const overlay = new THREE.Mesh(
  new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2),
  new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, depthWrite: false }),
);
overlay.rotation.x = -Math.PI / 2;
overlay.position.y = SIDEWALK_Y + 0.03;
overlay.visible = false;
overlay.renderOrder = 2;
scene.add(overlay);
function updateOverlay() {
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // Plane UV v runs opposite to world z after the rotation.
      const k = ((N - 1 - j) * N + i) * 4;
      const walk = world.walkableCell(i, j);
      const kind = world.kind[j * N + i];
      const blocked = world.blocked[j * N + i] && (kind === 1 || kind === 2);
      const c = walk ? [52, 199, 89, 110] : blocked ? [255, 59, 48, 170] : kind === 3 || kind === 4 ? [255, 59, 48, 45] : [0, 0, 0, 0];
      overlayData.set(c, k);
    }
  }
  overlayTex.needsUpdate = true;
}

// ---------- interaction ----------
let selection = { type: 'human', id: world.humans[0].id };
let tool = 'select';
let furnitureType = 'bench';
let paused = false;
let showPaths = true;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([humanGroup, furnitureGroup], true);
  for (const hit of hits) {
    for (let o = hit.object; o; o = o.parent) {
      if (o.userData.humanId) return { type: 'human', id: o.userData.humanId, point: hit.point };
      if (o.userData.furnitureId) return { type: 'furniture', id: o.userData.furnitureId, point: hit.point };
    }
  }
  const g = raycaster.intersectObject(pickPlane)[0];
  if (!g) return null;
  const c = world.classify(g.point.x, g.point.z);
  return { type: c.street ? 'street' : 'ground', id: c.street?.id, point: g.point, cls: c };
}

function groundPoint(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const g = raycaster.intersectObject(pickPlane)[0];
  return g ? { x: g.point.x, z: g.point.z } : null;
}

const hoverMarker = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.6, depthWrite: false }));
hoverMarker.rotation.x = -Math.PI / 2;
hoverMarker.visible = false;
scene.add(hoverMarker);

function toolCheck(p) {
  if (tool === 'goal') {
    if (selection?.type !== 'human') return 'Select a human first.';
    return world.walkableAt(p.x, p.z) ? null : 'Destination must be on a traversable surface.';
  }
  if (tool === 'furniture') return world.checkPlaceFurniture(p.x, p.z);
  if (tool === 'human') return world.walkableAt(p.x, p.z) ? null : 'A human must stand on a traversable surface.';
  return null;
}

let downAt = null;
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
  if (tool === 'select') {
    const p = pick(ev);
    selection = p && p.type !== 'ground' ? { type: p.type, id: p.id } : null;
    renderInspector();
    return;
  }
  const p = groundPoint(ev);
  if (!p) return;
  const reason = toolCheck(p);
  if (reason) return toast(reason, 'err');
  if (tool === 'goal') {
    const h = world.humanById(selection.id);
    report(world.setGoal(h, p));
  } else if (tool === 'furniture') {
    const r = world.addFurniture(furnitureType, p.x, p.z);
    report(r);
  } else if (tool === 'human') {
    const r = world.addHuman(p.x, p.z, { direction: Math.random() * Math.PI * 2 });
    report(r);
    if (r.ok) { selection = { type: 'human', id: r.human.id }; renderInspector(); }
  }
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  const p = groundPoint(ev);
  const status = document.getElementById('status');
  if (!p) { hoverMarker.visible = false; return; }
  const c = world.classify(p.x, p.z);
  const where = c.street ? `${c.street.name} · ${c.kind}` : c.kind;
  if (tool === 'select') {
    hoverMarker.visible = false;
    status.textContent = `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) · ${where} · ${world.walkableAt(p.x, p.z) ? 'traversable' : 'not traversable'}`;
    status.className = '';
    return;
  }
  const reason = toolCheck(p);
  hoverMarker.visible = true;
  hoverMarker.position.set(p.x, (c.kind === 'sidewalk' ? SIDEWALK_Y : ROAD_Y) + 0.05, p.z);
  hoverMarker.material.color.set(reason ? '#ff3b30' : '#34c759');
  status.textContent = reason ?? `${TOOL_INFO[tool].label} at ${where}: allowed.`;
  status.className = reason ? 'err' : 'ok';
});
renderer.domElement.addEventListener('pointerleave', () => { hoverMarker.visible = false; });

function report(r) {
  if (!r) return;
  toast(r.ok ? r.msg : r.reason, r.ok ? 'ok' : 'err');
  renderInspector();
}

// ---------- toolbar ----------
const ACTIONS = {
  move:    { label: 'MOVE',    key: 'm', run: (h) => world.actMove(h) },
  turnL:   { label: 'TURN ⟲',  key: 'q', run: (h) => world.actTurn(h, -1) },
  turnR:   { label: 'TURN ⟳',  key: 'e', run: (h) => world.actTurn(h, 1) },
  stop:    { label: 'STOP',    key: 's', run: (h) => world.actStop(h) },
  avoid:   { label: 'AVOID',   key: 'a', run: (h) => world.actAvoid(h) },
  reroute: { label: 'REROUTE', key: 'r', run: (h) => world.actReroute(h) },
};
const TOOL_INFO = {
  select:    { label: 'Select',    key: '1' },
  goal:      { label: 'Set goal',  key: '2' },
  furniture: { label: 'Place',     key: '3' },
  human:     { label: 'Add human', key: '4' },
};

function selectedHuman() { return selection?.type === 'human' ? world.humanById(selection.id) : null; }

function runAction(id) {
  const h = selectedHuman();
  if (!h) return toast('Select a human to give it an action.', 'err');
  h.auto = false; // manual control: autopilot stays off until re-enabled in the inspector
  report(ACTIONS[id].run(h));
}

function renderToolbar() {
  const tb = document.getElementById('toolbar');
  const h = selectedHuman();
  tb.innerHTML = `
    <div class="group" aria-label="Human actions">
      <span class="glabel">${h ? `<span class="dot" style="background:${h.color}"></span>${h.name}` : 'Human'}</span>
      ${Object.entries(ACTIONS).map(([id, a]) => `<button class="act" data-action="${id}" ${h ? '' : 'disabled'} title="${a.label} (${a.key.toUpperCase()})">${a.label}</button>`).join('')}
    </div>
    <div class="group" aria-label="Tools">
      ${Object.entries(TOOL_INFO).map(([id, t]) => `<button class="${tool === id ? 'active' : ''}" data-tool="${id}" title="${t.label} (${t.key})">${t.label}${id === 'furniture' ? '' : ''}<kbd>${t.key}</kbd></button>`).join('')}
      <select id="ftype" title="Street furniture type">
        ${Object.entries(FURNITURE_TYPES).map(([id, t]) => `<option value="${id}" ${id === furnitureType ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="group" aria-label="View">
      <button data-view="overlay" class="${overlay.visible ? 'active' : ''}" title="Show traversable surface (O)">Traversable</button>
      <button data-view="paths" class="${showPaths ? 'active' : ''}" title="Show routes (P)">Routes</button>
      <button data-view="pause" title="Pause / resume (Space)">${paused ? '▶ Play' : '❚❚ Pause'}</button>
      <button data-view="reset" title="Reload the example">Reset</button>
    </div>`;
  tb.querySelectorAll('[data-action]').forEach((b) => (b.onclick = () => runAction(b.dataset.action)));
  tb.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  tb.querySelector('#ftype').onchange = (e) => { furnitureType = e.target.value; setTool('furniture'); };
  tb.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => view(b.dataset.view)));
}

function setTool(id) { tool = id; renderToolbar(); }
function view(id) {
  if (id === 'overlay') overlay.visible = !overlay.visible;
  if (id === 'paths') showPaths = !showPaths;
  if (id === 'pause') paused = !paused;
  if (id === 'reset') {
    world.reset();
    selection = { type: 'human', id: world.humans[0].id };
    toast('Reloaded the example street.', 'ok');
  }
  renderToolbar();
  renderInspector();
}

// ---------- inspector ----------
const inspector = document.getElementById('inspector');
const fmtDeg = (r) => `${Math.round(((r * 180 / Math.PI) + 360) % 360)}°`;
const compass = (r) => ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][Math.round((((r * 180 / Math.PI) + 360) % 360) / 45) % 8];
const row = (k, v, field = '') => `<tr><th>${k}</th><td ${field ? `data-f="${field}"` : ''}>${v}</td></tr>`;

function renderInspector() {
  renderToolbar();
  if (!selection) {
    inspector.innerHTML = `<h2>Inspector</h2><p class="muted">Click a human, a piece of street furniture or a street to inspect it.</p>`;
    return;
  }
  if (selection.type === 'human') {
    const h = world.humanById(selection.id);
    if (!h) { selection = null; return renderInspector(); }
    inspector.innerHTML = `
      <div class="ent">HUMAN</div>
      <h2><span class="dot" style="background:${h.color}"></span>${h.name}</h2>
      <table>
        ${row('position', '', 'pos')}
        ${row('movement', '', 'movement')}
        ${row('direction', '', 'dir')}
        ${row('speed', '', 'speed')}
      </table>
      <h3>Relationship</h3>
      <table>${row('PASSING →', '', 'passing')}${row('surface', '', 'surface')}</table>
      <h3>State</h3>
      <table>${row('mode', '', 'mode')}${row('destination', '', 'goal')}${row('last action', '', 'last')}</table>
      <div class="actions">
        <button data-h="slower">− speed</button><button data-h="faster">+ speed</button>
        <button data-h="auto" class="${h.auto ? 'on' : ''}">Autopilot: ${h.auto ? 'on' : 'off'}</button>
        <button data-h="goal">Set goal…</button>
        <button data-h="remove" class="danger">Remove</button>
      </div>`;
    inspector.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.h;
      if (a === 'slower') h.baseSpeed = Math.max(0.5, +(h.baseSpeed - 0.2).toFixed(1));
      if (a === 'faster') h.baseSpeed = Math.min(2.4, +(h.baseSpeed + 0.2).toFixed(1));
      if (a === 'auto') h.auto = !h.auto;
      if (a === 'goal') return setTool('goal');
      if (a === 'remove') { world.removeHuman(h.id); selection = null; }
      renderInspector();
    }));
    refreshInspector();
  } else if (selection.type === 'furniture') {
    const f = world.furnitureById(selection.id);
    if (!f) { selection = null; return renderInspector(); }
    const s = world.street(f.streetId);
    const p = world.furniturePos(f);
    const dims = world.furnitureDims(f);
    inspector.innerHTML = `
      <div class="ent">STREET_FURNITURE</div>
      <h2>${FURNITURE_TYPES[f.type].label} #${f.id}</h2>
      <table>
        ${row('position', `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)}
        ${row('size', `${f.size} · ${dims.w.toFixed(1)} × ${dims.d.toFixed(1)} × ${dims.h.toFixed(1)} m`)}
        ${row('type', `<select data-fsel="type">${Object.entries(FURNITURE_TYPES).map(([id, t]) => `<option value="${id}" ${id === f.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select>`)}
        ${row('obstacle_status', `<span class="chip ${f.obstacle_status ? 'bad' : 'good'}">${f.obstacle_status}</span>`)}
      </table>
      <h3>Relationship</h3>
      <table>${row('OCCUPY →', `${s.name} (${sideName(s, f.side)} sidewalk)`)}</table>
      <div class="actions">
        <button data-fa="obstacle">Toggle obstacle_status</button>
        <button data-fa="size">Size: ${f.size} → ${nextSize(f.size)}</button>
        <button data-fa="remove" class="danger">Remove</button>
      </div>`;
    inspector.querySelector('[data-fsel="type"]').onchange = (e) => {
      world.updateFurniture(f.id, { type: e.target.value, obstacle_status: FURNITURE_TYPES[e.target.value].obstacle });
      renderInspector();
    };
    inspector.querySelectorAll('[data-fa]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.fa;
      if (a === 'obstacle') { world.updateFurniture(f.id, { obstacle_status: !f.obstacle_status }); toast(`obstacle_status = ${f.obstacle_status}`, 'ok'); }
      if (a === 'size') world.updateFurniture(f.id, { size: nextSize(f.size) });
      if (a === 'remove') { world.removeFurniture(f.id); selection = null; }
      renderInspector();
    }));
  } else if (selection.type === 'street') {
    const s = world.street(selection.id);
    const passing = world.humans.filter((h) => h.passing === s.id);
    const occupying = world.furniture.filter((f) => f.streetId === s.id);
    inspector.innerHTML = `
      <div class="ent">STREET</div>
      <h2>${s.name}</h2>
      <table>
        ${row('width', `<button class="mini" data-s="w-">−</button> ${s.width} m <button class="mini" data-s="w+">+</button>`)}
        ${row('surface_condition', `<select data-ssel="surface_condition">${Object.entries(SURFACES).map(([id, v]) => `<option value="${id}" ${id === s.surface_condition ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`)}
        ${row('traffic_direction', `<select data-ssel="traffic_direction">${TRAFFIC.map((t) => `<option ${t === s.traffic_direction ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
        ${row('crosswalk_presence', `<label class="switch"><input type="checkbox" data-s="cw" ${s.crosswalk_presence ? 'checked' : ''}> ${s.crosswalk_presence}</label>`)}
      </table>
      <p class="muted small">Walking speed ×${SURFACES[s.surface_condition].walk}, driving ×${SURFACES[s.surface_condition].drive}. ${s.traffic_direction === 'two-way' ? 'Pedestrians check both directions.' : `Traffic runs toward ${s.axis === 'x' ? (s.traffic_direction.endsWith('+') ? 'east' : 'west') : (s.traffic_direction.endsWith('+') ? 'south' : 'north')}.`}</p>
      <h3>Relationships</h3>
      <table>
        ${row('← PASSING', passing.length ? passing.map((h) => `<span class="dot" style="background:${h.color}"></span>${h.name}`).join(' ') : '<span class="muted">nobody</span>', 'passingList')}
        ${row('← OCCUPY', `${occupying.length} furniture (${occupying.filter((f) => f.obstacle_status).length} obstacles)`)}
      </table>`;
    inspector.querySelectorAll('[data-s]').forEach((el) => {
      const a = el.dataset.s;
      const fn = () => {
        if (a === 'w-') world.updateStreet(s.id, { width: s.width - 1 });
        if (a === 'w+') world.updateStreet(s.id, { width: s.width + 1 });
        if (a === 'cw') world.updateStreet(s.id, { crosswalk_presence: el.checked });
        renderInspector();
      };
      if (el.tagName === 'INPUT') el.onchange = fn; else el.onclick = fn;
    });
    inspector.querySelectorAll('[data-ssel]').forEach((el) => (el.onchange = () => {
      world.updateStreet(s.id, { [el.dataset.ssel]: el.value });
      renderInspector();
    }));
  }
}

const nextSize = (s) => ({ S: 'M', M: 'L', L: 'S' }[s]);
function sideName(s, side) {
  if (s.axis === 'x') return side > 0 ? 'south' : 'north';
  return side > 0 ? 'east' : 'west';
}

// Live fields of the selected human, updated without rebuilding buttons.
function refreshInspector() {
  if (selection?.type === 'street') {
    const el = inspector.querySelector('[data-f="passingList"]');
    if (el) {
      const passing = world.humans.filter((h) => h.passing === selection.id);
      el.innerHTML = passing.length ? passing.map((h) => `<span class="dot" style="background:${h.color}"></span>${h.name}`).join(' ') : '<span class="muted">nobody</span>';
    }
    return;
  }
  const h = selectedHuman();
  if (!h) return;
  const set = (f, v) => { const el = inspector.querySelector(`[data-f="${f}"]`); if (el && el.innerHTML !== v) el.innerHTML = v; };
  set('pos', `(${h.position.x.toFixed(1)}, ${h.position.z.toFixed(1)})`);
  set('movement', `<span class="chip" style="background:${MOVEMENT_COLOR[h.movement]}">${h.movement}</span>`);
  set('dir', `${fmtDeg(h.direction)} ${compass(h.direction)}`);
  set('speed', `${h.speed.toFixed(2)} m/s <span class="muted">(pref. ${h.baseSpeed.toFixed(1)})</span>`);
  const s = h.passing && world.street(h.passing);
  set('passing', s ? s.name : '—');
  set('surface', s ? `${h.surface} · ${s.surface_condition}` : h.surface ?? '—');
  set('mode', h.mode === 'route' ? 'following route' : 'walking straight');
  set('goal', h.goal ? `(${h.goal.x.toFixed(1)}, ${h.goal.z.toFixed(1)})` : '—');
  set('last', h.lastAction);
}

// ---------- action log ----------
let logDirty = true;
function renderLog() {
  if (!logDirty) return;
  logDirty = false;
  document.getElementById('log-list').innerHTML = world.log.slice(0, 14).map((l) =>
    `<li><span class="dot" style="background:${l.color}"></span><b>${l.who}</b> <span class="tag tag-${l.action}">${l.action}</span> <span class="muted">${l.detail}</span></li>`).join('');
}

let toastTimer;
function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3000);
}

// ---------- keyboard ----------
window.addEventListener('keydown', (ev) => {
  if (['INPUT', 'SELECT'].includes(ev.target.tagName)) return;
  const k = ev.key.toLowerCase();
  const act = Object.keys(ACTIONS).find((id) => ACTIONS[id].key === k);
  if (act) return runAction(act);
  const t = Object.keys(TOOL_INFO).find((id) => TOOL_INFO[id].key === k);
  if (t) return setTool(t);
  if (k === ' ') { ev.preventDefault(); view('pause'); }
  if (k === 'o') view('overlay');
  if (k === 'p') view('paths');
  if (k === 'escape') setTool('select');
});

if (window.innerWidth < 640) document.getElementById('rules').classList.remove('open');
document.getElementById('rules-toggle').onclick = () => document.getElementById('rules').classList.toggle('open');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- wiring ----------
world.on((type) => {
  if (type === 'world') {
    buildStatic();
    buildFurniture();
    updateOverlay();
    for (const [id, g] of carMeshes) { carGroup.remove(g); carMeshes.delete(id); }
  }
  if (type === 'log') logDirty = true;
});
buildStatic();
buildFurniture();
updateOverlay();
renderInspector();

const clock = new THREE.Clock();
let inspectorTimer = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) {
    // Fixed sub-steps keep the simulation stable at low frame rates.
    const steps = Math.ceil(dt / (1 / 60));
    for (let i = 0; i < steps; i++) world.step(dt / steps);
  }
  updateSignals();
  updateCars();
  updateHumans(clock.elapsedTime, dt);
  inspectorTimer += dt;
  if (inspectorTimer > 0.15) { inspectorTimer = 0; refreshInspector(); renderLog(); }
  controls.update();
  renderer.render(scene, camera);
});

window.world = world; // for console debugging
