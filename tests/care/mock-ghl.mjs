// A GoHighLevel API stand-in for tests/care: serves the pipelines, opportunities, contacts and calendar events it's
// given (no messages), and records every path requested (so a test can prove which calls the sync made).
//
//   const mock = await startMock({ pipelines, opps, contacts: { id: { firstName, … } }, events: [{ contactId, appointmentStatus, startTime }] });
//   … run scripts/sync.mjs with GHL_API_BASE=mock.url …   mock.paths → ['/opportunities/pipelines', …]
//   mock.set({ pipelines }) changes what's served (e.g. a stage renamed or added in GHL).
import http from 'node:http';

export function startMock(data) {
  const state = { ...data }, paths = [];
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), path = url.pathname;
    paths.push(path);
    if (path === '/opportunities/pipelines') return json(res, { pipelines: state.pipelines || [] });
    if (path === '/opportunities/search') {
      const page = Number(url.searchParams.get('page') || 1), all = state.opps || [];
      return json(res, { opportunities: all.slice((page - 1) * 100, page * 100), meta: {} });
    }
    if (path === '/contacts/search' && req.method === 'POST') { req.resume(); req.on('end', () => json(res, { contacts: [], total: 0 })); return; }
    if (path.startsWith('/contacts/')) {
      const id = path.split('/')[2], c = (state.contacts || {})[id] || { firstName: 'Person', lastName: id };
      return json(res, { contact: { id, tags: [], source: 'Web form', ...c } });
    }
    if (path === '/users/') return json(res, { users: [] });
    if (/^\/locations\/[^/]+\/customFields$/.test(path)) return json(res, { customFields: [] });
    if (path.startsWith('/locations/')) return json(res, { location: { id: 'mock', name: 'Mock' } });
    if (path === '/calendars/') return json(res, { calendars: (state.events || []).length ? [{ id: 'cal1', name: 'Consultation', isActive: true }] : [] });
    if (path === '/calendars/events') return json(res, { events: (state.events || []).map((e, i) => ({ id: `ev${i}`, calendarId: 'cal1', dateAdded: e.startTime, ...e })) });
    if (path === '/conversations/search') return json(res, { conversations: [] });
    if (path === '/conversations/messages/export') return json(res, { messages: [] });
    return json(res, { message: 'not mocked' }, 404);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}`, paths, set: d => Object.assign(state, d), close: () => new Promise(r => server.close(r)) });
  }));
}
