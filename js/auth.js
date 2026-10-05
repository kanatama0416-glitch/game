// Login with email + password (Supabase Auth), the same way 家計簿 does.
// Returns null when the Supabase library could not load (offline, blocked CDN).
export function createAuth(lib, url, key) {
  if (!lib || typeof lib.createClient !== 'function') return null;
  const client = lib.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  return {
    client,
    async session() { return ok(await client.auth.getSession()).session; },
    async signIn(email, password) { return ok(await client.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, redirectTo) { return ok(await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })); },
    async sendReset(email, redirectTo) { return ok(await client.auth.resetPasswordForEmail(email, { redirectTo })); },
    async updatePassword(password) { return ok(await client.auth.updateUser({ password })); },
    async signOut() { ok(await client.auth.signOut()); },
    // Whether the logged-in email is on にゃちまる商店's allowlist (checked in the database).
    async checkAccess() { return ok(await client.rpc('nyachimaru_check_access')) === true; },
    onChange(cb) { client.auth.onAuthStateChange((event, session) => cb(event, session)); },
  };
}
