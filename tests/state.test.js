import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as st from '../js/state.js';

test('normalize drops unknown and invalid data', () => {
  const S = st.normalize({
    name: 'x'.repeat(30), start: 'bad',
    done: { yago: { date: '2026-10-01', amount: -1, memo: 'm' }, nope: { date: '2026-10-01' }, kaigyo: { date: 'x' } },
    months: { '2026-13': { s: 1, e: 1 }, '2026-09': { s: 1.5, e: 3 } },
    skip: { ideco: true, nope: true },
  });
  assert.equal(S.name.length, 20);
  assert.equal(S.start, '');
  assert.deepEqual(S.done, { yago: { date: '2026-10-01', memo: 'm' } });
  assert.deepEqual(S.months, { '2026-09': { s: 0, e: 3 } });
  assert.deepEqual(S.skip, { ideco: true });
  assert.equal(st.normalize(null), null);
});

test('records for 屋号 and 開業日 also update the shop', () => {
  const S = st.emptyState();
  assert.deepEqual(st.applyRecord(S, 'yago', { date: '2026-10-01' }, { name: 'たま商店' }), [{ t: 'record', k: 'yago' }, { t: 'shop' }]);
  assert.equal(S.name, 'たま商店');
  st.applyRecord(S, 'opendate', { date: '2026-10-20' });
  assert.equal(S.start, '2026-10-20');
  st.removeRecord(S, 'opendate');
  assert.equal(S.start, '');
});

test('setShop moves the 開業日 record with it', () => {
  const S = st.emptyState(); st.applyRecord(S, 'opendate', { date: '2026-10-20' });
  const ops = st.setShop(S, 'a', '2026-11-01');
  assert.equal(S.done.opendate.date, '2026-11-01');
  assert.deepEqual(ops, [{ t: 'shop' }, { t: 'record', k: 'opendate' }]);
});

test('editing sample data makes it the user\'s', () => {
  const S = st.emptyState(); S.sample = true;
  st.setMonth(S, '2026-10', { s: 1, e: 0 });
  assert.equal(S.sample, false);
});

test('syncAuto adds and removes milestones', () => {
  const S = st.emptyState();
  st.setMonth(S, '2026-09', { s: 120000, e: 0 });
  const a = st.syncAuto(S, '2026-10-06');
  assert.deepEqual(a.added, ['sales10']);
  assert.equal(S.done.sales10.date, '2026-09-30');
  st.setMonth(S, '2026-09', { s: 1000, e: 0 });
  const b = st.syncAuto(S, '2026-10-06');
  assert.equal(S.done.sales10, undefined);
  assert.deepEqual(b.ops, [{ t: 'record', k: 'sales10' }]);
});

test('hasUserData ignores the sample', () => {
  const S = st.emptyState(); assert.equal(st.hasUserData(S), false);
  S.name = 'a'; assert.equal(st.hasUserData(S), true);
  S.sample = true; assert.equal(st.hasUserData(S), false);
});
