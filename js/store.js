// Storage. Both stores have the same interface:
//   load()           → state (or null when nothing is saved)
//   apply(S, ops)    → saves what the ops point at (throws on failure)
// Only this file talks to localStorage or Supabase.
import { emptyState, normalize } from './state.js';

// ---------- this device only ----------
export function createLocalStore(storage, key) {
  return {
    kind: 'local',
    load() {
      try { const raw = storage.getItem(key); return raw ? normalize(JSON.parse(raw)) : null; }
      catch { return null; }
    },
    async apply(S) {
      // Saves the whole state; ops are not needed for a single snapshot.
      try { storage.setItem(key, JSON.stringify(S)); }
      catch { throw new Error('この端末に保存できませんでした。'); }
    },
    clear() { try { storage.removeItem(key); } catch { /* storage unavailable */ } },
  };
}

// ---------- Supabase (logged in) ----------
// `client` is a Supabase client; `userId` the logged-in user's id. Row level security
// on every table limits reads and writes to that user's own rows.
export function createRemoteStore(client, userId) {
  const check = ({ error }) => { if (error) throw new Error(error.message || 'save failed'); };

  async function load() {
    const [shop, records, months, skips] = await Promise.all([
      client.from('shops').select('name,start_date').eq('user_id', userId).maybeSingle(),
      client.from('records').select('event_key,date,amount,memo').eq('user_id', userId),
      client.from('months').select('month,sales,expenses').eq('user_id', userId),
      client.from('skips').select('event_key').eq('user_id', userId),
    ]);
    for (const r of [shop, records, months, skips]) check(r);
    const raw = emptyState();
    if (shop.data) { raw.name = shop.data.name || ''; raw.start = shop.data.start_date || ''; }
    for (const r of records.data) raw.done[r.event_key] = { date: r.date, amount: r.amount ?? undefined, memo: r.memo ?? undefined };
    for (const r of months.data) raw.months[r.month] = { s: Number(r.sales), e: Number(r.expenses) };
    for (const r of skips.data) raw.skip[r.event_key] = true;
    return normalize(raw);
  }

  async function applyOne(S, op) {
    const now = new Date().toISOString();
    if (op.t === 'shop') {
      return check(await client.from('shops').upsert({ user_id: userId, name: S.name, start_date: S.start || null, updated_at: now }));
    }
    if (op.t === 'record') {
      const rec = S.done[op.k];
      if (!rec) return check(await client.from('records').delete().eq('user_id', userId).eq('event_key', op.k));
      return check(await client.from('records').upsert({
        user_id: userId, event_key: op.k, date: rec.date,
        amount: rec.amount ?? null, memo: rec.memo ?? null, updated_at: now,
      }));
    }
    if (op.t === 'month') {
      const v = S.months[op.m];
      if (!v) return check(await client.from('months').delete().eq('user_id', userId).eq('month', op.m));
      return check(await client.from('months').upsert({ user_id: userId, month: op.m, sales: v.s, expenses: v.e, updated_at: now }));
    }
    if (op.t === 'skip') {
      if (!S.skip[op.k]) return check(await client.from('skips').delete().eq('user_id', userId).eq('event_key', op.k));
      return check(await client.from('skips').upsert({ user_id: userId, event_key: op.k }));
    }
    if (op.t === 'reset') {
      for (const table of ['records', 'months', 'skips', 'shops']) check(await client.from(table).delete().eq('user_id', userId));
      return;
    }
    throw new Error('unknown op ' + op.t);
  }

  return {
    kind: 'remote',
    load,
    async apply(S, ops) { for (const op of ops) await applyOne(S, op); },
  };
}
