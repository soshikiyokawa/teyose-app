// チャット・発注書がきた時に、スマホへプッシュ通知を送るためのEdge Function。
//
// 呼び出し元（社内 or 発注先）から、誰に通知すべきか（targetRole/targetSupplierId）と
// 通知の内容を受け取り、該当する端末の購読情報（push_subscriptions）に向けて送信する。

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:support@kiyokawanoie.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // 呼び出し元がログイン済みであることだけ確認する（社内・発注先どちらからも呼ばれる）
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "認証が必要です" }, 401);
    }

    const { targetRole, targetSupplierId, title, body } = await req.json();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profiles } = await admin.from("profiles").select("id, role, supplier_id");
    const targetUserIds = (profiles || [])
      .filter((p: any) => {
        if (targetRole === "staff") return p.role === "staff";
        if (targetRole === "supplier") return p.role === "supplier" && p.supplier_id === targetSupplierId;
        return false;
      })
      .map((p: any) => p.id);

    if (!targetUserIds.length) return json({ sent: 0 });

    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", targetUserIds);

    let sent = 0;
    await Promise.all(
      (subs || []).map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: title || "手寄", body: body || "" }),
          );
          sent++;
        } catch (e: any) {
          // 登録が失効している場合は購読情報を削除しておく
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }),
    );

    return json({ sent });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
