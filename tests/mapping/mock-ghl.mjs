// A tiny GoHighLevel API stand-in for tests. Serves a firm's pipelines and puts ONE open lead
// in every stage of every pipeline (created 3 days ago), with no calls, messages or calendars.
// Everything else the sync asks for comes back empty.
//
//   import { startMockGhl } from './mock-ghl.mjs';
//   const mock = await startMockGhl({ pipelines: [{ id, name, stages: [{ id, name }] }] }, 0);
//   … run scripts/sync.mjs with GHL_API_BASE=mock.url …
//   await mock.close();

import http from 'node:http';

export function leadsFor(fixture, now = Date.now()) {
  const createdAt = new Date(now - 3 * 864e5).toISOString();
  const leads = [];
  for (const p of fixture.pipelines || []) for (const s of p.stages || []) {
    const n = leads.length + 1;
    leads.push({ id: `opp${n}`, contactId: `c${n}`, name: `Lead ${n}`, pipelineId: p.id, pipelineStageId: s.id, status: 'open',
      createdAt, updatedAt: createdAt, lastStageChangeAt: createdAt, monetaryValue: 0, source: 'Web form', _pipeline: p.name, _stage: s.name });
  }
  return leads;
}

export function startMockGhl(fixture, port = 0) {
  const leads = leadsFor(fixture);
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), path = url.pathname;
    if (path === '/opportunities/pipelines') return json(res, { pipelines: fixture.pipelines || [] });
    if (path === '/opportunities/search') return json(res, { opportunities: url.searchParams.get('page') && url.searchParams.get('page') !== '1' ? [] : leads.map(({ _pipeline, _stage, ...o }) => o), meta: {} });
    if (path.startsWith('/contacts/')) { const id = path.split('/')[2]; return json(res, { contact: { id, firstName: 'Lead', lastName: id, tags: [], source: 'Web form' } }); }
    if (path === '/users/') return json(res, { users: [] });
    if (/^\/locations\/[^/]+\/customFields$/.test(path)) return json(res, { customFields: [] });
    if (path.startsWith('/locations/')) return json(res, { location: { id: 'mock' } });
    if (path === '/calendars/') return json(res, { calendars: [] });
    if (path === '/calendars/events') return json(res, { events: [] });
    if (path === '/conversations/search') return json(res, { conversations: [] });
    if (path === '/conversations/messages/export') return json(res, { messages: [] });
    return json(res, { message: 'not mocked' }, 404);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const { port: p } = server.address();
    resolve({ url: `http://127.0.0.1:${p}`, leads, close: () => new Promise(r => server.close(r)) });
  }));
}
