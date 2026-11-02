// Client-facing wording built from the firm's mapped pipeline names (config.pipelines).
// Used by app/dashboard.html and tests/wording/run.mjs. No DOM, no Node APIs.

// "01. Sales Pipeline" -> "Sales Pipeline": drop a leading list number GHL users add for ordering.
const clean = n => String(n ?? '').trim().replace(/^\d+\s*[.)\-:]\s*/, '').trim();
const bare = n => n.replace(/\s+pipeline$/i, '');            // "Sales Pipeline" -> "Sales"
const one = n => (/\bpipeline$/i.test(n) ? n : `${n} pipeline`);
const and = list => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

// sub:   the line under the New leads number
// your:  "your Lead Stages pipeline" (for sentences)
// these: "this pipeline" / "these pipelines" / "a pipeline"
// hover: the New leads definition, also used in the funnel row and "How this works"
export function pipelineWording(pipelines) {
  // Case doesn't matter when the sync matches pipeline names, so it doesn't here either.
  const seen = new Set();
  const names = (pipelines || []).map(clean).filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  let your, these, sub;
  if (!names.length) { your = 'any of your pipelines'; these = 'a pipeline'; sub = 'From all your pipelines'; }
  else if (names.length === 1) { your = `your ${one(names[0])}`; these = 'this pipeline'; sub = `From ${your}`; }
  else { your = `your ${and(names.map(bare))} pipelines`; these = 'these pipelines'; sub = names.length === 2 ? `From ${your}` : `From ${names.length} pipelines`; }
  const notCounted = `Someone who called, texted or filled in a form but was never added to ${these} isn't counted here.`;
  return {
    names, your, these, sub, notCounted,
    hover: `Leads added to ${your} during the selected dates. ${notCounted}`,
    leadToSigned: `Of the leads added to ${your} during the selected dates, the share that signed. ${notCounted}`,
  };
}
