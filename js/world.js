// Semantic model: HUMAN —PASSING→ STREET ←OCCUPY— STREET_FURNITURE.
// Pure simulation (no rendering). See MODEL.md.

export const EXTENT = 40;            // world spans [-EXTENT, EXTENT] on x and z (meters)
export const CELL = 0.5;             // navigation grid resolution
export const N = (EXTENT * 2) / CELL;
export const HUMAN_RADIUS = 0.3;

export const SURFACES = {
  good:    { label: 'Good',    walk: 1.0,  drive: 1.0 },
  wet:     { label: 'Wet',     walk: 0.8,  drive: 0.75 },
  icy:     { label: 'Icy',     walk: 0.45, drive: 0.45 },
  damaged: { label: 'Damaged', walk: 0.65, drive: 0.6 },
};
export const TRAFFIC = ['two-way', 'one-way +', 'one-way −'];

// Footprint w (along the street) × d (across), height h, default obstacle_status.
export const FURNITURE_TYPES = {
  bench:    { label: 'Bench',          w: 1.8, d: 0.6, h: 0.9, obstacle: true },
  lamp:     { label: 'Lamp post',      w: 0.4, d: 0.4, h: 4.5, obstacle: true },
  bin:      { label: 'Trash bin',      w: 0.6, d: 0.6, h: 1.0, obstacle: true },
  planter:  { label: 'Planter',        w: 1.4, d: 1.2, h: 0.8, obstacle: true },
  tree:     { label: 'Street tree',    w: 1.2, d: 1.2, h: 5.0, obstacle: true },
  bollard:  { label: 'Bollard',        w: 0.3, d: 0.3, h: 0.9, obstacle: true },
  hydrant:  { label: 'Fire hydrant',   w: 0.4, d: 0.4, h: 0.8, obstacle: true },
  bus_stop: { label: 'Bus shelter',    w: 3.2, d: 1.4, h: 2.5, obstacle: true },
  barrier:  { label: 'Work barrier',   w: 2.6, d: 1.6, h: 1.0, obstacle: true },
  manhole:  { label: 'Manhole cover',  w: 0.9, d: 0.9, h: 0.03, obstacle: false },
  grate:    { label: 'Drain grate',    w: 1.0, d: 0.5, h: 0.03, obstacle: false },
};
export const SIZES = { S: 0.75, M: 1, L: 1.4 };

const KIND = { lot: 0, sidewalk: 1, crosswalk: 2, road: 3, intersection: 4 };
const KIND_NAME = ['lot', 'sidewalk', 'crosswalk', 'road', 'intersection'];

// Traffic signal cycle shared by the intersection.
const SIGNAL_PHASES = [
  { main: 'green', oak: 'red', dur: 11 },
  { main: 'yellow', oak: 'red', dur: 2.5 },
  { main: 'red', oak: 'red', dur: 1.5 },
  { main: 'red', oak: 'green', dur: 9 },
  { main: 'red', oak: 'yellow', dur: 2.5 },
  { main: 'red', oak: 'red', dur: 1.5 },
];

const HUMAN_NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun'];
const HUMAN_COLORS = ['#e63946', '#3a86ff', '#ffb703', '#8338ec', '#2a9d8f', '#fb5607', '#ff006e', '#06d6a0'];
const CAR_COLORS = ['#d62828', '#f7f7f2', '#1d3557', '#2b2d42', '#e9c46a', '#457b9d', '#6a994e'];

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class World {
  constructor() {
    this.listeners = new Set();
    this.reset();
  }

  on(fn) { this.listeners.add(fn); }
  emit(type) { for (const fn of this.listeners) fn(type); }

  reset() {
    this.nextId = 1;
    this.time = 0;
    this.log = [];
    this.signal = { phase: 0, t: 0 };
    this.streets = [
      { id: 'main', name: 'Main Street', axis: 'x', width: 10, sidewalk: 3.5,
        surface_condition: 'good', traffic_direction: 'two-way', crosswalk_presence: true, midblock: [22] },
      { id: 'oak', name: 'Oak Avenue', axis: 'z', width: 7, sidewalk: 3,
        surface_condition: 'wet', traffic_direction: 'one-way +', crosswalk_presence: true, midblock: [-21] },
    ];
    this.furniture = [];
    this.humans = [];
    this.cars = [];
    this.seedFurniture();
    this.rebuildGrid();
    this.seedHumans();
    this.spawnCars();
    this.emit('world');
  }

  // ---------- street geometry ----------
  street(id) { return this.streets.find((s) => s.id === id); }
  other(s) { return this.streets.find((o) => o !== s); }
  along(s, x, z) { return s.axis === 'x' ? x : z; }
  lateral(s, x, z) { return s.axis === 'x' ? z : x; }
  toWorld(s, along, lat) { return s.axis === 'x' ? { x: along, z: lat } : { x: lat, z: along }; }

  crosswalks(s) {
    if (!s.crosswalk_presence) return [];
    const o = this.other(s);
    const c = o.width / 2 + o.sidewalk / 2;
    return [
      { at: -c, half: o.sidewalk / 2 },
      { at: c, half: o.sidewalk / 2 },
      ...s.midblock.map((at) => ({ at, half: 1.5 })),
    ];
  }

  // Lanes derived from width + traffic_direction (right-hand traffic).
  lanes(s) {
    const right = (dir) => (s.axis === 'x' ? dir : -dir);
    if (s.traffic_direction === 'two-way') {
      return [{ dir: 1, lat: right(1) * s.width / 4 }, { dir: -1, lat: right(-1) * s.width / 4 }];
    }
    const dir = s.traffic_direction === 'one-way +' ? 1 : -1;
    return s.width >= 7 ? [{ dir, lat: -s.width / 4 }, { dir, lat: s.width / 4 }] : [{ dir, lat: 0 }];
  }

  // Where the stop line sits for traffic on street s heading in dir.
  stopLine(s, dir) {
    const o = this.other(s);
    return -dir * (o.width / 2 + o.sidewalk + 0.8);
  }

  classify(x, z) {
    if (Math.abs(x) > EXTENT || Math.abs(z) > EXTENT) return { kind: 'lot' };
    const roads = this.streets.filter((s) => Math.abs(this.lateral(s, x, z)) < s.width / 2);
    if (roads.length > 1) return { kind: 'intersection' };
    if (roads.length === 1) {
      const s = roads[0];
      const a = this.along(s, x, z);
      const cw = this.crosswalks(s).find((c) => Math.abs(a - c.at) <= c.half);
      return { kind: cw ? 'crosswalk' : 'road', street: s, crosswalk: cw };
    }
    for (const s of this.streets) {
      const l = this.lateral(s, x, z);
      if (Math.abs(l) < s.width / 2 + s.sidewalk) return { kind: 'sidewalk', street: s, side: Math.sign(l) };
    }
    return { kind: 'lot' };
  }

  // ---------- street furniture ----------
  furnitureById(id) { return this.furniture.find((f) => f.id === id); }

  furniturePos(f) {
    const s = this.street(f.streetId);
    return this.toWorld(s, f.along, f.side * (s.width / 2 + f.offset));
  }

  furnitureDims(f) {
    const t = FURNITURE_TYPES[f.type];
    const k = SIZES[f.size];
    return { w: t.w * k, d: t.d * k, h: t.h * (f.type === 'manhole' || f.type === 'grate' ? 1 : k) };
  }

  // Axis-aligned half extents in world space.
  furnitureHalf(f) {
    const { w, d } = this.furnitureDims(f);
    return this.street(f.streetId).axis === 'x' ? { hx: w / 2, hz: d / 2 } : { hx: d / 2, hz: w / 2 };
  }

  furnitureAt(x, z, inflate = 0) {
    return this.furniture.find((f) => {
      const p = this.furniturePos(f);
      const { hx, hz } = this.furnitureHalf(f);
      return Math.abs(x - p.x) <= hx + inflate && Math.abs(z - p.z) <= hz + inflate;
    });
  }

  checkPlaceFurniture(x, z) {
    const c = this.classify(x, z);
    if (c.kind !== 'sidewalk') return 'Street furniture must OCCUPY a sidewalk.';
    return null;
  }

  addFurniture(type, x, z, opts = {}) {
    const reason = this.checkPlaceFurniture(x, z);
    if (reason) return { ok: false, reason };
    const c = this.classify(x, z);
    const s = c.street;
    const t = FURNITURE_TYPES[type];
    const size = opts.size ?? 'M';
    const d = t.d * SIZES[size];
    const off = Math.abs(this.lateral(s, x, z)) - s.width / 2;
    const f = {
      id: this.nextId++, type, size,
      streetId: s.id, side: c.side,
      along: this.along(s, x, z),
      offset: Math.min(Math.max(off, d / 2 + 0.05), s.sidewalk - d / 2 - 0.05),
      obstacle_status: opts.obstacle_status ?? t.obstacle,
    };
    this.furniture.push(f);
    this.changed();
    return { ok: true, msg: `Placed ${t.label.toLowerCase()} on ${s.name}.`, furniture: f };
  }

  updateFurniture(id, patch) {
    const f = this.furnitureById(id);
    if (!f) return;
    Object.assign(f, patch);
    if (patch.size) {
      const s = this.street(f.streetId);
      const d = this.furnitureDims(f).d;
      f.offset = Math.min(Math.max(f.offset, d / 2 + 0.05), s.sidewalk - d / 2 - 0.05);
    }
    this.changed();
  }

  removeFurniture(id) {
    this.furniture = this.furniture.filter((f) => f.id !== id);
    this.changed();
  }

  // ---------- street attributes ----------
  updateStreet(id, patch) {
    const s = this.street(id);
    Object.assign(s, patch);
    s.width = Math.max(5, Math.min(14, s.width));
    if ('width' in patch || 'traffic_direction' in patch) this.spawnCars();
    this.changed();
  }

  // Any change to streets or furniture: rebuild traversability and keep the rule enforced.
  changed() {
    this.rebuildGrid();
    for (const h of this.humans) this.enforceTraversable(h);
    this.emit('world');
  }

  // ---------- navigation grid ----------
  rebuildGrid() {
    this.kind = new Uint8Array(N * N);
    this.streetIdx = new Int8Array(N * N).fill(-1);
    this.blocked = new Uint8Array(N * N);
    this.cost = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const { x, z } = this.cellCenter(i, j);
        const c = this.classify(x, z);
        const k = j * N + i;
        this.kind[k] = KIND[c.kind];
        if (c.street) {
          this.streetIdx[k] = this.streets.indexOf(c.street);
          this.cost[k] = 1 / SURFACES[c.street.surface_condition].walk + (c.kind === 'crosswalk' ? 0.4 : 0);
        }
      }
    }
    for (const f of this.furniture) {
      if (!f.obstacle_status) continue;
      const p = this.furniturePos(f);
      const { hx, hz } = this.furnitureHalf(f);
      const [i0, j0] = this.cellOf(p.x - hx - HUMAN_RADIUS, p.z - hz - HUMAN_RADIUS);
      const [i1, j1] = this.cellOf(p.x + hx + HUMAN_RADIUS, p.z + hz + HUMAN_RADIUS);
      for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
          const c = this.cellCenter(i, j);
          if (Math.abs(c.x - p.x) < hx + HUMAN_RADIUS && Math.abs(c.z - p.z) < hz + HUMAN_RADIUS) this.blocked[j * N + i] = 1;
        }
      }
    }
    this.gridVersion = (this.gridVersion ?? 0) + 1;
  }

  cellOf(x, z) { return [Math.floor((x + EXTENT) / CELL), Math.floor((z + EXTENT) / CELL)]; }
  cellCenter(i, j) { return { x: -EXTENT + (i + 0.5) * CELL, z: -EXTENT + (j + 0.5) * CELL }; }
  inGrid(i, j) { return i >= 0 && j >= 0 && i < N && j < N; }
  walkableCell(i, j) {
    if (!this.inGrid(i, j)) return false;
    const k = j * N + i;
    return (this.kind[k] === KIND.sidewalk || this.kind[k] === KIND.crosswalk) && !this.blocked[k];
  }
  walkableAt(x, z) { const [i, j] = this.cellOf(x, z); return this.walkableCell(i, j); }
  kindAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.inGrid(i, j) ? KIND_NAME[this.kind[j * N + i]] : 'lot';
  }

  // Why a point is not traversable, in words.
  describeBlock(x, z) {
    const f = this.furnitureAt(x, z, HUMAN_RADIUS);
    if (f && f.obstacle_status && this.walkableKind(x, z)) return FURNITURE_TYPES[f.type].label.toLowerCase();
    const k = this.kindAt(x, z);
    if (k === 'road') return 'roadway (no crosswalk)';
    if (k === 'intersection') return 'intersection';
    return 'edge of the sidewalk';
  }
  walkableKind(x, z) { const k = this.kindAt(x, z); return k === 'sidewalk' || k === 'crosswalk'; }

  nearestWalkable(x, z) {
    const [si, sj] = this.cellOf(x, z);
    for (let r = 0; r < N; r++) {
      let best = null, bestD = Infinity;
      for (let j = sj - r; j <= sj + r; j++) {
        for (let i = si - r; i <= si + r; i++) {
          if (Math.max(Math.abs(i - si), Math.abs(j - sj)) !== r || !this.walkableCell(i, j)) continue;
          const c = this.cellCenter(i, j);
          const d = Math.hypot(c.x - x, c.z - z);
          if (d < bestD) { best = c; bestD = d; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Straight segment stays on traversable cells; margin also checks two parallel offset lines.
  lineWalkable(a, b, margin = 0) {
    const len = dist(a, b);
    if (len < 1e-6) return this.walkableAt(a.x, a.z);
    const nx = -(b.z - a.z) / len * margin, nz = (b.x - a.x) / len * margin;
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.4)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (!this.walkableAt(x, z)) return false;
      if (margin && (!this.walkableAt(x + nx, z + nz) || !this.walkableAt(x - nx, z - nz))) return false;
    }
    return true;
  }

  // A* over the traversable grid. bounds = {i0, i1, j0, j1} restricts the search (local AVOID).
  findPath(from, to, bounds = null) {
    let [si, sj] = this.cellOf(from.x, from.z);
    const [gi, gj] = this.cellOf(to.x, to.z);
    if (!this.walkableCell(gi, gj)) return null;
    if (!this.walkableCell(si, sj)) {
      const n = this.nearestWalkable(from.x, from.z);
      if (!n) return null;
      [si, sj] = this.cellOf(n.x, n.z);
    }
    const inB = (i, j) => !bounds || (i >= bounds.i0 && i <= bounds.i1 && j >= bounds.j0 && j <= bounds.j1);
    const start = sj * N + si, goal = gj * N + gi;
    const g = new Float32Array(N * N).fill(Infinity);
    const came = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const heap = new MinHeap();
    const h = (i, j) => {
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    g[start] = 0;
    heap.push(h(si, sj), start);
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % N, cj = (cur - ci) / N;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (!this.walkableCell(ni, nj) || !inB(ni, nj)) continue;
          if (di && dj && (!this.walkableCell(ci + di, cj) || !this.walkableCell(ci, cj + dj))) continue;
          const nk = nj * N + ni;
          const ng = g[cur] + (di && dj ? 1.414 : 1) * this.cost[nk];
          if (ng < g[nk]) {
            g[nk] = ng;
            came[nk] = cur;
            heap.push(ng + h(ni, nj), nk);
          }
        }
      }
    }
    if (g[goal] === Infinity) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) cells.push(this.cellCenter(k % N, Math.floor(k / N)));
    cells.reverse();
    cells[0] = { x: from.x, z: from.z };
    cells[cells.length - 1] = { x: to.x, z: to.z };
    return this.smooth(cells);
  }

  // String-pulling: drop waypoints that have a clear straight line between them.
  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 60);
      while (j > i + 1 && !this.lineWalkable(pts[i], pts[j], 0.12)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  randomWalkablePoint() {
    for (let tries = 0; tries < 400; tries++) {
      const x = (Math.random() * 2 - 1) * (EXTENT - 3);
      const z = (Math.random() * 2 - 1) * (EXTENT - 3);
      if (this.walkableAt(x, z) && this.kindAt(x, z) === 'sidewalk') return { x, z };
    }
    return null;
  }

  // ---------- humans ----------
  humanById(id) { return this.humans.find((h) => h.id === id); }

  addHuman(x, z, opts = {}) {
    if (!this.walkableAt(x, z)) return { ok: false, reason: 'A human must stand on a traversable surface (sidewalk or crosswalk).' };
    const id = this.nextId++;
    const h = {
      id,
      name: opts.name ?? HUMAN_NAMES[(this.humans.length) % HUMAN_NAMES.length],
      color: HUMAN_COLORS[this.humans.length % HUMAN_COLORS.length],
      position: { x, z },
      direction: opts.direction ?? 0,       // heading in radians, (cos, sin) on (x, z)
      speed: 0,                             // current m/s
      baseSpeed: opts.baseSpeed ?? 1.4,     // preferred walking speed m/s
      movement: 'stopped',                  // moving | stopped | waiting | avoiding | rerouting | turning | arrived
      mode: 'route',                        // route (follow path to goal) | free (walk straight ahead)
      goal: null,
      path: [],
      pathIndex: 0,
      pathVersion: 0,
      auto: opts.auto ?? true,
      timers: {},
      lastAction: '—',
    };
    this.humans.push(h);
    if (opts.goal) this.setGoal(h, opts.goal, false);
    else if (h.auto) this.reroute(h, 'heading to a new destination');
    this.emit('humans');
    return { ok: true, msg: `${h.name} joined the street.`, human: h };
  }

  removeHuman(id) {
    this.humans = this.humans.filter((h) => h.id !== id);
    this.emit('humans');
  }

  record(h, action, detail) {
    h.lastAction = action;
    this.log.unshift({ t: this.time, who: h.name, color: h.color, action, detail });
    if (this.log.length > 60) this.log.pop();
    this.emit('log');
  }

  setPath(h, path) {
    h.path = path;
    h.pathIndex = path.length > 1 ? 1 : 0;
    h.pathVersion++;
  }

  setGoal(h, goal, log = true) {
    if (!this.walkableAt(goal.x, goal.z)) return { ok: false, reason: 'The destination must be on a traversable surface.' };
    h.goal = { x: goal.x, z: goal.z };
    return this.reroute(h, 'new destination', log);
  }

  // REROUTE: global path planning to the goal (picks one if there is none).
  reroute(h, why = '', log = true) {
    let path = null;
    if (h.goal) path = this.findPath(h.position, h.goal);
    // Autopilot (or no goal at all): pick a destination that is actually reachable.
    if (!path && (h.auto || !h.goal)) {
      for (let tries = 0; tries < 12 && !path; tries++) {
        const g = this.randomWalkablePoint();
        if (!g) break;
        path = this.findPath(h.position, g);
        if (path) {
          if (h.goal) why = 'destination unreachable, picked a new one';
          h.goal = g;
        }
      }
    }
    if (!path) {
      h.movement = 'stopped';
      h.speed = 0;
      this.record(h, 'STOP', 'no traversable route to the destination');
      return { ok: false, reason: `${h.name} has no traversable route to that destination.` };
    }
    h.mode = 'route';
    h.freeAfter = false;
    this.setPath(h, path);
    h.movement = 'rerouting';
    h.timers.think = 0.5;
    if (log) this.record(h, 'REROUTE', why || `${path.length - 1} leg route planned`);
    return { ok: true, msg: `${h.name} rerouted.` };
  }

  // ----- manual actions (toolbar) -----
  actMove(h) {
    if (h.mode === 'route' && (!h.path.length || h.pathIndex >= h.path.length)) h.mode = 'free';
    h.movement = 'moving';
    this.record(h, 'MOVE', h.mode === 'route' ? 'following route' : 'walking straight ahead');
    return { ok: true, msg: `${h.name}: MOVE` };
  }

  actTurn(h, sign) {
    const target = wrapAngle(h.direction + sign * Math.PI / 2);
    h.afterTurn = h.movement === 'stopped' || h.movement === 'arrived' || h.movement === 'waiting' ? 'stopped' : 'moving';
    h.mode = 'free';
    h.freeAfter = false;
    h.path = [];
    h.pathVersion++;
    h.turnTarget = target;
    h.movement = 'turning';
    this.record(h, 'TURN', sign > 0 ? 'right 90°' : 'left 90°');
    return { ok: true, msg: `${h.name}: TURN` };
  }

  actStop(h) {
    h.movement = 'stopped';
    h.speed = 0;
    this.record(h, 'STOP', 'manual stop');
    return { ok: true, msg: `${h.name}: STOP` };
  }

  actAvoid(h) {
    const r = this.tryAvoidAhead(h, 6, true);
    if (r) return { ok: true, msg: `${h.name}: AVOID` };
    // Nothing static ahead: step aside from the nearest person in front, if any.
    const other = this.personAhead(h, 2.5);
    if (other && this.sidestep(h, 0.7)) {
      this.record(h, 'AVOID', `stepped aside for ${other.name}`);
      return { ok: true, msg: `${h.name}: AVOID` };
    }
    return { ok: false, reason: `${h.name}: nothing ahead to avoid.` };
  }

  actReroute(h) {
    return this.reroute(h, h.goal ? 'manual reroute' : 'new destination');
  }

  // Rule: the human must remain on a traversable surface.
  enforceTraversable(h) {
    if (this.walkableAt(h.position.x, h.position.z)) return;
    const p = this.nearestWalkable(h.position.x, h.position.z);
    if (!p) return;
    h.position = p;
    this.record(h, 'MOVE', 'stepped back onto a traversable surface');
  }

  // Polyline from the human through the remaining path, sampled; returns the first blocked sample.
  scanPath(h, maxDist) {
    let prev = h.position, d0 = 0;
    for (let k = h.pathIndex; k < h.path.length; k++) {
      const p = h.path[k];
      const len = dist(prev, p);
      for (let s = 0.25; s <= len; s += 0.25) {
        if (d0 + s > maxDist) return null;
        const t = s / len;
        const pt = { x: prev.x + (p.x - prev.x) * t, z: prev.z + (p.z - prev.z) * t };
        if (!this.walkableAt(pt.x, pt.z)) return { dist: d0 + s, k, pt, prev, s, len };
      }
      d0 += len;
      prev = p;
    }
    return null;
  }

  // From a blocked sample, find where the path becomes traversable again.
  rejoinAfter(h, block) {
    let prev = block.prev, s = block.s;
    for (let k = block.k; k < h.path.length; k++) {
      const p = h.path[k];
      const len = dist(prev, p);
      let clear = 0;
      for (; s <= len; s += 0.25) {
        const t = s / len;
        const pt = { x: prev.x + (p.x - prev.x) * t, z: prev.z + (p.z - prev.z) * t };
        if (this.walkableAt(pt.x, pt.z)) { clear += 0.25; if (clear >= 0.75) return { pt, k }; }
        else clear = 0;
      }
      prev = p;
      s = 0;
    }
    return null;
  }

  // AVOID: local detour around what blocks the way ahead. Returns true on success.
  tryAvoidAhead(h, range, manual = false) {
    if (h.mode === 'free') return this.avoidFree(h, range, manual);
    const block = this.scanPath(h, range);
    if (!block) return false;
    const what = this.describeBlock(block.pt.x, block.pt.z);
    const rejoin = this.rejoinAfter(h, block);
    if (rejoin && dist(h.position, rejoin.pt) < 14) {
      const local = this.localDetour(h.position, rejoin.pt);
      if (local) {
        const rest = h.path.slice(rejoin.k);
        this.setPath(h, [...local, ...rest]);
        h.avoidEnd = local.length;
        h.movement = 'avoiding';
        this.record(h, 'AVOID', `detour around ${what}`);
        return true;
      }
    }
    return false;
  }

  avoidFree(h, range, manual) {
    const dir = { x: Math.cos(h.direction), z: Math.sin(h.direction) };
    let blockedAt = null;
    for (let s = 0.25; s <= range; s += 0.25) {
      const pt = { x: h.position.x + dir.x * s, z: h.position.z + dir.z * s };
      if (!this.walkableAt(pt.x, pt.z)) { blockedAt = s; break; }
    }
    if (blockedAt == null) return false;
    const bp = { x: h.position.x + dir.x * blockedAt, z: h.position.z + dir.z * blockedAt };
    const f = this.furnitureAt(bp.x, bp.z, HUMAN_RADIUS);
    if (!f || !f.obstacle_status || !this.walkableKind(bp.x, bp.z)) {
      if (manual) this.record(h, 'AVOID', `can't: ${this.describeBlock(bp.x, bp.z)} ahead (TURN instead)`);
      return manual; // handled (logged) for manual presses
    }
    for (let s = blockedAt; s <= blockedAt + 8; s += 0.25) {
      const pt = { x: h.position.x + dir.x * s, z: h.position.z + dir.z * s };
      if (this.walkableAt(pt.x, pt.z) && this.walkableAt(pt.x + dir.x * 0.5, pt.z + dir.z * 0.5)) {
        const local = this.localDetour(h.position, { x: pt.x + dir.x * 0.5, z: pt.z + dir.z * 0.5 });
        if (!local) break;
        h.freeHeading = h.direction;
        h.freeAfter = true;
        h.mode = 'route';
        this.setPath(h, local);
        h.avoidEnd = local.length;
        h.movement = 'avoiding';
        this.record(h, 'AVOID', `detour around ${FURNITURE_TYPES[f.type].label.toLowerCase()}`);
        return true;
      }
      if (!this.walkableKind(pt.x, pt.z)) break;
    }
    if (manual) this.record(h, 'AVOID', `no way around the ${FURNITURE_TYPES[f.type].label.toLowerCase()}`);
    return manual;
  }

  localDetour(from, to) {
    const [a, b] = [this.cellOf(from.x, from.z), this.cellOf(to.x, to.z)];
    const pad = 10;
    return this.findPath(from, to, {
      i0: Math.min(a[0], b[0]) - pad, i1: Math.max(a[0], b[0]) + pad,
      j0: Math.min(a[1], b[1]) - pad, j1: Math.max(a[1], b[1]) + pad,
    });
  }

  personAhead(h, range) {
    const fx = Math.cos(h.direction), fz = Math.sin(h.direction);
    let best = null, bestD = range;
    for (const o of this.humans) {
      if (o === h) continue;
      const dx = o.position.x - h.position.x, dz = o.position.z - h.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && (dx * fx + dz * fz) / (d || 1) > 0.6) { best = o; bestD = d; }
    }
    return best;
  }

  sidestep(h, amount) {
    for (const sign of [1, -1]) {
      const nx = h.position.x - Math.sin(h.direction) * amount * sign;
      const nz = h.position.z + Math.cos(h.direction) * amount * sign;
      if (this.walkableAt(nx, nz)) { h.position = { x: nx, z: nz }; return true; }
    }
    return false;
  }

  // Are vehicles approaching this crossing point along their traffic direction?
  trafficApproaching(s, at) {
    return this.cars.some((c) => {
      if (c.streetId !== s.id) return false;
      const ahead = (at - c.along) * c.dir;
      return ahead > -2.5 && ahead < 20 && (c.speed > 0.8 || ahead < 3);
    });
  }

  // ---------- simulation ----------
  step(dt) {
    this.time += dt;
    this.updateSignal(dt);
    for (const c of this.cars) this.updateCar(c, dt);
    for (const h of this.humans) this.updateHuman(h, dt);
  }

  updateSignal(dt) {
    this.signal.t += dt;
    const ph = SIGNAL_PHASES[this.signal.phase];
    if (this.signal.t >= ph.dur) {
      this.signal.t = 0;
      this.signal.phase = (this.signal.phase + 1) % SIGNAL_PHASES.length;
    }
  }
  signalFor(streetId) { return SIGNAL_PHASES[this.signal.phase][streetId]; }

  surfaceAt(h) {
    const c = this.classify(h.position.x, h.position.z);
    return c;
  }

  updateHuman(h, dt) {
    for (const k in h.timers) h.timers[k] -= dt;
    const here = this.surfaceAt(h);
    h.passing = here.street ? here.street.id : null;
    h.surface = here.kind;
    h.surfaceCondition = here.street ? here.street.surface_condition : null;

    if (h.movement === 'turning') {
      const d = wrapAngle(h.turnTarget - h.direction);
      const stepA = Math.sign(d) * Math.min(Math.abs(d), 3.5 * dt);
      h.direction = wrapAngle(h.direction + stepA);
      h.speed = Math.max(0, h.speed - 4 * dt);
      if (Math.abs(d) < 0.01) { h.direction = h.turnTarget; h.movement = h.afterTurn; }
      return;
    }
    if (h.movement === 'stopped' || h.movement === 'arrived') {
      h.speed = Math.max(0, h.speed - 4 * dt);
      if (h.auto && h.movement === 'arrived' && h.timers.dwell <= 0) {
        h.goal = null;
        this.reroute(h, 'heading to a new destination');
      } else if (h.auto && h.movement === 'stopped' && h.timers.stuck <= 0 && h.stuckReason) {
        h.stuckReason = null;
        this.reroute(h, 'looking for another way');
      }
      return;
    }
    if (h.movement === 'rerouting') {
      h.speed = Math.max(0, h.speed - 4 * dt);
      if (h.timers.think <= 0) h.movement = 'moving';
      if (h.path.length > 1) this.faceToward(h, h.path[h.pathIndex], dt);
      return;
    }

    // ---- find the next target point ----
    let target;
    if (h.mode === 'route') {
      if (h.pathIndex >= h.path.length) return this.finishPath(h);
      // React to anything that blocks the planned route within sight.
      const block = this.scanPath(h, 12);
      if (block) {
        if (block.dist > 4.5 || !this.tryAvoidAhead(h, 4.5)) {
          if (h.freeAfter) {
            this.stopHuman(h, `blocked by ${this.describeBlock(block.pt.x, block.pt.z)}`);
            return;
          }
          const what = this.describeBlock(block.pt.x, block.pt.z);
          const r = this.reroute(h, `${what} blocks the route ahead`);
          if (!r.ok) { h.stuckReason = 'no route'; h.timers.stuck = 4; }
          return;
        }
      }
      target = h.path[h.pathIndex];
    } else {
      const fx = Math.cos(h.direction), fz = Math.sin(h.direction);
      const probe = { x: h.position.x + fx * 0.6, z: h.position.z + fz * 0.6 };
      if (!this.walkableAt(probe.x, probe.z)) {
        if (h.auto && this.avoidFree(h, 1.5, false)) return;
        this.stopHuman(h, `edge of traversable surface: ${this.describeBlock(probe.x, probe.z)}`);
        return;
      }
      target = { x: h.position.x + fx * 2, z: h.position.z + fz * 2 };
    }

    // ---- crosswalks: yield to traffic coming in the street's traffic direction ----
    const toT = { x: target.x - h.position.x, z: target.z - h.position.z };
    const tl = Math.hypot(toT.x, toT.z) || 1;
    const probe = { x: h.position.x + (toT.x / tl) * 0.9, z: h.position.z + (toT.z / tl) * 0.9 };
    const ahead = this.classify(probe.x, probe.z);
    if (ahead.kind === 'crosswalk' && here.kind !== 'crosswalk') {
      const at = this.along(ahead.street, probe.x, probe.z);
      if (this.trafficApproaching(ahead.street, at)) {
        if (h.movement !== 'waiting') {
          h.resume = h.movement;
          h.movement = 'waiting';
          this.record(h, 'STOP', `yielding to ${ahead.street.traffic_direction} traffic on ${ahead.street.name}`);
        }
        h.speed = Math.max(0, h.speed - 5 * dt);
        return;
      }
    }
    if (h.movement === 'waiting') {
      h.movement = h.resume === 'avoiding' ? 'avoiding' : 'moving';
      this.record(h, 'MOVE', 'crossing now');
    }

    // ---- other humans: step aside ----
    const other = this.personAhead(h, 1.1);
    if (other && (h.timers.avoidPerson ?? 0) <= 0) {
      if (this.sidestep(h, 0.35)) {
        h.timers.avoidPerson = 3;
        this.record(h, 'AVOID', `stepped aside for ${other.name}`);
      }
    }

    // ---- speed responds to surface condition and crossing ----
    const surf = here.street ? SURFACES[here.street.surface_condition].walk : 1;
    const turnDelta = Math.abs(wrapAngle(Math.atan2(toT.z, toT.x) - h.direction));
    let targetSpeed = h.baseSpeed * surf * (here.kind === 'crosswalk' ? 1.25 : 1);
    if (turnDelta > 0.9) targetSpeed *= 0.3;
    h.speed += Math.sign(targetSpeed - h.speed) * Math.min(Math.abs(targetSpeed - h.speed), 2.5 * dt);

    this.faceToward(h, target, dt);
    const step = h.speed * dt;
    let nx, nz;
    if (h.mode === 'route') {
      const k = Math.min(1, step / tl);
      nx = h.position.x + toT.x * k;
      nz = h.position.z + toT.z * k;
    } else {
      nx = h.position.x + Math.cos(h.direction) * step;
      nz = h.position.z + Math.sin(h.direction) * step;
    }
    // Rule: never step off the traversable surface.
    if (this.walkableAt(nx, nz)) h.position = { x: nx, z: nz };
    else if (this.walkableAt(nx, h.position.z)) h.position = { x: nx, z: h.position.z };
    else if (this.walkableAt(h.position.x, nz)) h.position = { x: h.position.x, z: nz };
    else h.speed = 0;

    if (h.mode === 'route' && dist(h.position, target) < 0.2) {
      const prev = h.path[h.pathIndex - 1] ?? h.position;
      const next = h.path[h.pathIndex + 1];
      h.pathIndex++;
      if (h.movement === 'avoiding' && h.pathIndex >= h.avoidEnd) h.movement = 'moving';
      if (next) {
        const a1 = Math.atan2(target.z - prev.z, target.x - prev.x);
        const a2 = Math.atan2(next.z - target.z, next.x - target.x);
        const turn = wrapAngle(a2 - a1);
        if (Math.abs(turn) > 0.6 && (h.timers.turnLog ?? 0) <= 0 && h.movement === 'moving') {
          h.timers.turnLog = 1.5;
          this.record(h, 'TURN', `${turn > 0 ? 'right' : 'left'} ${Math.round(Math.abs(turn) * 180 / Math.PI)}° following the street`);
        }
      }
      if (h.pathIndex >= h.path.length) this.finishPath(h);
    }
  }

  faceToward(h, p, dt) {
    const want = Math.atan2(p.z - h.position.z, p.x - h.position.x);
    if (Math.hypot(p.z - h.position.z, p.x - h.position.x) < 0.05) return;
    const d = wrapAngle(want - h.direction);
    h.direction = wrapAngle(h.direction + Math.sign(d) * Math.min(Math.abs(d), 6 * dt));
  }

  finishPath(h) {
    if (h.freeAfter) {
      h.freeAfter = false;
      h.mode = 'free';
      h.direction = h.freeHeading;
      h.movement = 'moving';
      h.path = [];
      h.pathVersion++;
      return;
    }
    h.movement = 'arrived';
    h.timers.dwell = 2.5;
    this.record(h, 'STOP', 'arrived at destination');
  }

  stopHuman(h, reason) {
    h.movement = 'stopped';
    h.speed = 0;
    h.stuckReason = reason;
    h.timers.stuck = 3;
    this.record(h, 'STOP', reason);
  }

  // ---------- cars ----------
  spawnCars() {
    this.cars = [];
    for (const s of this.streets) {
      const o = this.other(s);
      this.lanes(s).forEach((lane, li) => {
        const count = s.id === 'main' ? 3 : 2;
        for (let k = 0; k < count; k++) {
          // Queue upstream of the intersection, staggered per lane.
          const back = o.width / 2 + o.sidewalk + 6 + li * 5 + k * 13;
          this.cars.push({
            id: this.nextId++, streetId: s.id, dir: lane.dir, lat: lane.lat,
            along: -lane.dir * back,
            speed: 0, color: CAR_COLORS[(this.nextId + k) % CAR_COLORS.length],
          });
        }
      });
    }
  }

  carPos(c) {
    const s = this.street(c.streetId);
    return this.toWorld(s, c.along, c.lat);
  }

  updateCar(c, dt) {
    const s = this.street(c.streetId);
    const vmax = 9 * SURFACES[s.surface_condition].drive;
    const front = c.along + c.dir * 2.2;
    let stopDist = Infinity;
    // Car ahead in the same lane.
    for (const o of this.cars) {
      if (o === c || o.streetId !== c.streetId || o.dir !== c.dir || Math.abs(o.lat - c.lat) > 0.5) continue;
      const gap = (o.along - c.along) * c.dir;
      if (gap > 0) stopDist = Math.min(stopDist, gap - 4.4 - 1.5);
    }
    // Signal at the intersection.
    const sig = this.signalFor(s.id);
    const line = this.stopLine(s, c.dir);
    const toLine = (line - front) * c.dir;
    if (toLine > -0.3 && (sig === 'red' || (sig === 'yellow' && toLine > 5))) stopDist = Math.min(stopDist, toLine);
    // Yield to humans on a crosswalk.
    for (const cw of this.crosswalks(s)) {
      const edge = cw.at - c.dir * (cw.half + 1);
      const d = (edge - front) * c.dir;
      if (d < -0.3 || d > 25) continue;
      const occupied = this.humans.some((h) => {
        const k = this.classify(h.position.x, h.position.z);
        return k.kind === 'crosswalk' && k.street === s && Math.abs(this.along(s, h.position.x, h.position.z) - cw.at) <= cw.half + 0.3;
      });
      if (occupied) stopDist = Math.min(stopDist, d);
    }
    const vTarget = Math.max(0, Math.min(vmax, Math.sqrt(2 * 4 * Math.max(0, stopDist - 0.2))));
    c.speed = Math.min(c.speed + 3 * dt, vTarget);
    c.along += c.dir * c.speed * dt;
    if (c.along * c.dir > EXTENT + 6) c.along = -c.dir * (EXTENT + 6);
  }

  // ---------- demo content ----------
  seedFurniture() {
    const put = (streetId, side, along, offset, type, extra = {}) => {
      const t = FURNITURE_TYPES[type];
      this.furniture.push({
        id: this.nextId++, type, size: extra.size ?? 'M', streetId, side, along, offset,
        obstacle_status: extra.obstacle_status ?? t.obstacle,
      });
    };
    // Main Street — lamps along the curb, benches, bins, a bus stop.
    for (const a of [-34, -22, 14, 32]) { put('main', 1, a, 0.4, 'lamp'); put('main', -1, a + 4, 0.4, 'lamp'); }
    for (const a of [-28, 28]) put('main', 1, a, 0.6, 'tree');
    put('main', -1, -30, 0.6, 'tree');
    put('main', 1, -14, 2.7, 'bench');
    put('main', 1, -11.5, 0.5, 'bin');
    put('main', -1, 15, 2.4, 'bus_stop');
    put('main', -1, 11.5, 0.4, 'hydrant');
    put('main', -1, -16, 1.8, 'planter', { size: 'L' });
    put('main', 1, 8, 1.6, 'manhole');
    put('main', -1, -24, 1.2, 'grate');
    put('main', 1, 34, 2.5, 'bench');
    // Oak Avenue — street works narrowing the east sidewalk, bollards, trees.
    put('oak', 1, 16, 1.4, 'barrier');
    for (const a of [-12, 12]) { put('oak', 1, a, 0.3, 'bollard'); put('oak', -1, a, 0.3, 'bollard'); }
    for (const a of [-30, 26, 34]) put('oak', -1, a, 0.6, 'tree');
    put('oak', -1, -14, 2.2, 'bench');
    put('oak', 1, -28, 0.5, 'bin');
    put('oak', 1, 30, 1.5, 'manhole');
    put('oak', -1, 20, 2.0, 'planter');
  }

  seedHumans() {
    const add = (x, z, goal, opts = {}) => this.addHuman(x, z, { goal, ...opts });
    add(-30, -7, { x: 5.2, z: 30 }, { name: 'Ava' });
    add(-5.5, -32, { x: 32, z: 6.5 }, { name: 'Ben', baseSpeed: 1.2 });
    add(30, 6.5, { x: 22, z: -7 }, { name: 'Cleo', baseSpeed: 1.5 });
    add(5.5, 33, { x: 5.2, z: -30 }, { name: 'Dev', baseSpeed: 1.3 });
    add(-34, 6.5, { x: -6, z: -22 }, { name: 'Eli', baseSpeed: 1.1 });
  }
}

class MinHeap {
  constructor() { this.f = []; this.v = []; }
  get size() { return this.v.length; }
  push(f, v) {
    const F = this.f, V = this.v;
    let i = V.length;
    F.push(f); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= f) break;
      F[i] = F[p]; V[i] = V[p]; i = p;
    }
    F[i] = f; V[i] = v;
  }
  pop() {
    const F = this.f, V = this.v;
    const top = V[0];
    const lf = F.pop(), lv = V.pop();
    if (V.length) {
      let i = 0;
      const n = V.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        F[i] = F[c]; V[i] = V[c]; i = c;
      }
      F[i] = lf; V[i] = lv;
    }
    return top;
  }
}
