// FIX 10.0 (24 Nov 2026): test browsers never make a sound. Every Playwright launch adds --mute-audio (Chrome's own audio),
// and every new context / page gets QUIET_INIT: speechSynthesis.speak (the system voice, which --mute-audio doesn't reach)
// and media play() are stubbed. The stubs still fire start / end (and ended), so code waiting for them behaves the same,
// and tests that hook speak / play keep counting calls.
export const MUTE_ARGS = ['--mute-audio'];
export const QUIET_INIT = `(() => { try {
  const S = window.SpeechSynthesis;
  if (S && S.prototype) S.prototype.speak = function (u) { setTimeout(() => { try { u.dispatchEvent(new Event('start')); u.dispatchEvent(new Event('end')); } catch (e) {} }, 30); };
  const M = window.HTMLMediaElement;
  if (M && M.prototype) M.prototype.play = function () { const el = this; setTimeout(() => { try { el.dispatchEvent(new Event('ended')); } catch (e) {} }, 50); return Promise.resolve(); };
} catch (e) {} })();`;
export function quiet(browser) {
  const nc = browser.newContext.bind(browser), np = browser.newPage.bind(browser);
  browser.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(QUIET_INIT); return c; };
  browser.newPage = async (...a) => { const p = await np(...a); await p.addInitScript(QUIET_INIT); return p; };
  return browser;
}
