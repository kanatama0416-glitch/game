// にゃちまる商店 uses the same Supabase project as 家計簿 (kakeibo), so one login works for both.
// The publishable key is meant to be in the browser; row level security protects the data.
// Never put a secret / service_role key in this repository.
export const SUPABASE_URL = 'https://vcokmkljwxuyiytiqtlc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Ww13dYot4RnKABa3HKUDkQ_50tLWmqa';
// Records kept on this device by the earlier version (offered for import on first login).
export const LOCAL_KEY = 'hitori-shoten-v1';
