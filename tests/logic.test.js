import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, daysSince, dayLabel, headerDays, deadlineOf, dueText, dueClass, pendingEvents, curChapter, evalAuto, parseYen, monthEnd } from '../js/logic.js';
import { emptyState } from '../js/state.js';

const withQuit = (quit, start = '') => { const S = emptyState(); S.done.taishoku = { date: quit }; S.start = start; return S; };

test('addMonths clamps to month end', () => {
  assert.equal(addMonths('2026-12-31', 2), '2027-02-28');
  assert.equal(addMonths('2026-10-20', 1), '2026-11-20');
});

test('daysSince counts the first day as day 1', () => {
  assert.equal(daysSince('2026-10-01', '2026-10-01'), 1);
  assert.equal(daysSince('2026-10-01', '2026-10-06'), 6);
  assert.equal(daysSince('', '2026-10-06'), null);
});

test('dayLabel: 準備N日目 from leaving, 開業N日目 from opening', () => {
  const S = withQuit('2026-08-15', '2026-09-02');
  assert.equal(dayLabel(S, '2026-08-20'), '準備6日目');
  assert.equal(dayLabel(S, '2026-09-02'), '開業1日目');
  assert.equal(dayLabel(emptyState(), '2026-09-02'), '');
});

test('headerDays shows both counters during preparation', () => {
  const S = withQuit('2026-10-01', '2026-10-20');
  assert.equal(headerDays(S, '2026-10-06'), '準備 <b>6</b> 日目<span class="until">開業まで あと <b>14</b> 日</span>');
  assert.equal(headerDays(emptyState(), '2026-10-06'), '会社を辞めた日から、準備期を数えはじめます');
});

test('deadlines', () => {
  const S = withQuit('2026-09-30', '2026-10-20');
  const t = '2026-10-06';
  assert.equal(deadlineOf(S, 'nenkin', t).date, '2026-10-14');
  assert.equal(deadlineOf(S, 'nenkin', t).left, 8);
  assert.equal(deadlineOf(S, 'kenpo', t).date, '2026-10-14');
  assert.equal(deadlineOf(S, 'kenzei', t).date, '2026-11-20');
  assert.equal(deadlineOf(S, 'aoiro', t).date, '2026-12-20');
  assert.equal(deadlineOf(S, 'kaigyo', t).date, '2027-03-15');
  assert.equal(deadlineOf(S, 'yago', t), null);
  S.start = '2026-01-10';
  assert.equal(deadlineOf(S, 'aoiro', t).date, '2026-03-15');
});

test('deadline text and urgency', () => {
  assert.equal(dueText(deadlineOf(emptyState(), 'kenzei', '2026-10-06')), '開業日を記録すると期限がわかります');
  assert.equal(dueText({ date: '2026-10-15', left: 9 }), '期限 2026.10.15・あと9日');
  assert.equal(dueText({ date: '2026-10-06', left: 0 }), '期限 2026.10.06・今日まで');
  assert.equal(dueText({ date: '2026-10-01', left: -5 }), '期限 2026.10.01（過ぎています）');
  assert.equal(dueClass({ left: 7 }), 'due urgent');
  assert.equal(dueClass({ left: 8 }), 'due');
});

test('pending events skip done and 関係ない, chapter follows the first pending', () => {
  const S = emptyState();
  assert.equal(pendingEvents(S)[0].k, 'taishoku');
  for (const e of pendingEvents(S).filter(e => e.ch === 0)) if (e.opt) S.skip[e.k] = true; else S.done[e.k] = { date: '2026-10-01' };
  assert.equal(curChapter(S), 1);
});

test('automatic milestones', () => {
  assert.deepEqual(evalAuto({ '2026-09': { s: 80000, e: 0 }, '2026-10': { s: 30000, e: 0 } }), { sales10: '2026-10' });
  assert.equal(evalAuto({ a: 1, '2026-01': { s: 1, e: 0 }, '2026-02': { s: 1, e: 0 }, '2026-03': { s: 1, e: 0 } }).black3 !== undefined, true);
  assert.equal(monthEnd('2026-10', '2026-10-06'), '2026-10-06');
  assert.equal(monthEnd('2026-09', '2026-10-06'), '2026-09-30');
});

test('parseYen accepts only non-negative integers', () => {
  assert.equal(parseYen(''), 0);
  assert.equal(parseYen('', { optional: true }), null);
  assert.equal(parseYen('50000'), 50000);
  assert.ok(Number.isNaN(parseYen('-5')));
  assert.ok(Number.isNaN(parseYen('1.5')));
  assert.ok(Number.isNaN(parseYen('abc')));
});
