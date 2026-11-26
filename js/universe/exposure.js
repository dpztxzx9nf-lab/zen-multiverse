// Standing in a world's air: hook WorldRules into survival. If the suit/oxygen system (game/survive.js)
// is present it does the work, fed with this world's hazard numbers; otherwise a small built-in fallback
// keeps the rule honest: unbreathable air or lethal cold/heat drains you away from the ship until you
// have to retreat to it. Breathable, mild worlds cost nothing.
import { game } from '../game/store.js';
export function createExposure({ rules, player, hud, isSafe, retreat }) {
  const S = rules.survival;
  const hostile = !!S.hazard;
  let real = null, dead = false;
  const hazard = hostile ? { ...S, vacuum: true, hazard: 'vacuum' } : null;
  if (hostile) import('../game/survive.js').then((m) => {
    if (dead || !m.createSurvival) return;
    real = m.createSurvival({ world: 'planet', player, hud, hazard, isSafe, retreat, isPaused: () => hud.dialogOpen || hud.panelOpen });
  }).catch(() => { /* survive.js not on this build: the fallback below runs */ });
  // fallback: one "reserve" that the worst hazard drains; warnings at half and a quarter
  const worst = Math.min(S.o2Empty, S.coldEmpty, S.heatEmpty, S.radFull);
  let reserve = 1, warned = 0, busy = false;
  const suited = () => { const g = game.data.g7; return !!(g && g.gear && g.gear.suit); };
  return {
    get hostile() { return hostile; },
    get reserve() { return real ? (real.state.o2 / 100) : reserve; },
    tick(dt) {
      if (!hostile) return;
      if (real) { real.tick(dt); return; }
      if (busy || hud.dialogOpen || hud.panelOpen) return;
      if (isSafe && isSafe()) { reserve = Math.min(1, reserve + dt * 0.3); if (reserve > 0.9) warned = 0; return; }
      const k = suited() ? (S.crush ? 1 : 0.06) : 1; // a suit keeps most of it out (nothing survives Venus' crush)
      reserve -= dt * k / (isFinite(worst) ? worst : 1e9);
      if (reserve < 0.5 && warned < 1) { warned = 1; hud.toast(`${S.reasons.length ? S.reasons.join(', ') : 'The cold'}: half your reserve is gone. Head back to the ship.`, 'star', 4500); }
      if (reserve < 0.25 && warned < 2) { warned = 2; hud.toast('Your vision narrows. Get back to the ship.', 'star', 4500); }
      if (reserve <= 0 && !busy) {
        busy = true;
        (async () => { try { await hud.fadeTo(1, 900); await retreat(); } catch (e) { /* */ } reserve = 1; warned = 0; try { await hud.fadeTo(0, 1200); } catch (e) { /* */ } hud.toast('You came to inside the ship.', 'star', 4200); busy = false; })();
      }
    },
    dispose() { dead = true; if (real && real.dispose) real.dispose(); },
  };
}
