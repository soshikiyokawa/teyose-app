// Supabase接続設定（URL・anonキーはクライアントに公開しても問題ない値です。
// 実際のアクセス制御はSupabase側のRLS（行レベルセキュリティ）で行います）
const SUPABASE_URL = 'https://uotzxrwtzlpdnpfbaqpi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QLOuqgWRoBwoZU6cJnra7g_I4_uRb6k';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
