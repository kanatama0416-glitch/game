import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteStore, createLocalStore } from '../js/store.js';
import * as st from '../js/state.js';
import { createFakeSupabase, createFakeDb } from './fake-supabase.js';

const session = id => ({ user: { id, email: id + '@example.com' } });
const allowed = ['u1@example.com', 'u2@example.com'];

test('remote store saves every kind of change and loads it back', async () => {
  const fake = createFakeSupabase({ session: session('u1'), allowed });
  const store = createRemoteStore(fake.client, 'u1');
  const S = st.emptyState();
  await store.apply(S, st.applyRecord(S, 'yago', { date: '2026-10-01', memo: 'メモ' }, { name: 'たま商店' }));
  await store.apply(S, st.applyRecord(S, 'invoice', { date: '2026-10-02', amount: 50000 }));
  await store.apply(S, st.setMonth(S, '2026-10', { s: 120000, e: 3000 }));
  await store.apply(S, st.syncAuto(S, '2026-10-06').ops);
  await store.apply(S, st.skipEvent(S, 'ideco'));
  const loaded = await store.load();
  assert.deepEqual(loaded, S);
});

test('remote store deletes', async () => {
  const fake = createFakeSupabase({ session: session('u1'), allowed });
  const store = createRemoteStore(fake.client, 'u1');
  const S = st.emptyState();
  await store.apply(S, [...st.applyRecord(S, 'opendate', { date: '2026-10-20' }), ...st.setMonth(S, '2026-10', { s: 1, e: 0 }), ...st.skipEvent(S, 'ideco')]);
  await store.apply(S, [...st.removeRecord(S, 'opendate'), ...st.removeMonth(S, '2026-10'), ...st.unskipEvent(S, 'ideco')]);
  assert.deepEqual(await store.load(), st.emptyState());
  await store.apply(S, st.setMonth(S, '2026-11', { s: 1, e: 0 }));
  await store.apply(S, st.resetAll(S));
  assert.deepEqual(fake.db, createFakeDb());
});

test('another user cannot see or overwrite my rows', async () => {
  const db = createFakeDb();
  const mine = createRemoteStore(createFakeSupabase({ db, session: session('u1'), allowed }).client, 'u1');
  const S = st.emptyState();
  await mine.apply(S, st.applyRecord(S, 'yago', { date: '2026-10-01' }, { name: '私の店' }));
  const otherClient = createFakeSupabase({ db, session: session('u2'), allowed }).client;
  const theirView = await createRemoteStore(otherClient, 'u2').load();
  assert.deepEqual(theirView, st.emptyState());
  // Pretending to be u1 while logged in as u2 is refused.
  await assert.rejects(createRemoteStore(otherClient, 'u1').apply(S, [{ t: 'shop' }]));
  assert.equal(db.nyachimaru_shops[0].name, '私の店');
});

test('remote errors are thrown so the screen can report them', async () => {
  const fake = createFakeSupabase({ session: session('u1'), fail: { count: 1 }, allowed });
  const store = createRemoteStore(fake.client, 'u1');
  const S = st.emptyState();
  await assert.rejects(store.apply(S, st.setMonth(S, '2026-10', { s: 1, e: 0 })), /network/);
  await assert.rejects(createRemoteStore(createFakeSupabase({ fail: { count: 0 } }).client, 'u1').load(), /permission/);
});

test('local store round-trips and survives broken data', async () => {
  const m = new Map(); const storage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  const store = createLocalStore(storage, 'k');
  assert.equal(store.load(), null);
  const S = st.emptyState(); st.setMonth(S, '2026-10', { s: 5, e: 1 });
  await store.apply(S);
  assert.deepEqual(store.load(), S);
  m.set('k', '{broken');
  assert.equal(store.load(), null);
  // Data saved before "skip" existed still loads.
  m.set('k', JSON.stringify({ sample: false, name: '旧', start: '', done: {}, months: {} }));
  assert.equal(store.load().name, '旧');
});

test('a logged-in user who is not on the allowlist sees and saves nothing', async () => {
  const db = createFakeDb();
  const outsider = createRemoteStore(createFakeSupabase({ db, session: session('x'), allowed }).client, 'x');
  const S = st.emptyState();
  await assert.rejects(outsider.apply(S, st.setMonth(S, '2026-10', { s: 1, e: 0 })), /row-level security/);
  assert.deepEqual(await outsider.load(), st.emptyState());
});
