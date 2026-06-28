// ════ 見積：御請求書PDFプレビュー・印刷 ════
// 見積書の内容（明細・金額）をそのまま使って請求書を発行する。
// 配色・レイアウトは見積書PDFに合わせている。

const BANK_INFO = {
  bank: '広島銀行　可部支店',
  type: '普通',
  no: '3138136',
  holder: '株式会社きよかわ　ｶ)ｷﾖｶﾜ',
};

let _invoicePdfData=null, _invoicePdfCalc=null;

function openInvoicePdf(){
  _invoicePdfData=collectEstData();
  _invoicePdfCalc=recalcSum();
  renderInvoicePdfBody();
  document.getElementById('invoice-pdf-overlay').classList.add('open');
}
function closeInvoicePdf(){document.getElementById('invoice-pdf-overlay').classList.remove('open');}

function renderInvoicePdfBody(){
  const data=_invoicePdfData, c=_invoicePdfCalc;
  if(!data||!c) return;
  const today=new Date().toISOString().slice(0,10);

  const header=`
    <div style="background:${EST_PDF_GREEN};color:#fff;text-align:center;padding:14px 0;margin-bottom:18px;border-radius:3px">
      <div style="font-size:24px;font-weight:900;letter-spacing:.3em">御 請 求 書</div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:18px;margin-bottom:14px">
      <div style="flex:1">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:6px 4px;color:#888;width:90px">請求先</td><td style="padding:6px 4px;font-weight:700">${data.clientName||'　'}　様</td></tr>
        </table>
        <div style="background:${EST_PDF_GREEN_LIGHT};border:1px solid ${EST_PDF_BORDER};border-radius:4px;padding:10px 14px;margin:8px 0">
          <div style="font-size:11px;color:#888;margin-bottom:2px">御請求金額</div>
          <div style="font-size:22px;font-weight:900;color:${EST_PDF_GREEN}">¥${fmt(c.total)}.-</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888;width:90px">請求日</td><td style="padding:5px 4px">${today}</td></tr>
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888">見積番号</td><td style="padding:5px 4px">${data.no||'　'}</td></tr>
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888">工事名</td><td style="padding:5px 4px">${data.projectName||'　'}</td></tr>
          <tr><td style="padding:5px 4px;color:#888">工事場所</td><td style="padding:5px 4px">${data.siteName||'　'}</td></tr>
        </table>
      </div>
      <div style="width:220px;text-align:right;font-size:11px;color:#555;line-height:1.7;flex-shrink:0">
        <div style="font-weight:800;font-size:13px;color:#222;margin-bottom:2px">${COMPANY.name}</div>
        <div>${COMPANY.zip}</div>
        <div>${COMPANY.address}</div>
        <div>TEL：${COMPANY.tel}</div>
        <div>FAX：${COMPANY.fax}</div>
        <div style="margin-bottom:6px">登録番号：${COMPANY.regNo}</div>
        <div style="text-align:left;border:1px solid ${EST_PDF_BORDER};border-radius:4px;padding:9px 10px;font-size:10px;color:#444;line-height:1.7">
          <div style="font-weight:700;color:#222;margin-bottom:3px">【振込先】</div>
          ${BANK_INFO.bank}　${BANK_INFO.type}<br>${BANK_INFO.no}<br>${BANK_INFO.holder}
        </div>
      </div>
    </div>`;

  const rows=data.sections.map(sec=>{
    const sTotal=sec.items.reduce((s,i)=>s+i.qty*i.price,0);
    return `<tr><td colspan="6" style="padding:7px 8px;background:#fff;font-weight:700;font-size:13px;color:${EST_PDF_GREEN};border-top:2px solid ${EST_PDF_GREEN}">${sec.name||'（工種未入力）'}</td></tr>
    ${estPdfItemRowsHtml(sec.items)}
    <tr style="background:${EST_PDF_GREEN_LIGHT}"><td colspan="5" style="padding:5px 8px;text-align:right;font-size:12px;color:#888">小計</td><td style="padding:5px 8px;text-align:right;font-weight:700;color:${EST_PDF_GREEN}">¥${fmt(sTotal)}</td></tr>`;
  }).join('');

  const totalsTable=estPdfTotalsTableHtml(c);

  document.getElementById('invoice-pdf-body').innerHTML = `<div style="font-family:${EST_PDF_FONT}">${header}
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;border:1px solid ${EST_PDF_BORDER}">
      <thead><tr style="background:${EST_PDF_GREEN}">${estPdfTableHeadCells()}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${totalsTable}
    <div style="margin-top:18px;font-size:11px;color:#888;text-align:center">上記の通りご請求申し上げます。</div>
  </div>`;
}

function printInvoicePdf(){
  const body=document.getElementById('invoice-pdf-body').innerHTML;
  printHtml('御請求書', body);
}
