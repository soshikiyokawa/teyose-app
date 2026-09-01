// 発注書PDFの組み立てと保存。
//
// 発注確定のとき（generate-order-pdf）と、あとから単価を直したとき（update-order-price）の
// 両方から使う。同じ発注番号なら同じ場所に上書きするので、単価を直すとPDFも直る。
//
// もともとはブラウザ内でhtml2canvasを使って画面を画像化していたが、
// 一部の端末（セキュリティソフトや組織のネットワーク設定など）でCanvas読み取りが
// ブロックされ、内容が空白のPDFになってしまう問題があった。
// サーバー側で直接PDFを組み立てることで、ブラウザ側の制限を一切受けないようにしている。

import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

export const COMPANY = {
  name: "株式会社きよかわ",
  zip: "〒731-0221",
  address: "広島県広島市安佐北区可部2-13-31-1",
  tel: "082-815-6080",
  url: "kiyokawanoie.com",
};

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("ja-JP");
const nowPrice = (it: any) => Math.round(Number(it?.cost ?? it?.price) || 0);
const origPrice = (it: any) =>
  it?.origPrice === undefined || it?.origPrice === null
    ? nowPrice(it)
    : Math.round(Number(it.origPrice) || 0);

// 数字が間延びするのを防ぐ。
//
// フォントは、英字と数字が並ぶ型番（SUS410 など）のとき、数字を別の字形に置き換える。
// その字形の幅はPDFに書かれないため、閲覧ソフトが既定の全角幅で描いてしまい、
// 「SUS4 1 0」のように数字だけ間延びしていた（電話番号も同じ）。
//
// 英字と数字の境目で分けて描くと、数字だけの並びには置き換えが起きないので、
// 幅も、PDFからの文字の取り出し（検索・コピー）も正しくなる。
function splitRuns(text: string): string[] {
  const out: string[] = [];
  let cur = "", curKind = "";
  for (const ch of Array.from(text)) {
    const kind = /[0-9]/.test(ch) ? "d" : /[A-Za-z]/.test(ch) ? "a" : "o";
    if (cur && kind !== curKind && (kind === "d" || curKind === "d")) { out.push(cur); cur = ""; }
    cur += ch;
    curKind = kind;
  }
  if (cur) out.push(cur);
  return out;
}
function textWidth(font: any, text: string, size: number): number {
  return splitRuns(text).reduce((w, r) => w + font.widthOfTextAtSize(r, size), 0);
}
// 分けた並びを、続けて見えるように順に置いていく
function drawRuns(page: any, text: string, opts: any) {
  let x = opts.x;
  for (const r of splitRuns(text)) {
    page.drawText(r, { ...opts, x });
    x += opts.font.widthOfTextAtSize(r, opts.size);
  }
}

// 決まった幅に収まるように文字を折り返す。
// 日本語には単語の区切りがないので、1文字ずつ幅を測って入るところまで詰める。
// 英数字の続き（型番など）は、途中で切れると読みにくいので手前で折り返す。
function wrapByWidth(text: string, font: any, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const width = (s: string) => {
    try { return textWidth(font, s, size); } catch { return s.length * size; }
  };
  const isWordChar = (c: string) => /[0-9A-Za-z._\-/#()]/.test(c);
  for (const ch of Array.from(text)) {
    if (ch === "\n") { lines.push(cur); cur = ""; continue; }
    if (cur && width(cur + ch) > maxWidth) {
      // 英数字の途中なら、その語のはじめまで戻して次の行へ送る
      let head = cur, tail = "";
      if (isWordChar(ch)) {
        while (head && isWordChar(head[head.length - 1])) {
          tail = head[head.length - 1] + tail;
          head = head.slice(0, -1);
        }
        // 行のほとんどが1つの語なら、戻さずそのまま切る
        if (!head || width(tail) > maxWidth * 0.6) { head = cur; tail = ""; }
      }
      lines.push(head);
      cur = tail + ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// PDFを組み立ててStorageに保存し、表示用のURLを返す。
// 同じ発注番号なら同じ場所を上書きするため、古いURLを開いても新しい中身が出る。
// URLの末尾に時刻を付けているのは、端末やCDNに残った古いPDFを掴まないようにするため。
export async function saveOrderPdf(admin: any, order: any): Promise<string> {
  const pdfBytes = await buildOrderPdf(order);
  const path = `${String(order.no).slice(0, 6)}/${order.no}.pdf`;
  const { error } = await admin.storage
    .from("order-pdfs")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(error.message);
  const { data: pub } = admin.storage.from("order-pdfs").getPublicUrl(path);
  return pub.publicUrl + "?t=" + Date.now();
}

export async function buildOrderPdf(o: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // フォントファイルが大きく、デプロイ時にFunctionへ同梱されないことがあるため、
  // Supabase Storage（publicバケット）に置いたフォントをHTTPで取得して埋め込む。
  const FONTS_BASE = `${SUPABASE_URL}/storage/v1/object/public/assets/fonts`;
  const regularBytes = new Uint8Array(await (await fetch(`${FONTS_BASE}/NotoSansJP-Regular.ttf`)).arrayBuffer());
  const boldBytes = new Uint8Array(await (await fetch(`${FONTS_BASE}/NotoSansJP-Bold.ttf`)).arrayBuffer());
  // subset:trueにすると日本語のような文字数の多いフォントで文字が欠ける不具合があるため、
  // サブセット化せずフォント全体をそのまま埋め込む
  const font = await pdfDoc.embedFont(regularBytes, { subset: false });
  const fontBold = await pdfDoc.embedFont(boldBytes, { subset: false });

  const PAGE_W = 595.28, PAGE_H = 841.89; // A4 (pt)
  const marginX = 42;
  const rightX = PAGE_W - marginX;
  const tableW = rightX - marginX;

  const black = rgb(0.165, 0.118, 0.055);
  const gray = rgb(0.53, 0.53, 0.53);
  const green = rgb(0.36, 0.48, 0.24);
  const lightBg = rgb(0.969, 0.953, 0.922);
  const lineColor = rgb(0.91, 0.88, 0.81);
  const darkBrown = rgb(0.165, 0.118, 0.055);
  const gold = rgb(0.831, 0.663, 0.416);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = 800;

  const drawRight = (text: string, yy: number, size = 9, f = font, color = gray) => {
    const w = textWidth(f, text, size);
    drawRuns(page, text, { x: rightX - w, y: yy, size, font: f, color });
  };
  const newPageIfNeeded = (need: number) => {
    if (y - need < 50) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = 800;
    }
  };

  // 単価を直した発注は、いつ直したものかが分かるようにしておく
  const edits: any[] = Array.isArray(o.priceEdits) ? o.priceEdits : (Array.isArray(o.price_edits) ? o.price_edits : []);
  const lastEdit = edits.length ? edits[edits.length - 1] : null;
  const editedOn = lastEdit ? String(lastEdit.at || "").slice(0, 10) : "";

  drawRuns(page, "発 注 書", { x: marginX, y, size: 20, font: fontBold, color: black });
  drawRuns(page, "Purchase Order", { x: marginX, y: y - 16, size: 9, font, color: gray });
  if (lastEdit) {
    drawRuns(page, `単価変更あり（${editedOn} 改定・${edits.length}回目）`, {
      x: marginX + 92, y: y + 4, size: 9, font: fontBold, color: green,
    });
  }
  drawRight(COMPANY.name, y - 2, 11, fontBold, black);
  drawRight(`${COMPANY.zip} ${COMPANY.address}`, y - 14, 8, font, gray);
  drawRight(`TEL：${COMPANY.tel}`, y - 24, 8, font, gray);
  drawRight(COMPANY.url, y - 34, 8, font, green);

  y -= 60;
  const boxH = 86;
  page.drawRectangle({ x: marginX, y: y - boxH, width: tableW, height: boxH, color: lightBg });
  let iy = y - 16;
  drawRuns(page, `発注先：${o.suppliers || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  iy -= 16;
  drawRuns(page, `発注番号：${o.no || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  drawRuns(page, `発注日：${o.date || ""}`, { x: marginX + 260, y: iy, size: 10, font, color: black });
  iy -= 16;
  drawRuns(page, `費目区分：${o.costType || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  iy -= 16;
  drawRuns(page, `物件名：${o.project || ""}`, { x: marginX + 10, y: iy, size: 10, font, color: black });
  // 「最短」で出した発注は、日付ではなく「最短」と書いて渡す
  const dueLabel = o.dueAsap ? "最短" : (o.dueDate || "未指定");
  drawRuns(page, `納品希望日：${dueLabel}`, { x: marginX + 260, y: iy, size: 10, font, color: black });

  y -= boxH + 16;
  const colX = [marginX, marginX + 260, marginX + 320, marginX + 380, marginX + 440];
  const PAD = 8;
  // 品目名を書ける幅。ここを超えたら折り返して、単位の欄に食い込まないようにする
  const nameW = colX[1] - colX[0] - PAD * 2;
  const ROW_SIZE = 9;
  const LINE_H = 12;

  const drawTableHead = () => {
    page.drawRectangle({ x: marginX, y: y - 20, width: tableW, height: 20, color: darkBrown });
    const hy = y - 14;
    drawRuns(page, "品目名", { x: colX[0] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "単位", { x: colX[1] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "数量", { x: colX[2] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "単価", { x: colX[3] + PAD, y: hy, size: 9, font, color: gold });
    drawRuns(page, "金額", { x: colX[4] + PAD, y: hy, size: 9, font, color: gold });
    y -= 20;
  };
  drawTableHead();

  for (const it of o.items || []) {
    const price = nowPrice(it);
    const orig = origPrice(it);
    const qty = Number(it.qty) || 0;
    const changed = orig !== price;
    // 長い品目名は、欄の幅で折り返して行を増やす
    const nameLines = wrapByWidth(String(it.name || ""), font, ROW_SIZE, nameW);
    const rowH = Math.max(20, 6 + nameLines.length * LINE_H + 2);
    if (y - (rowH + (changed ? LINE_H : 0)) < 50) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = 800;
      drawTableHead();   // 次のページにも見出しを出す
    }
    page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
    const rowY = y - 14;
    nameLines.forEach((line, i) => {
      drawRuns(page, line, { x: colX[0] + PAD, y: rowY - i * LINE_H, size: ROW_SIZE, font, color: black });
    });
    drawRuns(page, String(it.unit || ""), { x: colX[1] + PAD, y: rowY, size: ROW_SIZE, font, color: black });
    drawRuns(page, String(qty), { x: colX[2] + PAD, y: rowY, size: ROW_SIZE, font, color: black });
    drawRuns(page, "¥" + fmt(price), { x: colX[3] + PAD, y: rowY, size: ROW_SIZE, font, color: black });
    drawRuns(page, "¥" + fmt(price * qty), { x: colX[4] + PAD, y: rowY, size: ROW_SIZE, font, color: black });
    y -= rowH;
    // 直した品目は、当初いくらだったかを小さく添える
    if (changed) {
      drawRuns(page, `（当初 ¥${fmt(orig)} → ¥${fmt(price)}）`, {
        x: colX[0] + PAD, y: y - 2, size: 7.5, font, color: gray,
      });
      y -= LINE_H;
    }
  }
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });

  newPageIfNeeded(110);
  y -= 24;
  drawRight(`小計：¥${fmt(o.subtotal)}`, y, 11, font, rgb(0.2, 0.2, 0.2));
  y -= 18;
  drawRight(`消費税（10%）：¥${fmt(o.tax)}`, y, 11, font, rgb(0.2, 0.2, 0.2));
  y -= 22;
  drawRight(`合計：¥${fmt(o.total)}`, y, 16, fontBold, rgb(0.29, 0.19, 0.06));

  if (lastEdit) {
    const first = edits[0];
    y -= 16;
    drawRight(`（当初の合計：¥${fmt(first?.total?.before)}）`, y, 8.5, font, gray);
  }

  y -= 24;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + tableW, y }, thickness: 0.5, color: lineColor });
  y -= 14;
  drawRuns(page, `納品場所：${o.project || ""} 現場　／　ご納品の際は現場担当者へご連絡ください。`, {
    x: marginX, y, size: 8, font, color: gray,
  });
  if (lastEdit) {
    y -= 12;
    const by = String(lastEdit.byName || "");
    drawRuns(page, `この発注書は ${editedOn} に単価変更のため作り直したものです${by ? `（変更：${by}）` : ""}。`, {
      x: marginX, y, size: 8, font, color: gray,
    });
  }

  return await pdfDoc.save();
}
