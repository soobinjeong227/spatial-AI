// Neighborhood semantic model: entities, rules and actions.
// Pure data + logic; no rendering. See MODEL.md for the rule list.

export const RULES = {
  GRID_SIZE: 14,
  MAX_FLOORS: 3,
  RESIDENTS_PER_FLOOR: 2,
  JOBS_PER_FLOOR: 3,
  TREES_PER_PARK: 4,
};

export const ZONES = ['residential', 'commercial', 'green'];
export const ZONE_FOR = { house: 'residential', shop: 'commercial', park: 'green' };

const FIRST_NAMES = [
  'Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lea',
  'Max', 'Noor', 'Oti', 'Pia', 'Quin', 'Ravi', 'Sol', 'Tess', 'Uma', 'Vik', 'Wren', 'Yara', 'Zed',
];
const HOUSE_COLORS = ['#f4e3c1', '#e8b4a0', '#c9d8e8', '#f2d06b', '#d7c4e8', '#f7f2ea', '#b9dcc4'];
const SHOP_COLORS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9b5de5'];
const SHOP_KINDS = ['Café', 'Grocer', 'Bakery', 'Books', 'Florist', 'Hardware', 'Pharmacy'];
const RESIDENT_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8338ec', '#ff006e', '#3a86ff', '#fb8500'];

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const ok = (msg) => ({ ok: true, msg });
const fail = (reason) => ({ ok: false, reason });

export class Neighborhood {
  constructor(name = 'Maple Grove', size = RULES.GRID_SIZE) {
    this.name = name;
    this.size = size;
    this.cells = [];
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        this.cells.push({ x, z, kind: 'lot', zone: 'residential', structureId: null });
      }
    }
    this.structures = new Map();
    this.residents = new Map();
    this.nextId = 1;
    this.listeners = new Set();
  }

  // ---------- events ----------
  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  // ---------- serialization (used for undo / reset) ----------
  toJSON() {
    return JSON.stringify({
      name: this.name,
      size: this.size,
      cells: this.cells,
      structures: [...this.structures.values()],
      residents: [...this.residents.values()],
      nextId: this.nextId,
    });
  }

  load(json) {
    const d = JSON.parse(json);
    this.name = d.name;
    this.size = d.size;
    this.cells = d.cells;
    this.structures = new Map(d.structures.map((s) => [s.id, s]));
    this.residents = new Map(d.residents.map((r) => [r.id, r]));
    this.nextId = d.nextId;
    this.emit();
  }

  // ---------- queries ----------
  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.size && z < this.size; }
  cell(x, z) { return this.inBounds(x, z) ? this.cells[z * this.size + x] : null; }
  isStreet(x, z) { const c = this.cell(x, z); return !!c && c.kind === 'street'; }
  structureAt(x, z) { const c = this.cell(x, z); return c && c.structureId ? this.structures.get(c.structureId) : null; }

  streetNeighbors(x, z, ignore = null) {
    const out = [];
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (ignore && ignore.x === nx && ignore.z === nz) continue;
      if (this.isStreet(nx, nz)) out.push({ x: nx, z: nz, dx, dz });
    }
    return out;
  }

  hasStreetAccess(x, z, ignore = null) { return this.streetNeighbors(x, z, ignore).length > 0; }

  capacity(s) {
    if (s.type === 'house') return s.floors * RULES.RESIDENTS_PER_FLOOR;
    if (s.type === 'shop') return s.floors * RULES.JOBS_PER_FLOOR;
    return 0;
  }

  residentsOf(houseId) { return [...this.residents.values()].filter((r) => r.homeId === houseId); }
  employeesOf(shopId) { return [...this.residents.values()].filter((r) => r.workId === shopId); }
  structuresOfType(type) { return [...this.structures.values()].filter((s) => s.type === type); }

  // Shortest street path (list of street cells) between two structures, or null.
  route(from, to) {
    const starts = this.streetNeighbors(from.x, from.z);
    const goals = new Set(this.streetNeighbors(to.x, to.z).map((c) => c.z * this.size + c.x));
    if (!starts.length || !goals.size) return null;
    const prev = new Map();
    const queue = [];
    for (const s of starts) {
      const k = s.z * this.size + s.x;
      if (!prev.has(k)) { prev.set(k, -1); queue.push(k); }
    }
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i];
      if (goals.has(k)) {
        const path = [];
        for (let p = k; p !== -1; p = prev.get(p)) path.push({ x: p % this.size, z: Math.floor(p / this.size) });
        return path.reverse();
      }
      const x = k % this.size, z = Math.floor(k / this.size);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        const nk = nz * this.size + nx;
        if (this.isStreet(nx, nz) && !prev.has(nk)) { prev.set(nk, k); queue.push(nk); }
      }
    }
    return null;
  }

  stats() {
    const houses = this.structuresOfType('house');
    const shops = this.structuresOfType('shop');
    const parks = this.structuresOfType('park');
    const residents = [...this.residents.values()];
    const jobs = shops.reduce((n, s) => n + this.capacity(s), 0);
    const housing = houses.reduce((n, s) => n + this.capacity(s), 0);
    const employed = residents.filter((r) => r.workId).length;
    return {
      population: residents.length,
      housing,
      houses: houses.length,
      shops: shops.length,
      parks: parks.length,
      trees: parks.reduce((n, p) => n + p.trees, 0),
      jobs,
      employed,
      unemployed: residents.length - employed,
      streets: this.cells.filter((c) => c.kind === 'street').length,
    };
  }

  // ---------- rule checks: return null when allowed, else the reason ----------
  checkBuild(type, x, z) {
    const c = this.cell(x, z);
    if (!c) return 'Outside the neighborhood.';
    if (c.kind === 'street') return 'Rule 1: you can\'t build on a street.';
    if (c.structureId) return 'Rule 1: this lot already has a structure.';
    if (c.zone !== ZONE_FOR[type]) return `Rule 2: a ${type} needs a ${ZONE_FOR[type]} lot (this one is ${c.zone}).`;
    if (!this.hasStreetAccess(x, z)) return 'Rule 3: the lot must touch a street.';
    return null;
  }

  checkStreet(x, z) {
    const c = this.cell(x, z);
    if (!c) return 'Outside the neighborhood.';
    if (c.kind === 'street') return 'This is already a street.';
    if (c.structureId) return 'Rule 1: demolish the structure on this lot first.';
    return null;
  }

  checkRezone(x, z) {
    const c = this.cell(x, z);
    if (!c) return 'Outside the neighborhood.';
    if (c.kind === 'street') return 'Streets have no zone.';
    if (c.structureId) return 'Rule 5: only an empty lot can be rezoned.';
    return null;
  }

  checkTree(x, z) {
    const s = this.structureAt(x, z);
    if (!s || s.type !== 'park') return 'Rule 11: trees can only be planted in a park.';
    if (s.trees >= RULES.TREES_PER_PARK) return `Rule 11: a park holds at most ${RULES.TREES_PER_PARK} trees.`;
    return null;
  }

  checkDemolish(x, z) {
    const c = this.cell(x, z);
    if (!c) return 'Outside the neighborhood.';
    if (c.kind === 'street') {
      for (const [dx, dz] of DIRS) {
        const s = this.structureAt(x + dx, z + dz);
        if (s && !this.hasStreetAccess(s.x, s.z, { x, z })) {
          return `Rule 4: the ${s.type} at (${s.x}, ${s.z}) would lose its only street access.`;
        }
      }
      return null;
    }
    if (!c.structureId) return 'Nothing to demolish here.';
    return null;
  }

  checkAddFloor(s) {
    if (!s || (s.type !== 'house' && s.type !== 'shop')) return 'Rule 6: only houses and shops have floors.';
    if (s.floors >= RULES.MAX_FLOORS) return `Rule 6: the maximum is ${RULES.MAX_FLOORS} floors.`;
    return null;
  }

  checkRemoveFloor(s) {
    if (!s || (s.type !== 'house' && s.type !== 'shop')) return 'Rule 6: only houses and shops have floors.';
    if (s.floors <= 1) return 'Rule 6: a building needs at least 1 floor.';
    if (s.type === 'house' && this.residentsOf(s.id).length > (s.floors - 1) * RULES.RESIDENTS_PER_FLOOR) {
      return 'Rule 7: the remaining floors couldn\'t house every resident.';
    }
    return null;
  }

  checkAddResident(s) {
    if (!s || s.type !== 'house') return 'Rule 8: residents must live in a house.';
    if (this.residentsOf(s.id).length >= this.capacity(s)) return 'Rule 7: this house is full. Add a floor first.';
    return null;
  }

  // ---------- actions ----------
  run(reason, fn) {
    if (reason) return fail(reason);
    const msg = fn();
    this.rebalanceJobs();
    this.emit();
    return ok(msg);
  }

  build(type, x, z, opts = {}) {
    return this.run(this.checkBuild(type, x, z), () => {
      const id = this.nextId++;
      const s = { id, type, x, z };
      if (type === 'house') {
        s.floors = opts.floors ?? 1;
        s.color = opts.color ?? HOUSE_COLORS[id % HOUSE_COLORS.length];
      } else if (type === 'shop') {
        s.floors = opts.floors ?? 1;
        s.color = opts.color ?? SHOP_COLORS[id % SHOP_COLORS.length];
        s.kind = opts.kind ?? SHOP_KINDS[id % SHOP_KINDS.length];
      } else if (type === 'park') {
        s.trees = opts.trees ?? 0;
      }
      this.structures.set(id, s);
      this.cell(x, z).structureId = id;
      return `Built a ${type === 'shop' ? s.kind.toLowerCase() + ' shop' : type} at (${x}, ${z}).`;
    });
  }

  buildStreet(x, z) {
    return this.run(this.checkStreet(x, z), () => {
      const c = this.cell(x, z);
      c.kind = 'street';
      return `Paved a street at (${x}, ${z}).`;
    });
  }

  rezone(x, z) {
    return this.run(this.checkRezone(x, z), () => {
      const c = this.cell(x, z);
      c.zone = ZONES[(ZONES.indexOf(c.zone) + 1) % ZONES.length];
      return `Rezoned (${x}, ${z}) as ${c.zone}.`;
    });
  }

  plantTree(x, z) {
    return this.run(this.checkTree(x, z), () => {
      const s = this.structureAt(x, z);
      s.trees++;
      return `Planted a tree (${s.trees}/${RULES.TREES_PER_PARK}).`;
    });
  }

  demolish(x, z) {
    return this.run(this.checkDemolish(x, z), () => {
      const c = this.cell(x, z);
      if (c.kind === 'street') {
        c.kind = 'lot';
        return `Removed the street at (${x}, ${z}).`;
      }
      const s = this.structures.get(c.structureId);
      this.structures.delete(s.id);
      c.structureId = null;
      if (s.type === 'house') return this.rehome(s);
      if (s.type === 'shop') {
        const n = this.employeesOf(s.id).length;
        for (const r of this.employeesOf(s.id)) r.workId = null;
        return `Closed the ${s.kind.toLowerCase()}. ${n} worker(s) are looking for new jobs.`;
      }
      return `Removed the park at (${x}, ${z}).`;
    });
  }

  // Rule 8: residents of a demolished house move to the nearest house with room, or leave.
  rehome(oldHouse) {
    let moved = 0, left = 0;
    for (const r of [...this.residents.values()].filter((r) => r.homeId === oldHouse.id)) {
      const target = this.structuresOfType('house')
        .filter((h) => this.residentsOf(h.id).length < this.capacity(h))
        .sort((a, b) => dist(a, oldHouse) - dist(b, oldHouse))[0];
      if (target) { r.homeId = target.id; moved++; }
      else { this.residents.delete(r.id); left++; }
    }
    return `Demolished the house. ${moved} resident(s) moved, ${left} left the neighborhood.`;
  }

  addFloor(id) {
    const s = this.structures.get(id);
    return this.run(this.checkAddFloor(s), () => { s.floors++; return `${label(s)} now has ${s.floors} floors.`; });
  }

  removeFloor(id) {
    const s = this.structures.get(id);
    return this.run(this.checkRemoveFloor(s), () => { s.floors--; return `${label(s)} now has ${s.floors} floor(s).`; });
  }

  addResident(houseId, opts = {}) {
    const s = this.structures.get(houseId);
    return this.run(this.checkAddResident(s), () => {
      const id = this.nextId++;
      const r = {
        id,
        name: opts.name ?? FIRST_NAMES[id % FIRST_NAMES.length],
        color: RESIDENT_COLORS[id % RESIDENT_COLORS.length],
        homeId: houseId,
        workId: null,
      };
      this.residents.set(id, r);
      return `${r.name} moved in.`;
    });
  }

  removeResident(id) {
    const r = this.residents.get(id);
    return this.run(r ? null : 'No such resident.', () => {
      this.residents.delete(id);
      return `${r.name} moved away.`;
    });
  }

  // Rules 9 & 10: keep employment consistent with shop capacity and street connectivity.
  rebalanceJobs() {
    const residents = [...this.residents.values()];
    for (const r of residents) {
      if (!r.workId) continue;
      const shop = this.structures.get(r.workId);
      const home = this.structures.get(r.homeId);
      if (!shop || !home || !this.route(home, shop)) r.workId = null;
    }
    for (const shop of this.structuresOfType('shop')) {
      const staff = this.employeesOf(shop.id);
      for (const r of staff.slice(this.capacity(shop))) r.workId = null;
    }
    for (const r of residents) {
      if (r.workId) continue;
      const home = this.structures.get(r.homeId);
      let best = null, bestLen = Infinity;
      for (const shop of this.structuresOfType('shop')) {
        if (this.employeesOf(shop.id).length >= this.capacity(shop)) continue;
        const path = this.route(home, shop);
        if (path && path.length < bestLen) { best = shop; bestLen = path.length; }
      }
      if (best) r.workId = best.id;
    }
  }
}

function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.z - b.z); }

export function label(s) {
  if (!s) return '';
  if (s.type === 'shop') return `${s.kind} #${s.id}`;
  return `${s.type[0].toUpperCase()}${s.type.slice(1)} #${s.id}`;
}

// A small, hand-laid example neighborhood.
export function createExample() {
  const n = new Neighborhood('Maple Grove');
  const street = (x, z) => { n.cell(x, z).kind = 'street'; };
  for (let x = 0; x < n.size; x++) { street(x, 3); street(x, 9); }
  for (let z = 0; z < n.size; z++) street(6, z);
  for (let z = 3; z <= 9; z++) street(11, z);

  const zone = (x0, z0, x1, z1, zone) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const c = n.cell(x, z);
      if (c.kind === 'lot') c.zone = zone;
    }
  };
  zone(5, 2, 7, 4, 'commercial');
  zone(5, 8, 7, 10, 'commercial');
  zone(12, 4, 13, 8, 'commercial');
  zone(0, 10, 2, 13, 'green');
  zone(8, 5, 10, 7, 'green');

  // Houses along the streets.
  const houses = [
    [1, 2, 2], [2, 2, 1], [3, 2, 3], [4, 2, 1], [8, 2, 2], [9, 2, 1], [10, 2, 2], [12, 2, 1],
    [1, 4, 1], [3, 4, 2], [4, 4, 1], [8, 4, 1], [10, 4, 3],
    [3, 8, 2], [4, 8, 1], [8, 8, 2], [10, 8, 1], [4, 10, 2], [8, 10, 3], [10, 10, 1], [12, 10, 2],
    [5, 6, 1], [7, 6, 2],
  ];
  const houseIds = [];
  for (const [x, z, floors] of houses) {
    n.build('house', x, z, { floors });
    houseIds.push(n.cell(x, z).structureId);
  }

  for (const [x, z, floors, kind] of [
    [5, 2, 1, 'Café'], [7, 4, 2, 'Grocer'], [5, 10, 1, 'Bakery'], [7, 8, 1, 'Books'], [12, 5, 2, 'Hardware'],
    [12, 6, 2, 'Pharmacy'], [12, 7, 1, 'Florist'],
  ]) n.build('shop', x, z, { floors, kind });

  for (const [x, z, trees] of [[0, 10, 2], [1, 10, 4], [2, 10, 3], [10, 5, 4], [10, 6, 1], [10, 7, 3]]) {
    n.build('park', x, z, { trees });
  }

  houseIds.forEach((id, i) => {
    const count = 1 + (i % 2);
    for (let k = 0; k < count; k++) n.addResident(id);
  });
  return n;
}
