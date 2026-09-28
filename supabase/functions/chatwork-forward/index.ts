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

    const { supplierId, senderName, text, fileUrl, fileName, fileNameAscii } = await req.json();
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
      const sent = await sendFile(roomId, fileUrl, fileName, wrap(caption), fileNameAscii);
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
async function sendFile(roomId: string, url: string, name: string, message: string, asciiHint?: string): Promise<{ ok: boolean; note: string }> {
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

  // ファイル名は、まず英数字だけの名前で送る。
  // ChatWorkは日本語のファイル名を断ることがあるため、そちらを本命にして、
  // だめだったときに元の名前でもう一度試す
  // 呼び出し側が分かりやすい英数字の名前をくれていれば、それを使う
  const ascii = asciiName(asciiHint || name);
  const first = await uploadTo(roomId, blob, ascii, message);
  if (first.ok) return { ok: true, note: "" };
  if (name && name !== ascii) {
    const second = await uploadTo(roomId, blob, name, message);
    if (second.ok) return { ok: true, note: "" };
    return { ok: false, note: `（添付できませんでした：${first.status} ${first.body} ／ 元の名前でも ${second.status} ${second.body}）` };
  }
  return { ok: false, note: `（添付できませんでした：${first.status} ${first.body}）` };
}

// multipart/form-data で送る。
//
// 組み立ては FormData に任せ、いったん Request に入れて「かたまり」に変える。
// こうすると境界文字・改行・長さの扱いを自分で書かずに済み、
// 送信の長さが決まらない形（chunked。ChatWorkに断られる）にもならない。
//
// 並びは curl の例（-F file=… -F message=…）に合わせて、ファイルを先にする。
async function uploadTo(roomId: string, blob: Blob, name: string, message: string) {
  const fd = new FormData();
  fd.append("file", new File([blob], name.replace(/"/g, ""), { type: blob.type || "application/pdf" }));
  fd.append("message", message);

  const packed = new Request("https://api.chatwork.com/", { method: "POST", body: fd });
  const contentType = packed.headers.get("content-type") || "";
  const body = new Uint8Array(await packed.arrayBuffer());

  const up = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/files`, {
    method: "POST",
    headers: { "X-ChatWorkToken": CHATWORK_TOKEN, "Content-Type": contentType },
    body,
  });
  const why = up.ok ? "" : (await up.text()).slice(0, 160).replace(/\s+/g, " ");
  return { ok: up.ok, status: up.status, body: why, name };
}

// 日本語を含まない名前にする（拡張子は残す）
function asciiName(name: string): string {
  const s = String(name || "");
  const ext = (s.match(/\.[A-Za-z0-9]+$/) || [""])[0] || "";
  const stem = s.slice(0, s.length - ext.length).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return (stem || "file") + (ext || "");
}

// ダッシュボードの Logs で追えるように、1件ごとに結果を1行残す。
// 呼び出し側（db.js）は転送の失敗を画面に出さないため、ここが唯一の手がかりになる
function json(body: unknown, status = 200) {
  console.log("chatwork-forward", JSON.stringify(body));
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
