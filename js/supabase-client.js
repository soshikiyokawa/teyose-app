// Supabase接続設定（URL・anonキーはクライアントに公開しても問題ない値です。
// 実際のアクセス制御はSupabase側のRLS（行レベルセキュリティ）で行います）
const SUPABASE_URL = 'https://uotzxrwtzlpdnpfbaqpi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QLOuqgWRoBwoZU6cJnra7g_I4_uRb6k';

// 招待メール・パスワード再設定のリンクから開かれたか（supabase-jsがURLハッシュを消す前に判定を保持）
const APP_NEEDS_PASSWORD_SETUP = /type=(invite|recovery)/.test(location.hash);
// そのリンクの期限が切れていた／すでに使われていた場合（何も出ないと理由が分からないため）
const APP_LINK_EXPIRED = /error_code=otp_expired|error=access_denied/.test(location.hash);

// ログイン状態を端末に保存し、トークンを自動更新する（毎回のログインを不要にする）
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // ログイン状態を端末に保存（既定の保存キーのまま）
    autoRefreshToken: true,    // 期限切れ前にトークンを自動更新
    detectSessionInUrl: true
  }
});

// 最終利用日時を記録し、一定期間（7日）開かなければ再ログインを求める
const APP_IDLE_LIMIT_DAYS = 7;
const APP_LAST_SEEN_KEY = 'teyose-last-seen';
function appTouchLastSeen(){ try{ localStorage.setItem(APP_LAST_SEEN_KEY, String(Date.now())); }catch(_){} }
function appIdleTooLong(){
  try{
    const last = Number(localStorage.getItem(APP_LAST_SEEN_KEY) || 0);
    if(!last) return false;   // 記録が無い場合（初回・更新直後）はログイン維持
    return (Date.now() - last) > APP_IDLE_LIMIT_DAYS * 86400000;
  }catch(_){ return false; }
}
