// Slack DM alerts to PJ: one incoming webhook in the secret SLACK_WEBHOOK_URL.
// Byte-identical copy in ghl-subaccount-builder/scripts/lib/slack.mjs (tests compare the two files).
//
// Rules:
// - postSlack() never throws. A missing webhook, Slack being down or a timeout is logged and returned
//   as { ok: false, reason }, so an alert can never break a sync, a setup or anything else.
// - The webhook URL is never printed, logged or put in an error. Logs say only "sent" / "not sent (why)".
// - Message text is built by the callers from firm/client names, automation names and short excerpts only.

export const WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/(services|triggers|workflows)\/[A-Za-z0-9_/-]{10,}$/;

// Slack mrkdwn: &, < and > must be escaped in any text we didn't write ourselves.
export const slackEscape = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A link: <url|label>. The label can't contain "|" or ">" (escaped above / replaced here).
export const slackLink = (url, label) => `<${String(url).replace(/[\s<>|]/g, encodeURIComponent)}|${slackEscape(label).replace(/\|/g, '¦')}>`;

// One line, at most `max` characters (an ellipsis when cut).
export function excerpt(text, max = 200) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Asia/Manila time for messages, e.g. "Tue 18 Nov, 8:37 AM".
export function manilaTime(d = new Date(), withTime = true) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(d).map(x => [x.type, x.value]));
  const day = `${p.weekday} ${p.day} ${p.month}`;
  return withTime ? `${day}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}` : day;
}

// "45 min", "3 h 10 min", "2 days"
export function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60e3));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
  return `${Math.round(m / 1440)} days`;
}

export async function postSlack(text, { env = process.env, fetchImpl = globalThis.fetch, log = console.log, timeoutMs = 10000, tries = 2, waitMs = 2000 } = {}) {
  const url = String(env.SLACK_WEBHOOK_URL || '').trim();
  if (!url) { log('Slack: not sent (SLACK_WEBHOOK_URL is not set)'); return { ok: false, reason: 'missing' }; }
  if (!WEBHOOK_RE.test(url) && env.SLACK_ALLOW_TEST_URL !== '1') { log('Slack: not sent (SLACK_WEBHOOK_URL is not a Slack webhook address)'); return { ok: false, reason: 'bad-url' }; }
  for (let i = 1; i <= tries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }), signal: ac.signal });
      if (r.ok) { log('Slack: sent'); return { ok: true }; }
      log(`Slack: not sent (HTTP ${r.status})`);
      if (r.status < 500 && r.status !== 429) return { ok: false, reason: `http-${r.status}` };   // a wrong or revoked webhook: retrying won't help
    } catch (e) {
      log(`Slack: not sent (${e?.name === 'AbortError' ? 'timed out' : 'network error'})`);
    } finally { clearTimeout(timer); }
    if (i < tries) await new Promise(res => setTimeout(res, waitMs));
  }
  return { ok: false, reason: 'failed' };
}
