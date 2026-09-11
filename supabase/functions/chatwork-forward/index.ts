// 発注先チャット → ChatWork 転送用Edge Function。
//
// 手寄の発注先チャットで、きよかわ側がメッセージを送ると呼ばれ、
// その発注先に設定されたChatWorkルームへ同じ内容を投稿する。
// 写真・資料・発注書PDFは、ファイルそのものを添えて送る（5MBまで）。
//
// 認証：呼び出し元のJWTを検証し、社員（staff/carpenter）のみ実行可。
// ChatWork APIトークンは Secrets（CHATWORK_TOKEN）に設定しておく。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHATWORK_TOKEN = Deno.env.get("CHATWORK_TOKEN") ?? "";

// ChatWorkの添付は5MBまで（APIの決まり）。超えるものはリンクで知らせる
const CHATWORK_FILE_MAX = 5 * 1024 * 1024;

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

    const { supplierId, senderName, text, fileUrl, fileName } = await req.json();
    if (!supplierId || (!text && !fileUrl)) return json({ ok: true, skipped: "no-content" });

    // 発注先のChatWorkルームIDを取得（未設定なら転送しない）
    const { data: sup } = await admin.from("suppliers").select("chatwork_room_id").eq("id", supplierId).single();
    const roomId = (sup?.chatwork_room_id || "").trim();
    if (!roomId) return json({ ok: true, skipped: "no-room" });

    // 取り込み側（chatwork-webhook）が「自分が転送した分」と見分けるための見出し。
    // この文字を変えるときは webhook 側のループ防止も合わせて直す
    const title = `手寄（きよかわ）${senderName ? "　" + senderName : ""}`;
    const wrap = (s: string) => `[info][title]${title}[/title]${s}[/info]`;
    const caption = text || `📎 ${fileName || "ファイル"}`;

    // ファイルつき：ファイルそのものを添えて送る
    if (fileUrl) {
      const sent = await sendFile(roomId, fileUrl, fileName, wrap(caption));
      if (sent.ok) return json({ ok: true, attached: true });
      // 添えられなかったときは、せめてリンクで届ける（ここで止めない）
      const r = await sendText(roomId, wrap(`${caption}\n${sent.note}\n${fileUrl}`));
      if (!r.ok) return json({ error: r.note }, 502);
      return json({ ok: true, attached: false, note: sent.note });
    }

    const r = await sendText(roomId, wrap(caption));
    if (!r.ok) return json({ error: r.note }, 502);
    return json({ ok: true, attached: false });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

// 文字だけの投稿
async function sendText(roomId: string, body: string): Promise<{ ok: boolean; note: string }> {
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    headers: { "X-ChatWorkToken": CHATWORK_TOKEN, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body }).toString(),
  });
  if (res.ok) return { ok: true, note: "" };
  return { ok: false, note: `ChatWork送信失敗(${res.status}): ${(await res.text()).slice(0, 300)}` };
}

// ファイルを添えて投稿。Storageから取り直してChatWorkへ送り直す
async function sendFile(roomId: string, url: string, name: string, message: string): Promise<{ ok: boolean; note: string }> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, note: `ファイルを取り出せませんでした(${res.status})` };
    blob = await res.blob();
  } catch (e) {
    return { ok: false, note: `ファイルを取り出せませんでした（${String((e as any)?.message || e)}）` };
  }
  if (blob.size > CHATWORK_FILE_MAX) {
    return { ok: false, note: "（5MBを超えるため、リンクでお送りします）" };
  }

  const fd = new FormData();
  // Content-Type は指定しない（区切り記号をfetchに付けさせるため）
  fd.append("file", blob, name || "file");
  fd.append("message", message);
  const up = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/files`, {
    method: "POST",
    headers: { "X-ChatWorkToken": CHATWORK_TOKEN },
    body: fd,
  });
  if (up.ok) return { ok: true, note: "" };
  return { ok: false, note: `（添付できませんでした：${up.status}）` };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
