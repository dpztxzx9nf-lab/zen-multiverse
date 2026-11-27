// "What next?" — one short sentence from the save, shown in the bag and now and then as a whisper.
import { game, itemInfo, dayKey } from './store.js';

const nameOf = (id) => (id === 'find:any' ? 'finds' : id === 'flower:any' ? 'flowers' : itemInfo(id).name.toLowerCase());
function missing(cost) {
  const out = [];
  for (const [id, n] of Object.entries(cost)) {
    const have = id === 'find:any' ? game.total('find:') : id === 'flower:any' ? game.total('flower:') : game.count(id);
    if (have < n) out.push(`${n - have} more ${nameOf(id)}`);
  }
  return out;
}

// returns { key, text } (key changes when the suggestion really changes)
export function nextStep() {
  const G = game.data, today = dayKey();
  const beds = (G.beds || []).filter(Boolean);
  if (!beds.length) return { key: 'plant', text: 'The beds by the house are waiting. A seed from your bag would do.' };
  const dry = beds.filter((b) => !(b.w || []).includes(today));
  if (dry.length && dry.length === beds.length) return { key: 'water:' + today, text: 'The beds have not had water today.' };
  const fauna = Object.values((G.journal && G.journal.species) || {}).filter((e) => e.kind === 'fauna').length;
  const named = Object.keys((G.journal && G.journal.species) || {}).length;
  if (!fauna) return { key: 'watch', text: 'Stand still and watch an animal for a while to name it.' };
  return { key: 'free', text: named ? `${named} species named. The city and the shore are yours to walk.` : 'The city and the shore are yours to walk.' };
}
