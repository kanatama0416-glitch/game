// Login with an email link (Supabase Auth). Returns null when the Supabase library
// could not load (offline, blocked CDN); the app then keeps working on this device only.
export function createAuth(lib, url, key) {
  if (!lib || typeof lib.createClient !== 'function') return null;
  const client = lib.createClient(url, key);
  return {
    client,
    async session() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session;
    },
    async sendLink(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    onChange(cb) { client.auth.onAuthStateChange((event, session) => cb(event, session)); },
  };
}
