// ════ 注文書・注文請書 出力 ════

function showChushoModal(){
  const proj = currentProjectName();
  if(!proj){ showToast('案件を選択してください'); return; }

  const related = (estimates||[]).filter(e => e.projectName === proj);
  if(!related.length){ showToast('この案件に見積がありません'); return; }

  if(related.length === 1){
    printChusho(related[0].id);
    return;
  }

  // 複数見積がある場合は選択モーダルを表示
  const overlay = document.createElement('div');
  overlay.id = 'chusho-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--surface);border-radius:12px;padding:24px;min-width:320px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,.25)';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:16px';
  title.textContent = '注文書に使用する見積を選択';

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:20px';

  related.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.cssText = 'text-align:left;padding:10px 14px;border-radius:8px;font-size:13px';
    const label = e.title || e.date || ('見積 #' + e.id);
    const amt = e.contractAmount ? '　¥' + fmt(e.contractAmount) : '';
    btn.textContent = label + amt;
    btn.onclick = () => {
      overlay.remove();
      printChusho(e.id);
    };
    list.appendChild(btn);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.onclick = () => overlay.remove();

  modal.appendChild(title);
  modal.appendChild(list);
  modal.appendChild(cancelBtn);
  overlay.appendChild(modal);
  overlay.onclick = ev => { if(ev.target===overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function currentProjectName(){
  const el = document.getElementById('est-project');
  return el ? el.value.trim() : '';
}

function printChusho(estId){
  const est = (estimates||[]).find(e => e.id === estId);
  if(!est){ showToast('見積データが見つかりません'); return; }

  const fmtDate = d => {
    if(!d) return '　　　年　　月　　日';
    const m = d.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(!m) return d;
    return `令和${parseInt(m[1])-2018}年${parseInt(m[2])}月${parseInt(m[3])}日`;
  };

  const fmtAmt = v => v ? '金　' + fmt(v) + '　円也' : '金　　　　　　　円也';

  const pays = est.payments||[];
  const payRows = [0,1,2].map(i => {
    const p = pays[i]||{};
    const when = p.date ? fmtDate(p.date) : '　　　年　　月　　日';
    const how  = p.method || '';
    const amt  = p.amount ? '¥' + fmt(p.amount) : '';
    return `<tr>
      <td class="label">第${['一','二','三'][i]}回</td>
      <td>${when}</td>
      <td>${how}</td>
      <td class="r">${amt}</td>
    </tr>`;
  }).join('');

  const contractDate = fmtDate(est.contractDate || est.date || '');
  const projectName  = esc(est.projectName||'');
  const siteName     = esc(est.siteName||'');
  const startDate    = fmtDate(est.startDate||'');
  const endDate      = fmtDate(est.endDate||'');
  const contractAmt  = fmtAmt(est.contractAmount||0);
  const clientName   = esc(est.clientName||'');

  // 注文書・注文請書 共通HTML生成
  const pageStyle = `
    @page { size: A4 portrait; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Meiryo","Yu Gothic",sans-serif; font-size: 10pt; color: #111; }
    .page { width: 100%; page-break-after: always; padding: 0; }
    .page:last-child { page-break-after: avoid; }
    h1 { font-size: 18pt; font-weight: 700; text-align: center; margin-bottom: 6mm; letter-spacing: .2em; }
    .date-line { text-align: right; margin-bottom: 8mm; font-size: 10pt; }
    .client-block { margin-bottom: 8mm; }
    .client-name { font-size: 14pt; font-weight: 700; border-bottom: 1.5pt solid #111; display: inline-block; min-width: 180px; padding-bottom: 2px; }
    .fields { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
    .fields td { padding: 4pt 6pt; vertical-align: top; }
    .fields .label { white-space: nowrap; font-weight: 700; width: 80px; }
    .fields .colon { width: 12px; }
    .fields tr { border-bottom: 0.5pt solid #ccc; }
    .pay-table { width: 100%; border-collapse: collapse; margin-top: 2mm; font-size: 9pt; }
    .pay-table th { background: #f0f0f0; text-align: center; padding: 3pt 5pt; border: 0.5pt solid #bbb; font-weight: 600; }
    .pay-table td { border: 0.5pt solid #bbb; padding: 3pt 5pt; }
    .pay-table td.label { text-align: center; }
    .pay-table td.r { text-align: right; }
    .sign-block { display: flex; gap: 12mm; justify-content: flex-end; margin-top: 12mm; }
    .sign-box { width: 160px; }
    .sign-box .sign-title { font-weight: 700; margin-bottom: 3mm; font-size: 9pt; }
    .sign-box table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    .sign-box td { border: 0.5pt solid #aaa; padding: 3pt 5pt; vertical-align: top; }
    .sign-box .lbl { background: #f5f5f5; font-weight: 600; white-space: nowrap; }
    .stamp-area { display: inline-block; border: 0.5pt solid #bbb; width: 40px; height: 40px; margin-left: 8px; vertical-align: middle; }
    .subtitle { font-size: 8pt; color: #555; text-align: center; margin-bottom: 4mm; }
  `;

  const chushoPage = `
<div class="page">
  <h1>注　文　書</h1>
  <div class="date-line">注文日：${contractDate}</div>
  <div class="client-block">
    <span class="client-name">${clientName}&nbsp;様</span>
  </div>
  <p style="margin-bottom:6mm;line-height:1.8">下記のとおり注文いたします。</p>
  <table class="fields">
    <tr>
      <td class="label">工事名称</td><td class="colon">：</td>
      <td>${projectName}</td>
    </tr>
    <tr>
      <td class="label">工事場所</td><td class="colon">：</td>
      <td>${siteName}</td>
    </tr>
    <tr>
      <td class="label">工事期間</td><td class="colon">：</td>
      <td>${startDate}　〜　${endDate}</td>
    </tr>
    <tr>
      <td class="label">請負金額</td><td class="colon">：</td>
      <td style="font-weight:700">${contractAmt}（税込）</td>
    </tr>
    <tr>
      <td class="label">内　　訳</td><td class="colon">：</td>
      <td>別紙見積書の内容とする</td>
    </tr>
  </table>
  <div style="font-weight:700;margin-bottom:2mm">支払方法</div>
  <table class="pay-table">
    <thead>
      <tr>
        <th style="width:60px">支払回</th>
        <th>支払日</th>
        <th>支払方法</th>
        <th style="width:100px">金額</th>
      </tr>
    </thead>
    <tbody>${payRows}</tbody>
  </table>
  <div class="sign-block">
    <div class="sign-box">
      <div class="sign-title">注文者</div>
      <table>
        <tr><td class="lbl">住&ensp;所</td><td>${esc(est.clientAddress||'')}</td></tr>
        <tr><td class="lbl">氏&ensp;名</td>
          <td>${clientName}<span class="stamp-area"></span></td>
        </tr>
      </table>
    </div>
  </div>
</div>`;

  const ukeshoPage = `
<div class="page">
  <h1>注文請書</h1>
  <div class="date-line">請書日：${contractDate}</div>
  <div class="client-block">
    <span class="client-name">${clientName}&nbsp;様</span>
  </div>
  <p style="margin-bottom:6mm;line-height:1.8">下記のとおり請け負いいたします。</p>
  <table class="fields">
    <tr>
      <td class="label">工事名称</td><td class="colon">：</td>
      <td>${projectName}</td>
    </tr>
    <tr>
      <td class="label">工事場所</td><td class="colon">：</td>
      <td>${siteName}</td>
    </tr>
    <tr>
      <td class="label">工事期間</td><td class="colon">：</td>
      <td>${startDate}　〜　${endDate}</td>
    </tr>
    <tr>
      <td class="label">請負金額</td><td class="colon">：</td>
      <td style="font-weight:700">${contractAmt}（税込）</td>
    </tr>
    <tr>
      <td class="label">内　　訳</td><td class="colon">：</td>
      <td>別紙見積書の内容とする</td>
    </tr>
  </table>
  <div style="font-weight:700;margin-bottom:2mm">支払方法</div>
  <table class="pay-table">
    <thead>
      <tr>
        <th style="width:60px">支払回</th>
        <th>支払日</th>
        <th>支払方法</th>
        <th style="width:100px">金額</th>
      </tr>
    </thead>
    <tbody>${payRows}</tbody>
  </table>
  <div class="sign-block">
    <div class="sign-box">
      <div class="sign-title">注文者</div>
      <table>
        <tr><td class="lbl">住&ensp;所</td><td>${esc(est.clientAddress||'')}</td></tr>
        <tr><td class="lbl">氏&ensp;名</td>
          <td>${clientName}<span class="stamp-area"></span></td>
        </tr>
      </table>
    </div>
    <div class="sign-box">
      <div class="sign-title">請負者</div>
      <table>
        <tr><td class="lbl">住&ensp;所</td><td>広島県広島市安佐北区可部2-13-31-1</td></tr>
        <tr><td class="lbl">社&ensp;名</td><td>株式会社きよかわ</td></tr>
        <tr><td class="lbl">代&ensp;表</td>
          <td>代表取締役　清川創史<span class="stamp-area"></span></td>
        </tr>
        <tr><td class="lbl">TEL</td><td>082-815-6080</td></tr>
        <tr><td class="lbl">FAX</td><td>082-815-6081</td></tr>
        <tr><td class="lbl">Mail</td><td>info@kiyokawanoie.com</td></tr>
      </table>
    </div>
  </div>
</div>`;

  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>注文書・注文請書</title>
<style>${pageStyle}</style>
</head><body>
${chushoPage}
${ukeshoPage}
<script>window.onload=function(){ window.print(); setTimeout(()=>window.close(),800); }<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if(!w){ showToast('ポップアップをブロックされています。許可してください'); return; }
  w.document.write(html);
  w.document.close();
}
