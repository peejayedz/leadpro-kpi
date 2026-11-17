// "Builder needs attention" DM for a KPI dashboard setup that failed or stopped (v1.22.0).
// Run by the last job of .github/workflows/new-firm.yml, only when an earlier job failed, timed out or was cancelled.
// One DM per failed run. Never fails the run because of Slack. Never prints the webhook.
//
// The steps and messages are the Builder page's (ghl-subaccount-builder page/kpi.js KPI_STEPS, JOB_STEP, STEP_ERRORS),
// so "step 7 of 9" here is the step the Builder shows as failed. tests/alerts/run.mjs checks the copies still match.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { postSlack, slackEscape, slackLink } from './slack.mjs';

export const BUILDER_URL = 'https://lfmp-admin.pages.dev/ghl-subaccount-builder-page/';
export const KPI_STEPS = [
  ['check', 'Checking the KPI firm list'],
  ['pass', 'Making the dashboard passphrase'],
  ['start', 'Starting the setup on GitHub'],
  ['app', 'Waiting for the LeadPro Connector app'],
  ['token', 'Getting the firm\'s GHL token'],
  ['setup', 'Reading GHL and setting up the dashboard'],
  ['sync', 'First sync'],
  ['menu', 'GHL menu link'],
  ['save', 'Saving the KPI link on the record'],
];
export const JOB_STEP = { prepare: 'app', token: 'token', setup: 'setup', 'first-sync': 'sync', 'menu-link': 'menu' };

// The failed step, from the run's jobs (the Builder's errorFor()).
export function failedStep(jobs) {
  const job = (jobs || []).find(j => j.conclusion === 'failure' || j.conclusion === 'cancelled' || j.conclusion === 'timed_out');
  if (!job) return null;
  return { step: JOB_STEP[job.name] || 'start', cancelled: job.conclusion === 'cancelled' };
}

export function setupFailedText({ name, location, jobs }) {
  const f = failedStep(jobs);
  const i = f ? KPI_STEPS.findIndex(([k]) => k === f.step) : -1;
  const where = i >= 0 ? ` at step ${i + 1} of ${KPI_STEPS.length} (${KPI_STEPS[i][1]})` : '';
  const url = /^[A-Za-z0-9]{10,40}$/.test(location || '') ? `${BUILDER_URL}?client=${location}` : BUILDER_URL;
  return [
    `:warning: *Builder needs you: ${slackEscape(name || 'a new client')}*`,
    `KPI dashboard setup ${f?.cancelled ? 'was stopped by GitHub' : 'failed'}${where}.`,
    'Nothing is lost — Retry in the Builder.',
    slackLink(url, `Open ${name || 'the client'} in the Builder →`),
  ].join('\n');
}

async function main() {
  let jobs = [];
  try {
    const r = await fetch(`${process.env.GITHUB_API || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/jobs?per_page=50`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
    if (r.ok) jobs = (await r.json()).jobs || []; else console.log(`Couldn't read this run's jobs (HTTP ${r.status}); the DM won't name the step.`);
  } catch { console.log('Couldn\'t read this run\'s jobs; the DM won\'t name the step.'); }
  await postSlack(setupFailedText({ name: process.env.NF_NAME, location: process.env.NF_LOCATION, jobs }));
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) {
  main().catch(e => console.log(`::warning::Setup alert not sent: ${e.message}`));
}
