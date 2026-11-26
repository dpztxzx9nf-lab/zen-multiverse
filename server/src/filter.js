// Chat + name filter. Server side only (the client never decides what is clean).
// Normalises look-alikes (leet, accents, spacing, repeats) before matching, masks matches,
// and flags links / contact-sharing so strangers can't move a kid to another app.
// The word list here is a small seed; production should load a maintained list
// (for example LDNOOBW / a moderation API) into a KV value without a code change.
// STRONG: matched inside words too (no innocent words contain them). WORD: whole words only,
// so "Essex", "Dickens", "grapes" and "Scunthorpe"-style names are not caught.
const STRONG = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'killyourself', 'porn'];
const WORD = ['dick', 'pussy', 'retard', 'slut', 'rape', 'kys', 'nazi', 'cock', 'sex', 'fag', 'tits'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };
function norm(s) {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[0134578@$!|+]/g, (c) => LEET[c] || c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1');
}
const squash = (s) => s.replace(/(.)\1+/g, '$1');
export function badWords(text) {
  const n = norm(text), q = squash(n);
  const hits = STRONG.filter((w) => n.includes(w) || q.includes(squash(w)));
  for (const raw of String(text).split(/\s+/)) {
    const w = norm(raw);
    if (w && WORD.some((b) => w === b || squash(w) === squash(b) || w === b + 's')) hits.push(w);
  }
  return hits;
}
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|gg|io|me|ly|co|xyz|app)\b|discord|snap(chat)?|insta(gram)?|whats ?app|telegram|\b\d{3}[ .-]?\d{3}[ .-]?\d{4}\b|@[a-z0-9_]{3,})/i;
// returns { text, flagged, blocked }
export function cleanChat(raw) {
  let text = String(raw).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return { text: '', blocked: true };
  const bad = badWords(text);
  let flagged = bad.length > 0;
  if (LINK.test(text)) return { text: '', blocked: true, reason: 'links and contact details are not allowed' };
  if (flagged) {
    // mask any word that normalises to something on the list
    const masked = text.split(' ').map((w) => (badWords(w).length ? '*'.repeat(Math.min(6, w.length)) : w)).join(' ');
    // spread across words ("f u c k"): nothing single to mask, so the line is dropped
    if (masked === text) return { text: '', flagged: true, blocked: true, reason: 'please keep it kind' };
    text = masked;
  }
  return { text, flagged, blocked: false };
}
export function cleanName(raw) {
  const s = String(raw || '').normalize('NFKC').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (s.length < 2) return null;
  if (badWords(s).length || LINK.test(s)) return null;
  return s;
}
