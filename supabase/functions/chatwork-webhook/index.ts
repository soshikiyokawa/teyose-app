// ChatWork → 手寄 取り込み用Webフック。
//
// ChatWorkのルームに投稿があるとChatWorkがこのURLへPOSTしてくる。
// ルームIDに対応する発注先チャットへ、そのメッセージを取り込む（相手＝発注先の発言として）。
//
// セキュリティ：X-ChatWorkWebhookSignature（本文のHMAC-SHA256, Base64）を
//   Secrets の CHATWORK_WEBHOOK_TOKEN（ChatWorkのWebhook設定で発行されるトークン）で検証する。
// ループ防止：手寄→ChatWorkへ転送した自分の投稿（[info][title]手寄…）は取り込まない。
// デプロイは --no-verify-jwt（ChatWorkはSupabaseのJWTを送らないため。認証は署名で担保）。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { logNotifications } from "../_shared/notify-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHATWORK_TOKEN = Deno.env.get("CHATWORK_TOKEN") ?? "";
const WEBHOOK_TOKEN = Deno.env.get("CHATWORK_WEBHOOK_TOKEN") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

// ChatWork記法の軽い掃除（宛先・引用・アイコンタグを除去）
function cleanBody(s: string): string {
  return (s || "")
    .replace(/\[To:\d+\][^\n]*/g, "")
    .replace(/\[rp\s+[^\]]*\]/g, "")
    .replace(/\[piconname:\d+\]|\[picon:\d+\]/g, "")
    .replace(/\[qt\]|\[\/qt\]|\[qtmeta[^\]]*\]/g, "")
    .replace(/\[info\]|\[\/info\]|\[title\]|\[\/title\]/g, "")
    .trim();
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("ok", { status: 200 });
    const raw = await req.text();

    // 署名検証（未設定なら拒否＝fail-closed。なりすまし投稿を防ぐ）
    if (!WEBHOOK_TOKEN) return new Response("webhook未設定", { status: 401 });
    const sig = req.headers.get("X-ChatWorkWebhookSignature") || "";
    const key = await crypto.subtle.importKey("raw", b64ToBytes(WEBHOOK_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
    if (bytesToB64(mac) !== sig) return new Response("invalid signature", { status: 401 });

    const payload = JSON.parse(raw);
    if (payload?.webhook_event_type !== "message_created") return json({ ok: true, skipped: "not-message" });
    const ev = payload.webhook_event || {};
    const roomId = String(ev.room_id ?? "");
    const body: string = ev.body ?? "";
    if (!roomId || !body) return json({ ok: true, skipped: "empty" });

    // 手寄→ChatWorkへ転送した自分の投稿は取り込まない（ループ防止）
    if (body.includes("手寄（きよかわ）")) return json({ ok: true, skipped: "self" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ルームID → 発注先
    const { data: sup } = await admin.from("suppliers").select("id, name").eq("chatwork_room_id", roomId).maybeSingle();
    if (!sup) return json({ ok: true, skipped: "no-supplier" });

    // 送信者名（ChatWork APIでルームメンバーから取得。失敗時は発注先名）
    let senderName = sup.name;
    try {
      if (CHATWORK_TOKEN && ev.account_id) {
        const mres = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/members`, { headers: { "X-ChatWorkToken": CHATWORK_TOKEN } });
        if (mres.ok) {
          const members = await mres.json();
          const me = (members || []).find((m: any) => m.account_id === ev.account_id);
          if (me?.name) senderName = me.name;
        }
      }
    } catch (_) { /* 名前が取れなくても続行 */ }

    // 発注先チャットに取り込む（相手＝them）
    const { error } = await admin.from("chat_messages").insert({
      supplier_id: sup.id, is_internal: false, role: "them", type: "text",
      text: cleanBody(body), unread: true, sender_name: senderName + "（ChatWork）",
    });
    if (error) return json({ error: error.message }, 500);

    // 事務（staff）へプッシュ通知
    try {
      const { data: staff } = await admin.from("profiles").select("id").eq("role", "staff");
      const ids = (staff || []).map((p: any) => p.id);
      if (ids.length) {
        await logNotifications(admin, ids,
          { title: sup.name, body: cleanBody(body).slice(0, 80), tab: null }, "chatwork");
        const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", ids);
        await Promise.all((subs || []).map(async (s: any) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: sup.name, body: cleanBody(body).slice(0, 80) }),
            );
          } catch (e: any) {
            if (e?.statusCode === 410 || e?.statusCode === 404) await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        }));
      }
    } catch (_) { /* 通知失敗は無視 */ }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
