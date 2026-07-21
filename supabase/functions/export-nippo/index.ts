// 日報の月別CSVエクスポート用Edge Function。
//
// 事務所PCのスケジュールタスク（scripts/export-nippo-onedrive.ps1）から毎日呼ばれ、
// 指定月の日報をExcelで開けるCSV（UTF-8 BOM付き）で返す。PCがOneDriveフォルダに
// 保存することで、日報がOneDriveへ自動バックアップされる。
//
// 呼び出し：GET /export-nippo?month=2026-07
// 認証：x-remind-secretヘッダーがSecrets（OT_REMIND_SECRET）と一致する場合のみ動作。

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OT_REMIND_SECRET = Deno.env.get("OT_REMIND_SECRET")!;

const OT_STATUS_LABEL: Record<string, string> = {
  none: "", pending: "申請中", approved: "承認済", rejected: "却下",
};

const CRLF = "\r\n";
const BOM = String.fromCharCode(0xFEFF);

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-remind-secret") !== OT_REMIND_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const month = new URL(req.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return new Response(JSON.stringify({ error: "month は YYYY-MM 形式で指定してください" }), { status: 400 });
    }
    const [y, m] = month.split("-").map(Number);
    const start = `${month}-01`;
    const end = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: rows, error } = await admin.from("daily_reports")
      .select("*")
      .gte("work_date", start).lte("work_date", end)
      .order("work_date").order("user_name").order("id");
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    const yobi = ["日", "月", "火", "水", "木", "金", "土"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const hours = (min: number) => (Math.round((min / 60) * 100) / 100).toString();

    const header = ["日付", "曜日", "氏名", "現場", "作業種別", "作業内容", "開始", "終了", "休憩(分)", "実働(時間)", "残業(時間)", "残業承認", "承認者"];
    const lines = [header.map(esc).join(",")];
    for (const r of rows ?? []) {
      const d = new Date(r.work_date + "T00:00:00");
      lines.push([
        r.work_date, yobi[d.getDay()], r.user_name, r.project_name, r.work_kind, r.content,
        r.start_time, r.end_time, r.break_minutes, hours(r.work_minutes),
        r.overtime_minutes > 0 ? hours(r.overtime_minutes) : "",
        OT_STATUS_LABEL[r.ot_status] ?? "",
        r.ot_status !== "none" ? (r.ot_reviewer_name || r.ot_approver_name || "") : "",
      ].map(esc).join(","));
    }

    // BOM付きUTF-8（Excelで文字化けせずに開ける）
    const csv = BOM + lines.join(CRLF) + CRLF;
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500 });
  }
});
