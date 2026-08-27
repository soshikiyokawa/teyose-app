// 発注書PDFをサーバー側（Supabase Edge Function）で生成するための関数。
//
// PDFの中身の組み立てと保存は _shared/order-pdf.ts にまとめてある。
// あとから単価を直したとき（update-order-price）も同じものを使って作り直すため。

import { createClient } from "npm:@supabase/supabase-js@2";
import { saveOrderPdf } from "../_shared/order-pdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // ① 呼び出し元が、ログイン済みの社内（staff）ユーザーであることを確認する
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "認証が必要です" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (!profile || profile.role !== "staff") {
      return json({ error: "権限がありません" }, 403);
    }

    // ② 発注データを受け取り、PDFを組み立てて保存する
    const order = await req.json();
    const url = await saveOrderPdf(admin, order);
    return json({ url });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
