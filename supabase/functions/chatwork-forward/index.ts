// 発注先チャット → ChatWork 転送用Edge Function。
//
// 手寄の発注先チャットで、きよかわ側がメッセージを送ると呼ばれ、
// その発注先に設定されたChatWorkルームへ同じ内容を投稿する（片方向）。
//
// 認証：呼び出し元のJWTを検証し、社員（staff/carpenter）のみ実行可。
// ChatWork APIトークンは Secrets（CHATWORK_TOKEN）に設定しておく。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHATWORK_TOKEN = Deno.env.get("CHATWORK_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!CHATWORK_TOKEN) return json({ error: "ChatWork未設定" }); // 未設定なら黙って終了（転送しない）

    // 呼び出し元が社員か確認
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "認証が必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!(prof?.role === "staff" || prof?.role === "carpenter")) return json({ error: "権限がありません" }, 403);

    const { supplierId, senderName, text } = await req.json();
    if (!supplierId || !text) return json({ ok: true, skipped: "no-content" });

    // 発注先のChatWorkルームIDを取得（未設定なら転送しない）
    const { data: sup } = await admin.from("suppliers").select("chatwork_room_id").eq("id", supplierId).single();
    const roomId = (sup?.chatwork_room_id || "").trim();
    if (!roomId) return json({ ok: true, skipped: "no-room" });

    const body = `[info][title]手寄（きよかわ）${senderName ? "　" + senderName : ""}[/title]${text}[/info]`;
    const res = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      headers: { "X-ChatWorkToken": CHATWORK_TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ body }).toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ error: `ChatWork送信失敗(${res.status}): ${t}` }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
