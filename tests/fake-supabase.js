// In-memory stand-in for the parts of supabase-js this app uses.
// It enforces the same rule as the real row level security: a logged-in user can only
// read and write rows whose user_id is their own; logged-out requests are refused.
const PK = { shops: ['user_id'], records: ['user_id', 'event_key'], months: ['user_id', 'month'], skips: ['user_id', 'event_key'] };

export function createFakeDb() { return { shops: [], records: [], months: [], skips: [] }; }

export function createFakeSupabase({ db = createFakeDb(), session = null, fail = { count: 0 } } = {}) {
  const listeners = [];
  const state = { session, sentLinks: [] };

  function run(table, q) {
    if (fail.count > 0) { fail.count--; return { data: null, error: { message: 'network error' } }; }
    const uid = state.session && state.session.user.id;
    if (!uid) return { data: null, error: { message: 'permission denied' } };
    const rows = db[table];
    const match = r => r.user_id === uid && q.filters.every(([c, v]) => r[c] === v);
    if (q.op === 'select') {
      const found = rows.filter(match).map(r => ({ ...r }));
      return { data: q.single ? (found[0] || null) : found, error: null };
    }
    if (q.op === 'upsert') {
      const row = { ...q.row };
      if (row.user_id !== uid) return { data: null, error: { message: 'new row violates row-level security policy' } };
      const i = rows.findIndex(r => PK[table].every(c => r[c] === row[c]));
      if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push(row);
      return { data: null, error: null };
    }
    if (q.op === 'delete') {
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'unsupported' } };
  }

  function from(table) {
    const q = { op: 'select', filters: [], single: false, row: null };
    const api = {
      select() { return api; },
      eq(c, v) { q.filters.push([c, v]); return api; },
      maybeSingle() { q.single = true; return api; },
      upsert(row) { q.op = 'upsert'; q.row = row; return api; },
      delete() { q.op = 'delete'; return api; },
      then(res, rej) { return Promise.resolve(run(table, q)).then(res, rej); },
    };
    return api;
  }

  const client = {
    from,
    auth: {
      async getSession() { return { data: { session: state.session }, error: null }; },
      async signInWithOtp({ email, options }) { state.sentLinks.push({ email, redirectTo: options && options.emailRedirectTo }); return { error: null }; },
      async signOut() { state.session = null; listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  return { client, db, state, fail, lib: { createClient: () => client } };
}
