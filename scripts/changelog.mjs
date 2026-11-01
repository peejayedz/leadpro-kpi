// Reads CHANGELOG.md for the dashboard ("What's new", footer version) and the admin page.
// No DOM, no Node APIs.
//
// Format:   ## v1.2.0 — 2 Nov 2026
//           - [client] Text with **bold** and `code`.
//           - [internal] …

export function parseChangelog(md) {
  const versions = [];
  let cur = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^##\s+v?(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.+))?$/.exec(line.trim());
    if (h) { cur = { version: h[1], date: (h[2] || '').trim(), entries: [] }; versions.push(cur); continue; }
    const e = /^[-*]\s+\[(client|internal)\]\s+(.+)$/i.exec(line.trim());
    if (e && cur) cur.entries.push({ tag: e[1].toLowerCase(), text: e[2].trim() });
  }
  return versions;
}

export const latestVersion = versions => versions[0]?.version || null;

// Only the entries with a given tag; versions left empty are dropped.
export const onlyTag = (versions, tag) => versions.map(v => ({ ...v, entries: v.entries.filter(e => e.tag === tag) })).filter(v => v.entries.length);

// Safe inline markdown: escapes HTML, then **bold** and `code`.
export function inlineMd(text) {
  const esc = String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return esc.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}
