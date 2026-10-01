// 見積依頼書PDFをサーバー側で作るEdge Function。
//
// 中身の組み立てと保存は _shared/quote-pdf.ts にまとめてある（発注書と同じ作り）。

import { createClient } from "npm:@supabase/supabase-js@2";
import { saveQuotePdf } from "../_shared/quote-pdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "認証が必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!profile || (profile.role !== "staff" && profile.role !== "carpenter")) {
      return json({ error: "権限がありません" }, 403);
    }

    const q = await req.json();
    if (!q?.no) return json({ error: "依頼番号がありません" }, 400);
    const url = await saveQuotePdf(admin, q);
    return json({ url });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
