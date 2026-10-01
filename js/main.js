import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createExample, label, RULES } from './model.js';

// ---------- model ----------
const model = createExample();
const undoStack = [];

// ---------- renderer / scene ----------
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe3f5');
scene.fog = new THREE.Fog('#bfe3f5', 25, 55);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(9, 13, 15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 5;
controls.maxDistance = 40;

scene.add(new THREE.HemisphereLight('#ffffff', '#6b8f4e', 0.9));
const sun = new THREE.DirectionalLight('#fff4dc', 1.6);
sun.position.set(10, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
scene.add(sun);

// Ground beneath the grid (also the picking surface).
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: '#8fb873' }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

const cityGroup = new THREE.Group();
scene.add(cityGroup);
const peopleGroup = new THREE.Group();
scene.add(peopleGroup);

// ---------- shared geometry / materials ----------
const GEO = {
  tile: new THREE.BoxGeometry(0.98, 0.06, 0.98),
  street: new THREE.BoxGeometry(1, 0.03, 1),
  dash: new THREE.BoxGeometry(0.3, 0.005, 0.05),
  box: new THREE.BoxGeometry(1, 1, 1),
  roof: (() => { const g = new THREE.ConeGeometry(0.5, 0.32, 4); g.rotateY(Math.PI / 4); return g; })(),
  trunk: new THREE.CylinderGeometry(0.03, 0.04, 0.18, 6),
  crown: new THREE.IcosahedronGeometry(0.14, 0),
  person: new THREE.CapsuleGeometry(0.045, 0.09, 3, 8),
  marker: new THREE.BoxGeometry(1.02, 0.02, 1.02),
};
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}
const ZONE_COLOR = { residential: '#a9d38c', commercial: '#e6d3a3', green: '#5fae4f' };

const half = model.size / 2;
const toWorld = (x, z) => new THREE.Vector3(x - half + 0.5, 0, z - half + 0.5);

function addMesh(parent, geo, material, { pos = [0, 0, 0], scale = [1, 1, 1], rotY = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.y = rotY;
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Direction a structure faces: toward its first adjacent street cell.
function facing(s) {
  const n = model.streetNeighbors(s.x, s.z)[0];
  return n ? { dx: n.dx, dz: n.dz } : { dx: 0, dz: 1 };
}

// ---------- building the scene from the model ----------
function buildTile(c) {
  const p = toWorld(c.x, c.z);
  if (c.kind === 'street') {
    addMesh(cityGroup, GEO.street, mat('#4a4f57'), { pos: [p.x, 0.015, p.z], shadow: false });
    const ew = model.isStreet(c.x - 1, c.z) || model.isStreet(c.x + 1, c.z);
    const ns = model.isStreet(c.x, c.z - 1) || model.isStreet(c.x, c.z + 1);
    if (ew !== ns) {
      addMesh(cityGroup, GEO.dash, mat('#f5f0d0'), { pos: [p.x, 0.033, p.z], rotY: ns ? Math.PI / 2 : 0, shadow: false });
    }
    return;
  }
  addMesh(cityGroup, GEO.tile, mat(ZONE_COLOR[c.zone]), { pos: [p.x, 0.03, p.z], shadow: false });
}

function buildHouse(s) {
  const g = new THREE.Group();
  const h = 0.32 * s.floors;
  addMesh(g, GEO.box, mat(s.color), { pos: [0, 0.06 + h / 2, 0], scale: [0.6, h, 0.6] });
  addMesh(g, GEO.roof, mat('#a0473b'), { pos: [0, 0.06 + h + 0.16, 0], scale: [1.05, 1, 1.05] });
  addMesh(g, GEO.box, mat('#6b4226'), { pos: [0, 0.06 + 0.09, 0.301], scale: [0.12, 0.18, 0.02], shadow: false });
  for (let f = 0; f < s.floors; f++) {
    const y = 0.06 + 0.32 * f + (f === 0 ? 0.22 : 0.16);
    for (const wx of [-0.18, 0.18]) {
      addMesh(g, GEO.box, mat('#fff3b0', { emissive: '#5a4a10' }), { pos: [wx, y, 0.301], scale: [0.1, 0.09, 0.01], shadow: false });
    }
  }
  return g;
}

function buildShop(s) {
  const g = new THREE.Group();
  const h = 0.38 * s.floors;
  addMesh(g, GEO.box, mat('#efe9df'), { pos: [0, 0.06 + h / 2, 0], scale: [0.82, h, 0.7] });
  addMesh(g, GEO.box, mat(s.color), { pos: [0, 0.06 + h + 0.02, 0], scale: [0.86, 0.04, 0.74] });
  addMesh(g, GEO.box, mat(s.color), { pos: [0, 0.32, 0.4], scale: [0.82, 0.03, 0.14] });
  addMesh(g, GEO.box, mat('#9fd3f0', { emissive: '#1d3b4a' }), { pos: [0, 0.18, 0.351], scale: [0.6, 0.18, 0.01], shadow: false });
  return g;
}

const TREE_SLOTS = [[-0.25, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25]];
function buildTree(parent, x, z, scale = 1) {
  addMesh(parent, GEO.trunk, mat('#7a5230'), { pos: [x, 0.06 + 0.09 * scale, z], scale: [scale, scale, scale] });
  addMesh(parent, GEO.crown, mat('#2f7d32'), { pos: [x, 0.06 + 0.28 * scale, z], scale: [scale, scale * 1.2, scale] });
}

function buildPark(s) {
  const g = new THREE.Group();
  addMesh(g, GEO.box, mat('#d8c9a3'), { pos: [0, 0.062, 0], scale: [0.14, 0.01, 0.9], shadow: false });
  addMesh(g, GEO.box, mat('#8a5a33'), { pos: [0.12, 0.1, 0], scale: [0.06, 0.04, 0.22] });
  for (let i = 0; i < s.trees; i++) buildTree(g, ...TREE_SLOTS[i], 1);
  return g;
}

function rebuildScene() {
  cityGroup.clear();
  for (const c of model.cells) buildTile(c);
  for (const s of model.structures.values()) {
    const g = s.type === 'house' ? buildHouse(s) : s.type === 'shop' ? buildShop(s) : buildPark(s);
    const p = toWorld(s.x, s.z);
    const f = facing(s);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(f.dx, f.dz);
    g.userData.cell = { x: s.x, z: s.z };
    cityGroup.add(g);
  }
  cityGroup.updateMatrixWorld(true); // keep picking accurate before the next frame renders
  rebuildPeople();
}

// ---------- residents (animated) ----------
const people = new Map();

function doorPoint(s) {
  const f = facing(s);
  const p = toWorld(s.x, s.z);
  return new THREE.Vector3(p.x + f.dx * 0.48, 0, p.z + f.dz * 0.48);
}

function rebuildPeople() {
  peopleGroup.clear();
  people.clear();
  for (const r of model.residents.values()) {
    const home = model.structures.get(r.homeId);
    if (!home) continue;
    const mesh = addMesh(peopleGroup, GEO.person, mat(r.color));
    let path = null;
    const shop = r.workId && model.structures.get(r.workId);
    if (shop) {
      const cells = model.route(home, shop);
      if (cells) {
        path = [doorPoint(home), ...cells.map((c) => toWorld(c.x, c.z)), doorPoint(shop)];
        // Side-walk offset so people don't walk the center line.
        const off = ((r.id % 5) - 2) * 0.07;
        path = path.map((p, i) => (i === 0 || i === path.length - 1 ? p : p.clone().add(new THREE.Vector3(off, 0, off))));
      }
    }
    const lengths = [0];
    if (path) for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
    people.set(r.id, { mesh, path, lengths, home, phase: (r.id * 1.618) % 1 });
  }
}

const PAUSE = 2; // seconds spent at home / at work
function updatePeople(t) {
  for (const p of people.values()) {
    if (!p.path) {
      // Unemployed: stroll in a little loop in front of home.
      const d = doorPoint(p.home);
      const a = t * 0.8 + p.phase * Math.PI * 2;
      p.mesh.position.set(d.x + Math.cos(a) * 0.12, 0.13, d.z + Math.sin(a) * 0.12);
      continue;
    }
    const total = p.lengths[p.lengths.length - 1];
    const walk = total / 0.9;
    const cycle = 2 * (walk + PAUSE);
    let u = ((t + p.phase * cycle) % cycle);
    let dist;
    if (u < PAUSE) dist = 0;
    else if ((u -= PAUSE) < walk) dist = (u / walk) * total;
    else if ((u -= walk) < PAUSE) dist = total;
    else dist = total * (1 - (u - PAUSE) / walk);
    let i = 1;
    while (i < p.lengths.length - 1 && p.lengths[i] < dist) i++;
    const seg = p.lengths[i] - p.lengths[i - 1] || 1;
    const k = (dist - p.lengths[i - 1]) / seg;
    const pos = p.path[i - 1].clone().lerp(p.path[i], Math.min(1, Math.max(0, k)));
    const atEnd = dist === 0 || dist === total;
    p.mesh.position.set(pos.x, 0.13 + (atEnd ? 0 : Math.abs(Math.sin(t * 10)) * 0.02), pos.z);
    p.mesh.visible = !atEnd; // inside the building while at home / work
  }
}

// ---------- tools & interaction ----------
const TOOLS = {
  select:   { label: 'Select',   key: '1', hint: 'Click a cell to inspect it.' },
  street:   { label: 'Street',   key: '2', check: (x, z) => model.checkStreet(x, z), act: (x, z) => model.buildStreet(x, z) },
  house:    { label: 'House',    key: '3', check: (x, z) => model.checkBuild('house', x, z), act: (x, z) => model.build('house', x, z) },
  shop:     { label: 'Shop',     key: '4', check: (x, z) => model.checkBuild('shop', x, z), act: (x, z) => model.build('shop', x, z) },
  park:     { label: 'Park',     key: '5', check: (x, z) => model.checkBuild('park', x, z), act: (x, z) => model.build('park', x, z) },
  tree:     { label: 'Tree',     key: '6', check: (x, z) => model.checkTree(x, z), act: (x, z) => model.plantTree(x, z) },
  rezone:   { label: 'Rezone',   key: '7', check: (x, z) => model.checkRezone(x, z), act: (x, z) => model.rezone(x, z) },
  demolish: { label: 'Demolish', key: '8', check: (x, z) => model.checkDemolish(x, z), act: (x, z) => model.demolish(x, z) },
};
let tool = 'select';
let selected = null; // {x, z}
let hovered = null;

const hoverMarker = new THREE.Mesh(GEO.marker, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }));
hoverMarker.visible = false;
scene.add(hoverMarker);
const selectMarker = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1.4, 1)),
  new THREE.LineBasicMaterial({ color: '#1f6feb' }),
);
selectMarker.visible = false;
scene.add(selectMarker);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pickCell(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  // Prefer the structure under the cursor, so clicking a facade picks its own lot.
  for (const h of raycaster.intersectObjects(cityGroup.children, true)) {
    for (let o = h.object; o; o = o.parent) if (o.userData.cell) return o.userData.cell;
  }
  const hit = raycaster.intersectObject(ground)[0];
  if (!hit) return null;
  const x = Math.floor(hit.point.x + half), z = Math.floor(hit.point.z + half);
  return model.inBounds(x, z) ? { x, z } : null;
}

function act(fn) {
  const snapshot = model.toJSON();
  const res = fn();
  if (res.ok) {
    undoStack.push(snapshot);
    if (undoStack.length > 100) undoStack.shift();
  }
  toast(res.ok ? res.msg : res.reason, res.ok ? 'ok' : 'err');
  updateHover();
  return res;
}

let downAt = null;
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return; // was a drag
  const c = pickCell(ev);
  if (!c) return;
  if (tool === 'select') {
    selected = c;
    renderInspector();
    updateSelection();
  } else {
    act(() => TOOLS[tool].act(c.x, c.z));
  }
});
renderer.domElement.addEventListener('pointermove', (ev) => { hovered = pickCell(ev); updateHover(); });
renderer.domElement.addEventListener('pointerleave', () => { hovered = null; updateHover(); });

function updateHover() {
  const status = document.getElementById('status');
  if (!hovered) {
    hoverMarker.visible = false;
    status.textContent = TOOLS[tool].hint ?? `${TOOLS[tool].label}: hover over a cell.`;
    status.className = '';
    return;
  }
  const p = toWorld(hovered.x, hovered.z);
  hoverMarker.position.set(p.x, 0.07, p.z);
  hoverMarker.visible = true;
  if (tool === 'select') {
    hoverMarker.material.color.set('#ffffff');
    status.textContent = describeCell(hovered.x, hovered.z);
    status.className = '';
    return;
  }
  const reason = TOOLS[tool].check(hovered.x, hovered.z);
  hoverMarker.material.color.set(reason ? '#ff4d4d' : '#3ddc84');
  status.textContent = reason ?? `${TOOLS[tool].label} at (${hovered.x}, ${hovered.z}): allowed.`;
  status.className = reason ? 'err' : 'ok';
}

function describeCell(x, z) {
  const c = model.cell(x, z);
  if (c.kind === 'street') return `(${x}, ${z}) · Street`;
  const s = model.structureAt(x, z);
  return `(${x}, ${z}) · ${c.zone} lot${s ? ' · ' + label(s) : ' · empty'}`;
}

function updateSelection() {
  if (!selected) { selectMarker.visible = false; return; }
  const p = toWorld(selected.x, selected.z);
  selectMarker.position.set(p.x, 0.7, p.z);
  selectMarker.visible = true;
}

// ---------- UI panels ----------
const toolbar = document.getElementById('toolbar');
function renderToolbar() {
  toolbar.innerHTML = '';
  const tools = document.createElement('div');
  tools.className = 'group';
  for (const [id, t] of Object.entries(TOOLS)) {
    const b = document.createElement('button');
    b.className = 'tool' + (tool === id ? ' active' : '');
    b.dataset.tool = id;
    b.innerHTML = `<span class="sw sw-${id}"></span>${t.label}<kbd>${t.key}</kbd>`;
    b.title = `${t.label} (${t.key})`;
    b.onclick = () => setTool(id);
    tools.appendChild(b);
  }
  const hist = document.createElement('div');
  hist.className = 'group';
  hist.innerHTML = `
    <button id="undo" ${undoStack.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">Undo</button>
    <button id="reset" title="Reload the example neighborhood">Reset</button>`;
  toolbar.append(tools, hist);
  hist.querySelector('#undo').onclick = undo;
  hist.querySelector('#reset').onclick = () => act(() => { model.load(createExample().toJSON()); return { ok: true, msg: 'Reloaded the example neighborhood.' }; });
}

function setTool(id) {
  tool = id;
  renderToolbar();
  updateHover();
}

function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  model.load(snap);
  toast('Undone.', 'ok');
}

const inspector = document.getElementById('inspector');
function renderInspector() {
  if (!selected) {
    inspector.innerHTML = '<h2>Inspector</h2><p class="muted">Use <b>Select</b> and click a cell to inspect it.</p>';
    return;
  }
  const { x, z } = selected;
  const c = model.cell(x, z);
  const s = model.structureAt(x, z);
  let html = '';
  if (c.kind === 'street') {
    const links = model.streetNeighbors(x, z).length;
    html = `<h2>Street</h2>${rows([['Cell', `(${x}, ${z})`], ['Connected streets', links]])}`;
  } else if (!s) {
    html = `<h2>Empty lot</h2>${rows([['Cell', `(${x}, ${z})`], ['Zone', zoneChip(c.zone)], ['Street access', model.hasStreetAccess(x, z) ? 'yes' : 'no']])}
      <div class="actions"><button data-a="rezone">Rezone</button></div>`;
  } else if (s.type === 'house') {
    const rs = model.residentsOf(s.id);
    html = `<h2>${label(s)}</h2>${rows([['Cell', `(${x}, ${z})`], ['Zone', zoneChip(c.zone)], ['Floors', `${s.floors} / ${RULES.MAX_FLOORS}`], ['Residents', `${rs.length} / ${model.capacity(s)}`]])}
      <div class="actions">
        <button data-a="floor+">+ Floor</button><button data-a="floor-">− Floor</button>
        <button data-a="resident+">+ Resident</button>
      </div>
      <h3>Residents</h3>
      <ul class="list">${rs.map((r) => {
        const w = r.workId && model.structures.get(r.workId);
        return `<li><span class="dot" style="background:${r.color}"></span>${r.name}
          <span class="muted">${w ? 'works at ' + label(w) : 'unemployed'}</span>
          <button class="mini" data-a="moveout" data-id="${r.id}" title="Move out">✕</button></li>`;
      }).join('') || '<li class="muted">Nobody lives here.</li>'}</ul>`;
  } else if (s.type === 'shop') {
    const es = model.employeesOf(s.id);
    html = `<h2>${label(s)}</h2>${rows([['Cell', `(${x}, ${z})`], ['Zone', zoneChip(c.zone)], ['Floors', `${s.floors} / ${RULES.MAX_FLOORS}`], ['Jobs filled', `${es.length} / ${model.capacity(s)}`]])}
      <div class="actions"><button data-a="floor+">+ Floor</button><button data-a="floor-">− Floor</button></div>
      <h3>Employees</h3>
      <ul class="list">${es.map((r) => `<li><span class="dot" style="background:${r.color}"></span>${r.name}
        <span class="muted">lives in ${label(model.structures.get(r.homeId))}</span></li>`).join('') || '<li class="muted">No employees.</li>'}</ul>`;
  } else {
    html = `<h2>${label(s)}</h2>${rows([['Cell', `(${x}, ${z})`], ['Zone', zoneChip(c.zone)], ['Trees', `${s.trees} / ${RULES.TREES_PER_PARK}`]])}
      <div class="actions"><button data-a="tree">Plant tree</button></div>`;
  }
  if (c.kind === 'street' || s) html += `<div class="actions"><button class="danger" data-a="demolish">Demolish</button></div>`;
  inspector.innerHTML = html;

  const checks = {
    rezone: () => model.checkRezone(x, z),
    'floor+': () => model.checkAddFloor(s),
    'floor-': () => model.checkRemoveFloor(s),
    'resident+': () => model.checkAddResident(s),
    tree: () => model.checkTree(x, z),
    demolish: () => model.checkDemolish(x, z),
  };
  for (const b of inspector.querySelectorAll('button[data-a]')) {
    const a = b.dataset.a;
    const reason = checks[a]?.();
    if (reason) { b.classList.add('blocked'); b.title = reason; }
    b.onclick = () => act(() => {
      switch (a) {
        case 'rezone': return model.rezone(x, z);
        case 'floor+': return model.addFloor(s.id);
        case 'floor-': return model.removeFloor(s.id);
        case 'resident+': return model.addResident(s.id);
        case 'moveout': return model.removeResident(Number(b.dataset.id));
        case 'tree': return model.plantTree(x, z);
        case 'demolish': return model.demolish(x, z);
      }
    });
  }
}

const rows = (pairs) => `<table>${pairs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
const zoneChip = (z) => `<span class="chip" style="background:${ZONE_COLOR[z]}">${z}</span>`;

function renderStats() {
  const s = model.stats();
  document.getElementById('stats').innerHTML = `
    <h2>${model.name}</h2>
    <div class="kpis">
      <div><b>${s.population}</b><span>residents</span></div>
      <div><b>${s.employed}/${s.jobs}</b><span>jobs filled</span></div>
      <div><b>${s.unemployed}</b><span>unemployed</span></div>
      <div><b>${s.population}/${s.housing}</b><span>housing used</span></div>
      <div><b>${s.houses}</b><span>houses</span></div>
      <div><b>${s.shops}</b><span>shops</span></div>
      <div><b>${s.parks}</b><span>parks</span></div>
      <div><b>${s.trees}</b><span>trees</span></div>
    </div>`;
}

let toastTimer = null;
function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

window.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
  if (ev.key === 'Escape') { selected = null; updateSelection(); renderInspector(); setTool('select'); return; }
  const id = Object.keys(TOOLS).find((k) => TOOLS[k].key === ev.key);
  if (id) setTool(id);
});

document.getElementById('rules-toggle').onclick = () => document.getElementById('rules').classList.toggle('open');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- wiring ----------
model.onChange(() => {
  rebuildScene();
  renderStats();
  renderInspector();
  renderToolbar();
  updateSelection();
});
rebuildScene();
renderStats();
renderInspector();
renderToolbar();
updateHover();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  updatePeople(clock.getElapsedTime());
  controls.update();
  renderer.render(scene, camera);
});

// Exposed for debugging from the console.
window.neighborhood = model;
