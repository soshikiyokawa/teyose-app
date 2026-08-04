// ════ 業者の見積を読み取って明細に入れる ════
//
// 業者からもらった見積（PDF・写真）を読み取り、「品目・規格・数量・単位・単価」を出す。
// 業者の単価はこちらの原価になるので、原価として明細に入れる。
// 売価は今までどおり「原価 ÷（1−粗利率）」で自動計算する。
//
// 読み取った内容をそのまま入れることはしない。必ず一覧で確認して、
// チェックした行だけを、選んだ工種に追加する。

let _qiItems = [];      // 読み取った行
let _qiSupplier = '';   // 業者名（読み取れた場合）

function openQuoteImport(){
  if(!sections){ showToast('先に見積を開いてください'); return; }
  document.getElementById('qi-file').value = '';
  document.getElementById('qi-body').innerHTML =
    `<div style="font-size:12px;color:var(--text-sub);line-height:1.8">
       業者からの見積（PDF・写真）を選ぶと、品目・数量・単位・単価を読み取ります。<br>
       読み取った<b>単価はこちらの原価</b>として扱います。売価は粗利率から自動で計算します。<br>
       <span style="color:var(--warn-t)">読み取りは間違えることがあります。必ず金額をご確認ください。</span>
     </div>`;
  document.getElementById('qi-foot').style.display = 'none';
  document.getElementById('quote-import-modal').classList.add('open');
}
function closeQuoteImport(){
  document.getElementById('quote-import-modal').classList.remove('open');
  _qiItems = []; _qiSupplier = '';
}

// ファイルを選んだら読み取りに出す
async function qiFileChosen(input){
  const file = input.files?.[0];
  if(!file) return;
  if(file.size > 12 * 1024 * 1024){ showToast('ファイルが大きすぎます（12MBまで）'); return; }

  document.getElementById('qi-body').innerHTML =
    `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text-sub)">
       読み取っています…（10〜30秒ほどかかります）
     </div>`;
  try{
    const base64 = await fileToBase64(file);
    const { data, error } = await sb.functions.invoke('read-quote', {
      body: { file: base64, mediaType: file.type || 'application/pdf' }
    });
    if(error){
      const m = error.message||'';
      throw new Error(/Failed to send|NetworkError|Failed to fetch/i.test(m)
        ? '読み取りの機能がまだ入っていません。read-quote をデプロイしてください' : m);
    }
    if(data?.error) throw new Error(data.error);
    if(!data?.items?.length){
      document.getElementById('qi-body').innerHTML =
        `<div style="padding:16px;font-size:12px;color:var(--text-sub);line-height:1.8">
           明細を読み取れませんでした。<br>
           写真の場合は、明細の表が全部入るように撮り直すと読み取れることがあります。
         </div>`;
      return;
    }
    _qiSupplier = data.supplier || '';
    _qiItems = data.items.map((it,i)=>({
      _id:'qi'+i, pick:true,
      section: it.section||'',
      name: it.name||'',
      spec: it.spec||'',
      qty: Number(it.qty)||1,
      unit: it.unit||'式',
      cost: (it.cost==null ? null : Number(it.cost)),
      amount: (it.amount==null ? null : Number(it.amount))
    }));
    renderQuoteImport(data.total);
  }catch(e){
    showToast('読み取りに失敗しました：'+(e?.message||e));
    closeQuoteImport();
  }finally{
    input.value = '';
  }
}

function renderQuoteImport(total){
  const missing = _qiItems.filter(i=>i.cost==null).length;
  const sum = _qiItems.filter(i=>i.pick).reduce((s,i)=>s+(i.cost||0)*i.qty, 0);

  // 追加先の工種：いまある工種か、見積書の分類でつくる
  const secOpts = (sections||[]).map(s=>`<option value="${s.id}">${esc(s.name||'（名前なし）')}</option>`).join('');
  const readSecs = [...new Set(_qiItems.map(i=>i.section).filter(Boolean))];

  document.getElementById('qi-body').innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);line-height:1.8;margin-bottom:8px">
      ${_qiSupplier?`<b>${esc(_qiSupplier)}</b>の見積から `:''}${_qiItems.length}行を読み取りました。
      ${total?`<span style="color:var(--text-muted)">（見積書の合計 ¥${fmt(total)}）</span>`:''}
      ${missing?`<br><span style="color:var(--danger)">単価を読み取れなかった行が${missing}件あります。金額を入れてください</span>`:''}
      <br><span style="color:var(--warn-t)">読み取りは間違えることがあります。金額をご確認のうえ取り込んでください。</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <span style="font-size:11px;color:var(--text-sub)">追加先</span>
      <select id="qi-target" onchange="renderQuoteImportFoot()" style="width:auto;font-size:12px;padding:3px 6px">
        ${readSecs.length?`<option value="__read">見積書の分類ごとに新しい工種をつくる（${readSecs.map(esc).join('・')}）</option>`:''}
        <option value="__new">新しい工種をつくる</option>
        ${secOpts}
      </select>
      <span style="font-size:11px;color:var(--text-sub);margin-left:6px">粗利率</span>
      <input type="number" id="qi-margin" value="30" min="0" max="99" style="width:60px;font-size:12px;padding:3px 6px;text-align:right">
      <span style="font-size:11px;color:var(--text-sub)">%</span>
      <button class="btn xs" onclick="qiPickAll(true)" style="margin-left:auto">すべて選ぶ</button>
      <button class="btn xs" onclick="qiPickAll(false)">すべて外す</button>
    </div>
    <div style="max-height:46vh;overflow-y:auto">${_qiItems.map(qiRowHtml).join('')}</div>
    <div style="font-size:12px;font-weight:700;text-align:right;margin-top:8px">
      選んだ行の原価合計 <span style="color:var(--wood-t)">¥${fmt(sum)}</span>
    </div>`;
  document.getElementById('qi-foot').style.display = '';
  renderQuoteImportFoot();
}

function qiRowHtml(r){
  return `<label class="master-item" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
    <input type="checkbox" ${r.pick?'checked':''} onchange="qiTogglePick('${r._id}',this.checked)"
           style="width:auto;margin:3px 0 0;flex:none">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:700">${esc(r.name)}
        ${r.spec?`<span style="font-weight:400;color:var(--text-muted)">　${esc(r.spec)}</span>`:''}</div>
      ${r.section?`<div style="font-size:10px;color:var(--text-muted)">${esc(r.section)}</div>`:''}
      <div style="display:flex;align-items:center;gap:4px;margin-top:3px;flex-wrap:wrap">
        <input type="number" value="${r.qty}" step="0.01" onchange="qiEdit('${r._id}','qty',this.value)"
               style="width:62px;font-size:11px;padding:2px 4px;text-align:right">
        <input type="text" value="${esc(r.unit)}" onchange="qiEdit('${r._id}','unit',this.value)"
               style="width:48px;font-size:11px;padding:2px 4px">
        <span style="font-size:11px;color:var(--text-sub)">×</span>
        <input type="number" value="${r.cost==null?'':r.cost}" placeholder="単価"
               onchange="qiEdit('${r._id}','cost',this.value)"
               style="width:88px;font-size:11px;padding:2px 4px;text-align:right;${r.cost==null?'border-color:var(--danger)':''}">
        <span style="font-size:11px;color:var(--text-muted)">円</span>
        <span style="font-size:11px;color:var(--text-sub);margin-left:auto">＝ ¥${fmt(Math.round((r.cost||0)*r.qty))}</span>
      </div>
    </div>
  </label>`;
}

function qiTogglePick(id,on){
  const r=_qiItems.find(x=>x._id===id); if(r) r.pick=on;
  renderQuoteImportFoot();
  qiUpdateSum();
}
function qiPickAll(on){ _qiItems.forEach(r=>r.pick=on); renderQuoteImport(); }
function qiEdit(id,field,val){
  const r=_qiItems.find(x=>x._id===id); if(!r) return;
  if(field==='unit') r.unit=String(val||'式');
  else r[field] = val==='' ? (field==='cost'?null:1) : Number(val);
  qiUpdateSum();
  renderQuoteImportFoot();
}
function qiUpdateSum(){
  const sum=_qiItems.filter(i=>i.pick).reduce((s,i)=>s+(i.cost||0)*i.qty,0);
  const el=document.querySelector('#qi-body > div:last-child span');
  if(el) el.textContent='¥'+fmt(sum);
}
// 取り込みボタンの出し分け（単価が空のまま選ばれていたら止める）
function renderQuoteImportFoot(){
  const picked=_qiItems.filter(i=>i.pick);
  const bad=picked.filter(i=>i.cost==null).length;
  const btn=document.getElementById('qi-apply');
  if(!btn) return;
  btn.disabled = !picked.length || bad>0;
  btn.textContent = bad>0 ? `単価が空の行が${bad}件あります`
    : picked.length ? `${picked.length}行を明細に追加` : '行を選んでください';
}

// 明細に追加する
function applyQuoteImport(){
  const picked=_qiItems.filter(i=>i.pick && i.cost!=null);
  if(!picked.length){ showToast('追加する行を選んでください'); return; }
  const margin=Math.min(99, Math.max(0, parseFloat(document.getElementById('qi-margin').value)||0));
  const target=document.getElementById('qi-target').value;

  const addTo=(sec, r)=>{
    sec.items.push({id:itemSeq++, name:r.name, spec:r.spec||'', unit:r.unit||'式',
      qty:Number(r.qty)||1, cost:Math.round(r.cost), margin,
      price:calcPrice(Math.round(r.cost), margin)});
  };
  const newSection=(name)=>{
    const sec={id:secSeq++, name:name||(_qiSupplier?`${_qiSupplier}見積`:'業者見積'), open:true, items:[]};
    sections.push(sec);
    return sec;
  };

  if(target==='__read'){
    // 見積書の分類ごとに工種をつくる
    const byName={};
    picked.forEach(r=>{
      const key=r.section||(_qiSupplier?`${_qiSupplier}見積`:'業者見積');
      if(!byName[key]) byName[key]=newSection(key);
      addTo(byName[key], r);
    });
  } else if(target==='__new'){
    const sec=newSection('');
    picked.forEach(r=>addTo(sec, r));
  } else {
    const sec=sections.find(s=>String(s.id)===String(target));
    if(!sec){ showToast('追加先の工種が見つかりません'); return; }
    picked.forEach(r=>addTo(sec, r));
  }

  estDirty=true;
  closeQuoteImport();
  renderSections();
  showToast(`${picked.length}行を明細に追加しました。金額をご確認ください`);
}
