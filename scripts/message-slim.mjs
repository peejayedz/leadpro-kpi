// What scripts/sync.mjs keeps of each message from GHL's conversation-message export: only the fields the KPIs read
// (toLog in sync.mjs, the diagnostics tally, a call's assigned user). Bodies, subjects, recipients and attachments are
// dropped as each page arrives.
// Why: LFMP's Email channel returns ~6,300 mostly outbound campaign emails with full HTML bodies per pull. Keeping 2–3
// full pulls of every channel ran Node out of memory (2 GB heap, "JavaScript heap out of memory", 5 times on 15–16 Nov 2026).
// A text's opt-out check ("STOP") needs the body, so it is worked out here and kept as optOut.

export const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]?\s*$/i;

export function slimMessage(m) {
  const call = m.meta?.call;
  return {
    id: m.id, dateAdded: m.dateAdded, contactId: m.contactId, direction: m.direction, status: m.status, userId: m.userId,
    duration: m.duration,
    meta: { duration: m.meta?.duration, call: call ? { duration: call.duration, status: call.status } : undefined },
    optOut: OPT_OUT.test(String(m.body ?? m.message ?? '')),
  };
}
