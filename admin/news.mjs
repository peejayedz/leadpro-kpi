// Admin What's new cards: CHANGELOG.md (parsed by scripts/changelog.mjs) + the plain wording in admin/whats-new.json.
// Admin only. The client dashboards' What's new reads CHANGELOG.md's [client] lines directly and is not affected.

const TYPES = ['new', 'improved', 'fixed'];
// Fallback for a version with no plain wording: a type from the first word, the first sentence without code.
export function guessItem(entry) {
  const t = String(entry.text);
  const type = /^fix(ed)?\b|^fixed\b/i.test(t) || /^Fix:/.test(t) ? 'fixed' : /^(new|adds?|added)\b/i.test(t) ? 'new' : 'improved';
  const plain = t.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^Fix:\s*/, '');
  const first = (plain.match(/^.*?[.!?](\s|$)/) || [plain])[0].trim();
  return { type, tag: entry.tag, text: first };
}

export function buildCards(versions, plain = {}) {
  return (versions || []).map(v => {
    const p = plain[v.version];
    const items = (p?.items?.length ? p.items : v.entries.map(guessItem)).map(i => ({ type: TYPES.includes(i.type) ? i.type : 'improved', tag: i.tag === 'client' ? 'client' : 'internal', text: i.text }));
    const tags = [...new Set([...items.map(i => i.tag), ...v.entries.map(e => e.tag)])];
    return { version: v.version, date: v.date, summary: p?.summary || items[0]?.text || '', items, tags, technical: v.entries };
  });
}

// Cards shown for a filter: 'all' | 'client' | 'internal'. Items are filtered too; empty cards are dropped.
export function filterCards(cards, f) {
  if (f !== 'client' && f !== 'internal') return cards;
  return cards.map(c => ({ ...c, items: c.items.filter(i => i.tag === f), technical: c.technical.filter(e => e.tag === f) })).filter(c => c.items.length || c.technical.length);
}

// Unseen: the latest version is newer than the one this browser last opened.
const num = v => String(v || '0.0.0').split('.').map(Number);
// v1.26.0 (PJ, 19 Nov): a What's new CARD only for minor releases (x.Y.0). A patch (x.y.Z, Z > 0) gets a CHANGELOG line
// only and never pops a card, not even with wording made from CHANGELOG.md. On a patch, the card (if still unseen) is the
// one of its minor release: cardVersion('1.26.2') = '1.26.0'.
export const isMinor = v => /^\d+\.\d+\.0$/.test(String(v || ''));
export const cardVersion = v => { const m = String(v || '').match(/^(\d+)\.(\d+)\.\d+$/); return m ? `${m[1]}.${m[2]}.0` : null; };
export const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
