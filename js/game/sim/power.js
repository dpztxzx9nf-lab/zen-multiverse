// Power and logic: build pieces that conduct (anything metal, plus the electrical pieces) join into
// networks where they touch. Sources feed watts in, consumers take them out; if a network has less
// than it needs, everything on it browns out together. Switches open and close a path; relays
// (AND / OR / NOT) pass power from their supply contact (underneath) to their output (front) when
// their control contacts (back / sides) are live. Gates switch one tick after their inputs, so
// clocks and latches work like redstone, deterministically.
// Pure: pieces come in as { id, type, mat, contacts: [{ id, side }] } plus readings from the world.
export const ELECTRIC = {
  wire: { conducts: true },
  lamp: { consumer: 25, conducts: true },
  heater: { consumer: 600, conducts: true },
  switch: { switch: true },
  relay: { gate: true },
  solar: { source: 'sun', conducts: true },
  wheel: { source: 'water', conducts: true },
  vane: { source: 'wind', conducts: true },
  battery: { store: 36000, rate: 150, conducts: true }, // 10 Wh (J), charges/discharges up to 150 W
};
export const GATES = ['and', 'or', 'xor', 'not'];
export function createPower() {
  let pieces = new Map();     // id -> { id, type, mat, contacts, state }
  let nets = [];              // [{ ids:Set, supply, demand, ratio, live }]
  const netOf = new Map();    // id -> net index
  const state = new Map();    // id -> { on (switch), mode (relay), out (relay output now), watts (source), level (consumer 0..1) }
  const conducts = (p) => { const E = ELECTRIC[p.type]; if (E && E.switch) return !!st(p.id).on; if (E && E.gate) return false; return (E && E.conducts) || p.mat === 'metal'; };
  const st = (id) => { let s = state.get(id); if (!s) state.set(id, (s = { on: false, mode: 'and', out: false, watts: 0, level: 0, charge: 0 })); return s; };
  // topology: union-find over conducting pieces that touch (switches join both sides when closed)
  function rebuild(list) {
    pieces = new Map(list.map((p) => [p.id, p]));
    for (const id of [...state.keys()]) if (!pieces.has(id)) state.delete(id);
    const parent = new Map(); const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    for (const p of pieces.values()) if (conducts(p)) parent.set(p.id, p.id);
    for (const p of pieces.values()) { if (!conducts(p)) continue; for (const c of p.contacts) { const q = pieces.get(c.id); if (q && conducts(q)) { const a = find(p.id), b = find(q.id); if (a !== b) parent.set(a, b); } } }
    const byRoot = new Map(); nets = []; netOf.clear();
    for (const id of parent.keys()) { const r = find(id); let n = byRoot.get(r); if (n == null) { n = nets.length; byRoot.set(r, n); nets.push({ ids: new Set(), supply: 0, demand: 0, ratio: 0, live: false, fed: 0 }); } nets[n].ids.add(id); netOf.set(id, n); }
  }
  // the networks a relay touches on each side
  function relaySides(p) { const s = { supply: new Set(), out: new Set(), ctl: new Set() }; for (const c of p.contacts) { const n = netOf.get(c.id); if (n == null) continue; (c.side === 'bottom' ? s.supply : c.side === 'front' ? s.out : s.ctl).add(n); } return s; }
  // one tick. read(p) -> watts a source makes now (sun, water speed, wind)
  function tick(read, dt = 0.1) {
    for (const n of nets) { n.supply = 0; n.demand = 0; n.fed = 0; }
    for (const p of pieces.values()) {
      const E = ELECTRIC[p.type]; const n = netOf.get(p.id); if (!E || n == null) continue;
      if (E.source) { const w = Math.max(0, read(p) || 0); st(p.id).watts = w; nets[n].supply += w; }
      if (E.consumer) nets[n].demand += E.consumer;
    }
    // relays: last tick's decision feeds this tick's output networks (one tick of delay)
    for (const p of pieces.values()) {
      if (!ELECTRIC[p.type]?.gate) continue; const s = st(p.id), sides = relaySides(p);
      if (!s.out) continue;
      let avail = 0; for (const n of sides.supply) avail += Math.max(0, nets[n].supply - nets[n].demand);
      for (const n of sides.out) nets[n].fed += avail / Math.max(1, sides.out.size);
    }
    // batteries soak up the surplus and cover a shortfall (energy is kept, not made: J in = J out)
    for (const p of pieces.values()) {
      const E = ELECTRIC[p.type]; const n = netOf.get(p.id); if (!E || !E.store || n == null) continue; const s = st(p.id), N = nets[n];
      const spare = N.supply + N.fed - N.demand;
      if (spare > 0) { const w = Math.min(spare, E.rate, (E.store - s.charge) / dt); s.charge += w * dt * 0.9; N.demand += w; s.watts = -w; }
      else if (spare < 0) { const w = Math.min(-spare, E.rate, s.charge / dt); s.charge -= w * dt; N.supply += w; s.watts = w; }
      else s.watts = 0;
    }
    for (const n of nets) { const sup = n.supply + n.fed; n.ratio = n.demand > 0 ? Math.min(1, sup / n.demand) : sup > 0 ? 1 : 0; n.live = sup > 0.5; }
    for (const p of pieces.values()) { const E = ELECTRIC[p.type]; const n = netOf.get(p.id); if (E && E.consumer) st(p.id).level = n == null ? 0 : nets[n].ratio; }
    // decide relays for the next tick
    for (const p of pieces.values()) {
      if (!ELECTRIC[p.type]?.gate) continue; const s = st(p.id), sides = relaySides(p);
      const lives = [...sides.ctl].filter((n) => nets[n].live).length;
      const logic = s.mode === 'and' ? lives >= 2 : s.mode === 'or' ? lives >= 1 : s.mode === 'xor' ? lives === 1 : lives === 0;
      const supplied = [...sides.supply].some((n) => nets[n].supply + nets[n].fed > 0.5);
      s.out = logic && supplied;
    }
  }
  return {
    ELECTRIC, rebuild, tick, state: st, get nets() { return nets; }, netOf: (id) => { const n = netOf.get(id); return n == null ? null : nets[n]; },
    toggle(id) { const s = st(id); s.on = !s.on; return s.on; },
    cycleMode(id) { const s = st(id); s.mode = GATES[(GATES.indexOf(s.mode) + 1) % GATES.length]; return s.mode; },
    save() { const o = {}; for (const [id, s] of state) if (s.on || s.mode !== 'and' || s.charge > 0) o[id] = [s.on ? 1 : 0, s.mode, Math.round(s.charge)]; return o; },
    load(o) { for (const [id, [on, mode, ch]] of Object.entries(o || {})) { const s = st(id); s.on = !!on; s.mode = mode || 'and'; s.charge = ch || 0; } },
  };
}
