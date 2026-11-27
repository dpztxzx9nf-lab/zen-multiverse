// Character studio auto-opens only on a true first run. Returning players
// (a saved look, any play progress, or an update relaunch) go straight into
// the world. Pure: no DOM, no save I/O.
export function lookIsCustomized(look, def) {
  if (!look || !def) return false;
  if (look.body !== def.body) return true;
  if (look.hair !== def.hair) return true;
  if (look.outfit !== def.outfit) return true;
  if (look.beard) return true;
  if (Math.abs((look.height || 0.5) - (def.height || 0.5)) > 0.01) return true;
  if (Math.abs((look.build || 0.5) - (def.build || 0.5)) > 0.01) return true;
  if (look.skin && def.skin && look.skin !== def.skin) return true;
  return false;
}

export function hasPlayProgress(g) {
  if (!g || typeof g !== 'object') return false;
  if (g.where) return true;
  const tools = g.g7 && g.g7.tools;
  if (tools && (tools.pick || tools.axe || tools.shovel || tools.m4)) return true;
  const planets = g.journal && g.journal.planets;
  if (planets && Object.keys(planets).length) return true;
  if (g.gather && Object.keys(g.gather).length) return true;
  return false;
}

export function shouldOpenFirstRunStudio({ created = false, look = null, defaultLook = null, hasProgress = false, relaunch = false } = {}) {
  if (relaunch) return false;
  if (created) return false;
  if (hasProgress) return false;
  if (lookIsCustomized(look, defaultLook)) return false;
  return true;
}
