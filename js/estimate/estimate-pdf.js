// ════ 見積：見積書PDFプレビュー・印刷 ════
// 配色：緑系（添付の参考デザインの配色を緑に変更したもの）

const EST_PDF_GREEN = '#2f6b4d';
const EST_PDF_GREEN_LIGHT = '#eef5f0';
const EST_PDF_BORDER = '#d7e3da';

let _estPdfData=null, _estPdfCalc=null;

function openEstPdf(){
  _estPdfData=collectEstData();
  _estPdfCalc=recalcSum();
  renderEstPdfBody();
  document.getElementById('est-pdf-overlay').classList.add('open');
}
function closeEstPdf(){document.getElementById('est-pdf-overlay').classList.remove('open');}

function estPdfHeaderHtml(data){
  return `
    <div style="background:${EST_PDF_GREEN};color:#fff;text-align:center;padding:14px 0;margin-bottom:18px;border-radius:3px">
      <div style="font-size:24px;font-weight:900;letter-spacing:.3em">御 見 積 書</div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:18px;margin-bottom:14px">
      <div style="flex:1">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:6px 4px;color:#888;width:90px">施主名</td><td style="padding:6px 4px;font-weight:700">${data.clientName||'　'}　様</td></tr>
        </table>
        <div style="background:${EST_PDF_GREEN_LIGHT};border:1px solid ${EST_PDF_BORDER};border-radius:4px;padding:10px 14px;margin:8px 0">
          <div style="font-size:11px;color:#888;margin-bottom:2px">御見積金額</div>
          <div style="font-size:22px;font-weight:900;color:${EST_PDF_GREEN}">¥${fmt(_estPdfCalc.total)}.-</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888;width:90px">消費税</td><td style="padding:5px 4px">¥${fmt(_estPdfCalc.tax)}</td></tr>
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888">見積番号</td><td style="padding:5px 4px">${data.no||'　'}</td></tr>
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888">工事名</td><td style="padding:5px 4px">${data.projectName||'　'}</td></tr>
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888">工事場所</td><td style="padding:5px 4px">${data.siteName||'　'}</td></tr>
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888">工事期間</td><td style="padding:5px 4px">${data.startDate||'　'}　〜　${data.endDate||'　'}</td></tr>
          <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:5px 4px;color:#888">有効期限</td><td style="padding:5px 4px">${data.expire?data.expire+'まで':'発行日から1ヶ月'}</td></tr>
          ${data.note?`<tr><td style="padding:5px 4px;color:#888;vertical-align:top">備考</td><td style="padding:5px 4px">${data.note}</td></tr>`:''}
        </table>
      </div>
      <div style="width:200px;text-align:right;font-size:11px;color:#555;line-height:1.7;flex-shrink:0">
        <div style="font-weight:800;font-size:13px;color:#222;margin-bottom:2px">${COMPANY.name}</div>
        <div>${COMPANY.zip} ${COMPANY.address}</div>
        <div>TEL：${COMPANY.tel}</div>
        <div style="color:${EST_PDF_GREEN}">${COMPANY.url}</div>
        <div style="margin-top:10px;color:#888">工事区分：${data.type}</div>
      </div>
    </div>`;
}

function estPdfTotalsTableHtml(c){
  return `
    <table style="width:260px;margin-left:auto;border-collapse:collapse;font-size:13px;border:1px solid ${EST_PDF_BORDER}">
      <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:6px 9px;color:#666">工事費 小計</td><td style="padding:6px 9px;text-align:right">¥${fmt(c.wTotal)}</td></tr>
      <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:6px 9px;color:#666">出精値引き</td><td style="padding:6px 9px;text-align:right">${c.discount?'-¥'+fmt(c.discount):'¥0'}</td></tr>
      <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:6px 9px;color:#666">税抜合計</td><td style="padding:6px 9px;text-align:right">¥${fmt(c.sub2)}</td></tr>
      <tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:6px 9px;color:#666">消費税（${c.taxRate}%）</td><td style="padding:6px 9px;text-align:right">¥${fmt(c.tax)}</td></tr>
      <tr style="background:${EST_PDF_GREEN}"><td style="padding:9px;font-weight:800;color:#fff;font-size:14px">合計金額</td><td style="padding:9px;text-align:right;font-weight:800;color:#fff;font-size:16px">¥${fmt(c.total)}</td></tr>
    </table>`;
}

function estPdfFootHtml(data){
  return `
    ${data.payments&&data.payments.some(p=>p.date||p.amount)?`
    <div style="margin-top:14px;border-top:1px solid ${EST_PDF_BORDER};padding-top:10px">
      <div style="font-size:12px;font-weight:700;color:#222;margin-bottom:4px">入金予定</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tbody>${data.payments.map(p=>`<tr><td style="padding:3px 7px;color:#666;width:90px">${p.label}</td><td style="padding:3px 7px;color:#666">${p.date||'　'}</td><td style="padding:3px 7px;text-align:right;font-weight:600">¥${fmt(p.amount)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`:''}
    <div style="margin-top:18px;font-size:11px;color:#888;text-align:center">上記の通り御見積申し上げます。</div>`;
}

function estPdfTableHeadCells(){
  return `
    <th style="padding:7px 8px;text-align:left;color:#fff;font-size:11px">工事・品目名</th>
    <th style="padding:7px 8px;text-align:left;color:#fff;font-size:11px">規格・仕様</th>
    <th style="padding:7px 8px;text-align:right;color:#fff;font-size:11px">数量</th>
    <th style="padding:7px 8px;color:#fff;font-size:11px">単位</th>
    <th style="padding:7px 8px;text-align:right;color:#fff;font-size:11px">単価</th>
    <th style="padding:7px 8px;text-align:right;color:#fff;font-size:11px">金額</th>`;
}

function estPdfItemRowsHtml(items){
  return items.map(i=>`<tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:6px 8px">${i.name}</td><td style="padding:6px 8px;color:#666">${i.spec}</td><td style="padding:6px 8px;text-align:right">${i.qty}</td><td style="padding:6px 8px">${i.unit}</td><td style="padding:6px 8px;text-align:right">¥${fmt(i.price)}</td><td style="padding:6px 8px;text-align:right;font-weight:600">¥${fmt(i.qty*i.price)}</td></tr>`).join('');
}

function estPdfItemTableHtml(items){
  return `
    <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid ${EST_PDF_BORDER}">
      <thead><tr style="background:${EST_PDF_GREEN}">${estPdfTableHeadCells()}</tr></thead>
      <tbody>${estPdfItemRowsHtml(items)}</tbody>
    </table>`;
}

function renderEstPdfBody(){
  const mode=document.getElementById('est-pdf-mode').value;
  const data=_estPdfData, c=_estPdfCalc;
  if(!data||!c) return;
  const header=estPdfHeaderHtml(data);
  const totalsTable=estPdfTotalsTableHtml(c);
  const foot=estPdfFootHtml(data);

  if(mode==='summary'){
    // ① 1ページ目：工種一覧＋合計金額まで／2ページ目以降：工種ごとに1ページ
    const catRows=data.sections.map(sec=>{
      const sTotal=sec.items.reduce((s,i)=>s+i.qty*i.price,0);
      return `<tr style="border-bottom:1px solid ${EST_PDF_BORDER}"><td style="padding:8px 9px">${sec.name||'（工種未入力）'}</td><td style="padding:8px 9px;text-align:right">¥${fmt(sTotal)}</td></tr>`;
    }).join('');
    const page1=`${header}
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;border:1px solid ${EST_PDF_BORDER}">
        <thead><tr style="background:${EST_PDF_GREEN}"><th style="padding:8px 9px;text-align:left;color:#fff;font-size:11px">工事内容</th><th style="padding:8px 9px;text-align:right;color:#fff;font-size:11px">見積金額（税抜）</th></tr></thead>
        <tbody>${catRows}</tbody>
      </table>
      ${totalsTable}`;
    const detailPages=data.sections.map(sec=>{
      const sTotal=sec.items.reduce((s,i)=>s+i.qty*i.price,0);
      return `<div style="page-break-before:always;padding-top:6px">
        <div style="font-size:16px;font-weight:800;color:${EST_PDF_GREEN};margin-bottom:10px;border-bottom:2px solid ${EST_PDF_GREEN};padding-bottom:6px">${sec.name||'（工種未入力）'}</div>
        ${estPdfItemTableHtml(sec.items)}
        <div style="text-align:right;font-size:13px;font-weight:700;color:${EST_PDF_GREEN};margin-top:8px">小計：¥${fmt(sTotal)}</div>
      </div>`;
    }).join('');
    document.getElementById('est-pdf-body').innerHTML = page1 + detailPages + `<div style="page-break-before:always;padding-top:6px">${foot}</div>`;
  } else {
    // ② 全工種・全明細を通しで表示
    const rows=data.sections.map(sec=>{
      const sTotal=sec.items.reduce((s,i)=>s+i.qty*i.price,0);
      return `<tr><td colspan="6" style="padding:7px 8px;background:${EST_PDF_GREEN_LIGHT};font-weight:700;font-size:13px;color:${EST_PDF_GREEN};border-top:2px solid ${EST_PDF_GREEN}">${sec.name||'（工種未入力）'}</td></tr>
      ${estPdfItemRowsHtml(sec.items)}
      <tr style="background:${EST_PDF_GREEN_LIGHT}"><td colspan="5" style="padding:5px 8px;text-align:right;font-size:12px;color:#888">小計</td><td style="padding:5px 8px;text-align:right;font-weight:700;color:${EST_PDF_GREEN}">¥${fmt(sTotal)}</td></tr>`;
    }).join('');
    document.getElementById('est-pdf-body').innerHTML = `${header}
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;border:1px solid ${EST_PDF_BORDER}">
        <thead><tr style="background:${EST_PDF_GREEN}">${estPdfTableHeadCells()}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${totalsTable}
      ${foot}`;
  }
}

function printEstPdf(){
  const body=document.getElementById('est-pdf-body').innerHTML;
  printHtml('御見積書', body);
}
