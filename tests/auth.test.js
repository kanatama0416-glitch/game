import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../js/auth.js';
import { createFakeSupabase } from './fake-supabase.js';

const users = { 'kana@example.com': { id: 'u1', password: 'pass1234' }, 'other@example.com': { id: 'u2', password: 'pass1234' } };

test('no library → no auth (app shows the entrance with an error)', () => {
  assert.equal(createAuth(undefined, 'u', 'k'), null);
});

test('password login, allowlist check, logout', async () => {
  const fake = createFakeSupabase({ users, allowed: ['kana@example.com'] });
  const auth = createAuth(fake.lib, 'u', 'k');
  await assert.rejects(auth.signIn('kana@example.com', 'wrong'));
  await auth.signIn('kana@example.com', 'pass1234');
  assert.equal((await auth.session()).user.id, 'u1');
  assert.equal(await auth.checkAccess(), true);
  await auth.signOut();
  assert.equal(await auth.session(), null);
  await auth.signIn('other@example.com', 'pass1234');
  assert.equal(await auth.checkAccess(), false);
});

test('first-time setup and password reset send links back to this page', async () => {
  const fake = createFakeSupabase({ allowed: ['kana@example.com'] });
  const auth = createAuth(fake.lib, 'u', 'k');
  await auth.signUp('kana@example.com', 'pass1234', 'https://x/game/');
  await auth.sendReset('kana@example.com', 'https://x/game/');
  assert.deepEqual(fake.state.sent.map(s => [s.kind, s.redirectTo]), [['signup', 'https://x/game/'], ['reset', 'https://x/game/']]);
});
