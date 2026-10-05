// In-memory stand-in for the parts of supabase-js this app uses.
// It enforces the same rules as the real database: a request must come from a logged-in
// user whose email is on the allowlist, and can only touch rows whose user_id is their own.
const PK = {
  nyachimaru_shops: ['user_id'],
  nyachimaru_records: ['user_id', 'event_key'],
  nyachimaru_months: ['user_id', 'month'],
  nyachimaru_skips: ['user_id', 'event_key'],
};

export function createFakeDb() { return { nyachimaru_shops: [], nyachimaru_records: [], nyachimaru_months: [], nyachimaru_skips: [] }; }

// users: { email: { id, password } } — accounts that already exist (e.g. made in 家計簿).
export function createFakeSupabase({ db = createFakeDb(), session = null, fail = { count: 0 }, allowed = [], users = {} } = {}) {
  const listeners = [];
  const state = { session, sent: [], users: { ...users } };
  const emit = (event, s) => listeners.forEach(cb => cb(event, s));
  const isAllowed = () => !!state.session && allowed.includes(state.session.user.email.toLowerCase());

  function run(table, q) {
    if (fail.count > 0) { fail.count--; return { data: null, error: { message: 'network error' } }; }
    if (!state.session) return { data: null, error: { message: 'permission denied' } };
    const uid = state.session.user.id;
    const rows = db[table];
    const visible = r => isAllowed() && r.user_id === uid && q.filters.every(([c, v]) => r[c] === v);
    if (q.op === 'select') {
      const found = rows.filter(visible).map(r => ({ ...r }));
      return { data: q.single ? (found[0] || null) : found, error: null };
    }
    if (q.op === 'upsert') {
      const row = { ...q.row };
      if (!isAllowed() || row.user_id !== uid) return { data: null, error: { message: 'new row violates row-level security policy' } };
      const i = rows.findIndex(r => PK[table].every(c => r[c] === row[c]));
      if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push(row);
      return { data: null, error: null };
    }
    if (q.op === 'delete') {
      for (let i = rows.length - 1; i >= 0; i--) if (visible(rows[i])) rows.splice(i, 1);
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
    async rpc(name) {
      if (name !== 'nyachimaru_check_access') return { data: null, error: { message: 'unknown function' } };
      if (!state.session) return { data: null, error: { message: 'permission denied' } };
      return { data: isAllowed(), error: null };
    },
    auth: {
      async getSession() { return { data: { session: state.session }, error: null }; },
      async signInWithPassword({ email, password }) {
        const u = state.users[email.toLowerCase()];
        if (!u || u.password !== password) return { data: null, error: { message: 'Invalid login credentials' } };
        state.session = { user: { id: u.id, email: email.toLowerCase() } };
        emit('SIGNED_IN', state.session);
        return { data: { session: state.session }, error: null };
      },
      async signUp({ email, password, options }) {
        state.sent.push({ kind: 'signup', email, redirectTo: options && options.emailRedirectTo });
        state.users[email.toLowerCase()] = { id: 'new-' + email, password };
        return { data: { user: { email } }, error: null };
      },
      async resetPasswordForEmail(email, { redirectTo } = {}) { state.sent.push({ kind: 'reset', email, redirectTo }); return { data: {}, error: null }; },
      async updateUser({ password }) {
        if (!state.session) return { data: null, error: { message: 'not logged in' } };
        state.users[state.session.user.email].password = password;
        return { data: {}, error: null };
      },
      async signOut() { state.session = null; emit('SIGNED_OUT', null); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  return { client, db, state, fail, lib: { createClient: () => client } };
}
