// ChatWork → 手寄 取り込み用Webフック。
//
// ChatWorkのルームに投稿があるとChatWorkがこのURLへPOSTしてくる。
// ルームIDに対応する発注先チャットへ、そのメッセージを取り込む（相手＝発注先の発言として）。
// 添付ファイルは ChatWork から取り出して手寄のStorageに入れ直し、資料として並べる。
//
// セキュリティ：X-ChatWorkWebhookSignature（本文のHMAC-SHA256, Base64）を
//   Secrets の CHATWORK_WEBHOOK_TOKEN（ChatWorkのWebhook設定で発行されるトークン）で検証する。
// ループ防止：きよかわのChatWorkアカウント自身の投稿は取り込まない（手寄からの転送もこれに当たる）。
// デプロイは --no-verify-jwt（ChatWorkはSupabaseのJWTを送らないため。認証は署名で担保）。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { logNotifications } from "../_shared/notify-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHATWORK_TOKEN = Deno.env.get("CHATWORK_TOKEN") ?? "";
// ChatWorkのWebhookは1つごとに別のトークンで署名される。
// ルームごとにWebhookを作る場合は、トークンをカンマ区切りで並べて登録しておく
const WEBHOOK_TOKENS = (Deno.env.get("CHATWORK_WEBHOOK_TOKEN") ?? "")
  .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

// 手寄と同じ上限（40MB）。これより大きいものは取り込まず、ChatWorkで見てもらう
const FILE_MAX = 40 * 1024 * 1024;

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

const cwHeaders = { "X-ChatWorkToken": CHATWORK_TOKEN };

// ファイルを投稿すると本文に [download:12345]名前.pdf (54.06 KB)[/download] が入る
const DOWNLOAD_RE = /\[download:(\d+)\][\s\S]*?\[\/download\]/g;

// ChatWork記法の軽い掃除（宛先・引用・アイコン・自動見出しを除去）
function cleanBody(s: string): string {
  return (s || "")
    .replace(/\[To:\d+\][^\n]*/g, "")
    .replace(/\[rp\s+[^\]]*\]/g, "")
    .replace(/\[piconname:\d+\]|\[picon:\d+\]/g, "")
    .replace(/\[qt\]|\[\/qt\]|\[qtmeta[^\]]*\]/g, "")
    .replace(/\[dtext:[^\]]*\]/g, "")
    .replace(/\[info\]|\[\/info\]|\[title\]|\[\/title\]/g, "")
    .trim();
}

// 拡張子から種類を決める（手寄の画面で写真をそのまま表示するかの判断に使う）
const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", bmp: "image/bmp",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
function mimeOf(name: string): string {
  const ext = (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || "").toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

// きよかわ自身のChatWorkアカウント番号（1回だけ問い合わせて覚える）。
// meStatus は APIトークンが通っているかの目印（200なら有効、401なら無効）。ログに出す
let myAccountId: number | null | undefined;
let cwMeStatus = 0;
async function chatworkMyAccountId(): Promise<number | null> {
  if (myAccountId !== undefined) return myAccountId;
  myAccountId = null;
  try {
    if (!CHATWORK_TOKEN) { cwMeStatus = -1; return myAccountId; }
    const res = await fetch("https://api.chatwork.com/v2/me", { headers: cwHeaders });
    cwMeStatus = res.status;
    if (res.ok) myAccountId = Number((await res.json())?.account_id) || null;
  } catch (_) { cwMeStatus = -2; /* 取れなくても続行（本文での見分けに任せる） */ }
  return myAccountId;
}

// 本文の署名が、登録されているトークンのどれかで作られたものか確かめる
async function signatureOk(raw: string, sig: string): Promise<boolean> {
  if (!sig) return false;
  const data = new TextEncoder().encode(raw);
  for (const token of WEBHOOK_TOKENS) {
    try {
      const key = await crypto.subtle.importKey("raw", b64ToBytes(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = await crypto.subtle.sign("HMAC", key, data);
      if (bytesToB64(mac) === sig) return true;
    } catch (_) { /* 形が違うトークンは飛ばす */ }
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("ok", { status: 200 });
    const raw = await req.text();

    // 署名検証（未設定なら拒否＝fail-closed。なりすまし投稿を防ぐ）。
    // 登録されているトークンのどれかと合えば通す（Webhookを複数作れるようにするため）
    if (!WEBHOOK_TOKENS.length) {
      console.log("chatwork-webhook", JSON.stringify({ error: "webhook未設定" }));
      return new Response("webhook未設定", { status: 401 });
    }
    const sig = req.headers.get("X-ChatWorkWebhookSignature") || "";
    if (!(await signatureOk(raw, sig))) {
      // 署名が合わない。ChatWorkからなら（署名あり）トークンの取り違え、
      // 署名が無ければ ChatWork 以外からの通信
      console.log("chatwork-webhook", JSON.stringify({
        error: "invalid signature", hasSignature: !!sig, tokens: WEBHOOK_TOKENS.length,
      }));
      return new Response("invalid signature", { status: 401 });
    }

    const payload = JSON.parse(raw);
    // 何が届いたかを返事に書いておく（ChatWorkのWebhook履歴で原因が分かるように）
    if (payload?.webhook_event_type !== "message_created") {
      return json({ ok: true, skipped: "not-message", got: payload?.webhook_event_type ?? null });
    }
    const ev = payload.webhook_event || {};
    const roomId = String(ev.room_id ?? "");
    const body: string = ev.body ?? "";
    if (!roomId || !body) return json({ ok: true, skipped: "empty" });

    // きよかわ自身の投稿は取り込まない。
    // 手寄からの転送がそのまま返ってくる（二重になる）のを防ぐのが主目的。
    // アカウント番号が取れないときは、転送の見出しの文字で見分ける
    const me = await chatworkMyAccountId();
    if (me && Number(ev.account_id) === me) return json({ ok: true, skipped: "self" });
    if (body.includes("手寄（きよかわ）")) return json({ ok: true, skipped: "self" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ルームID → 発注先
    const { data: sup } = await admin.from("suppliers").select("id, name").eq("chatwork_room_id", roomId).maybeSingle();
    // どのルームが結び付いていないのか、返事で分かるようにしておく
    if (!sup) return json({ ok: true, skipped: "no-supplier", room: roomId });

    // 送信者名（ChatWork APIでルームメンバーから取得。失敗時は発注先名）
    let senderName = sup.name;
    let membersStatus = 0;
    try {
      if (CHATWORK_TOKEN && ev.account_id) {
        const mres = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/members`, { headers: cwHeaders });
        membersStatus = mres.status;
        if (mres.ok) {
          const members = await mres.json();
          // 番号の型が違うことがあるので、文字にそろえて照合する
          const who = (members || []).find((m: any) => String(m.account_id) === String(ev.account_id));
          if (who?.name) senderName = who.name;
        }
      } else membersStatus = -1;
    } catch (_) { membersStatus = -2; /* 名前が取れなくても続行 */ }
    const sender = senderName + "（ChatWork）";

    // 添付ファイルと、それ以外の文章に分ける
    const fileIds = [...body.matchAll(DOWNLOAD_RE)].map((m) => m[1]);
    const textPart = cleanBody(body.replace(DOWNLOAD_RE, ""));

    const rows: Record<string, unknown>[] = [];
    const base = { supplier_id: sup.id, is_internal: false, role: "them", unread: true, sender_name: sender };
    if (textPart) rows.push({ ...base, type: "text", text: textPart });

    const fileNotes: string[] = [];
    for (const fid of fileIds) {
      const got = await pullFile(admin, roomId, fid);
      if (got.url) rows.push({ ...base, type: "file", file_url: got.url, file_name: got.name, file_mime: got.mime });
      else {
        fileNotes.push(`${fid}:${got.step}:${got.note}`);
        rows.push({ ...base, type: "text", text: `📎 ${got.name}（${got.note}。ChatWorkでご確認ください）` });
      }
    }
    if (!rows.length) return json({ ok: true, skipped: "nothing-to-save" });

    // 発注先チャットに取り込む（相手＝them）
    const { error } = await admin.from("chat_messages").insert(rows);
    if (error) return json({ error: error.message }, 500);

    // 事務（staff）へプッシュ通知
    const preview = (textPart || `📎 ${fileIds.length ? "ファイル" : ""}`).slice(0, 80);
    try {
      const { data: staff } = await admin.from("profiles").select("id").eq("role", "staff");
      const ids = (staff || []).map((p: any) => p.id);
      if (ids.length) {
        await logNotifications(admin, ids, { title: sup.name, body: preview, tab: null }, "chatwork");
        const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", ids);
        await Promise.all((subs || []).map(async (s: any) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: sup.name, body: preview }),
            );
          } catch (e: any) {
            if (e?.statusCode === 410 || e?.statusCode === 404) await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        }));
      }
    } catch (_) { /* 通知失敗は無視 */ }

    // cw は ChatWork API の返り（200なら通っている、401ならトークンが受け付けられていない）
    return json({
      ok: true, saved: rows.length, files: fileIds.length, fileErrors: fileNotes,
      cw: { me: cwMeStatus, members: membersStatus },
    });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

// ChatWorkの添付を手寄のStorage（chat-files）へ入れ直し、表示用のURLを返す。
// ダウンロードURLは発行から30秒しか使えないため、取り出したらすぐ入れ直す。
async function pullFile(admin: any, roomId: string, fileId: string):
  Promise<{ url: string; name: string; mime: string; note: string; step: string }> {
  // step は「どこで止まったか」。ログに残して原因を切り分けるためのもの
  const fail = (name: string, note: string, step: string) => ({ url: "", name, mime: "", note, step });
  if (!CHATWORK_TOKEN) return fail("ファイル", "ChatWorkの設定が足りません", "no-token");

  let info: any;
  try {
    const res = await fetch(
      `https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(fileId)}?create_download_url=1`,
      { headers: cwHeaders },
    );
    if (!res.ok) {
      // ChatWorkが返した理由をそのまま残す（401なら「Invalid API token」等）
      const why = (await res.text()).slice(0, 200);
      return fail("ファイル", `取り出せませんでした(${res.status})`, `info-${res.status} ${why}`);
    }
    info = await res.json();
  } catch (e) {
    return fail("ファイル", `取り出せませんでした（${String((e as any)?.message || e)}）`, "info-throw");
  }

  const name = String(info?.filename || "ファイル");
  if (!info?.download_url) return fail(name, "ダウンロード先が分かりませんでした", "no-url");
  if (Number(info?.filesize) > FILE_MAX) return fail(name, "大きすぎて取り込めません", "too-big");

  let bytes: Uint8Array;
  try {
    const dl = await fetch(info.download_url);
    if (!dl.ok) return fail(name, `取り出せませんでした(${dl.status})`, `download-${dl.status}`);
    bytes = new Uint8Array(await dl.arrayBuffer());
  } catch (e) {
    return fail(name, `取り出せませんでした（${String((e as any)?.message || e)}）`, "download-throw");
  }
  if (bytes.byteLength > FILE_MAX) return fail(name, "大きすぎて取り込めません", "too-big");

  // 保存先のキーには日本語等が使えないため、拡張子だけ残す（元の名前は file_name に持つ）
  const ext = name.match(/\.[a-zA-Z0-9]+$/)?.[0] || "";
  const mime = mimeOf(name);
  const path = `cw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const { error } = await admin.storage.from("chat-files").upload(path, bytes, { contentType: mime });
  if (error) return fail(name, `取り込めませんでした（${error.message}）`, "storage");

  const { data } = admin.storage.from("chat-files").getPublicUrl(path);
  return { url: data.publicUrl, name, mime, note: "", step: "" };
}

// ダッシュボードの Logs で追えるように、1件ごとに結果を1行残す。
// メッセージの中身は書かない（ログに本文を残さないため）
function json(body: unknown, status = 200) {
  console.log("chatwork-webhook", JSON.stringify(body));
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
