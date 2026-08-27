// 発注済みの単価を、発注先があとから直すためのEdge Function。
//
// 発注先にデータベースを直接いじらせると、品目や数量まで変えられてしまうので、
// ここを通してのみ単価を書き換える。やることは4つ。
//   ① 呼び出したのが、その発注先のログイン済みの人かを確認する
//   ② 発注の単価を差し替え、小計・消費税・合計を計算し直す
//   ③ 変更の履歴（いくらから いくらへ）を発注に残す
//   ④ 原価管理の金額（cost_entries）も同じ品目のぶんだけ直す
//
// きよかわの社員も同じ発注の単価を直せる（発注先に代わって入れる場合）。
// 通知とチャットへの記録は、呼び出した画面の側で行う。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── ① 呼び出し元を確かめる ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "ログインが必要です" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles")
      .select("role, display_name, supplier_id").eq("id", userData.user.id).single();
    if (!profile) return json({ error: "利用者の情報が見つかりません" }, 403);

    const { orderNo, prices, note } = await req.json();
    if (!orderNo) return json({ error: "発注番号がありません" }, 400);
    if (!Array.isArray(prices) || !prices.length) return json({ error: "変更する単価がありません" }, 400);

    const { data: order, error: ordErr } = await admin.from("orders")
      .select("*").eq("no", orderNo).single();
    if (ordErr || !order) return json({ error: "その発注が見つかりません" }, 404);

    // 発注先は自社宛の発注だけ。社員はどれでも直せる
    const isStaff = profile.role === "staff" || profile.role === "carpenter";
    if (!isStaff) {
      if (profile.role !== "supplier" || profile.supplier_id !== order.supplier_id) {
        return json({ error: "この発注の単価は変更できません" }, 403);
      }
    }

    // ── ② 単価を差し替える ──
    // 品目は番号（index）で指定する。名前が同じ品目が複数あっても取り違えないため
    const items: any[] = Array.isArray(order.items) ? JSON.parse(JSON.stringify(order.items)) : [];
    const changes: any[] = [];
    for (const p of prices) {
      const i = Number(p.index);
      if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
      const after = Math.round(num(p.price));
      if (after < 0) return json({ error: "単価に負の数は入れられません" }, 400);
      const before = Math.round(num(items[i].cost ?? items[i].price));
      if (before === after) continue;
      // 最初に直したときの単価を残しておく（何度直しても当初の発注単価が分かる）
      if (items[i].origPrice === undefined || items[i].origPrice === null) items[i].origPrice = before;
      items[i].cost = after;
      items[i].price = after;
      changes.push({ name: String(items[i].name || ""), qty: num(items[i].qty), before, after });
    }
    if (!changes.length) return json({ error: "単価が変わっていません" }, 400);

    const subtotal = items.reduce((s, it) => s + num(it.cost) * num(it.qty), 0);
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;

    const edit = {
      at: new Date().toISOString(),
      byName: String(profile.display_name || ""),
      byRole: profile.role,
      note: String(note || "").slice(0, 200),
      changes,
      subtotal: { before: num(order.subtotal), after: subtotal },
      total: { before: num(order.total), after: total },
    };
    const history = Array.isArray(order.price_edits) ? order.price_edits : [];

    const { error: upErr } = await admin.from("orders")
      .update({ items, subtotal, tax, total, price_edits: [...history, edit] })
      .eq("no", orderNo);
    if (upErr) return json({ error: "発注の更新に失敗しました：" + upErr.message }, 500);

    // ── ④ 原価管理の金額も直す ──
    // 発注のときに「品目名・数量」で1行ずつ作っているので、それで突き合わせる
    const { data: costRows } = await admin.from("cost_entries")
      .select("id, name, qty, amount").eq("order_no", orderNo).eq("supplier_id", order.supplier_id);
    const used = new Set<number>();
    const costUpdated: any[] = [];
    for (const it of items) {
      const want = Math.round(num(it.cost) * num(it.qty));
      const row = (costRows || []).find((r: any) =>
        !used.has(r.id) && String(r.name) === String(it.name || "") && num(r.qty) === num(it.qty));
      if (!row) continue;
      used.add(row.id);
      if (Math.round(num(row.amount)) === want) continue;
      const { error } = await admin.from("cost_entries").update({ amount: want }).eq("id", row.id);
      if (!error) costUpdated.push({ name: row.name, before: num(row.amount), after: want });
    }

    return json({
      ok: true,
      orderNo,
      changes,
      subtotal, tax, total,
      costUpdated: costUpdated.length,
      // 原価の行が見つからなかった品目があれば知らせる（発注後に原価を消した場合など）
      costMissing: items.length - used.size,
      edit,
    });
  } catch (err) {
    return json({ error: String((err as any)?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
