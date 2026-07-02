// ════ 見積：明細入力（工種セクション・行）の編集と描画 ════

// 原価→粗利率→単価（10円切り上げ）
function calcPrice(cost,margin){
  if(!cost||margin>=100) return 0;
  return Math.ceil(cost/(1-margin/100)/10)*10;
}

function addSection(name=''){
  sections.push({id:secSeq++,name:name||'',open:true,items:[]});
  const sec=sections[sections.length-1];
  sec.items.push({id:itemSeq++,name:'',spec:'',unit:'式',qty:1,cost:0,margin:30,price:0});
  estDirty=true;
  renderSections();
}

function addItem(secId){
  const sec=sections.find(s=>s.id===secId);
  if(sec) sec.items.push({id:itemSeq++,name:'',spec:'',unit:'式',qty:1,cost:0,margin:30,price:0});
  estDirty=true;
  renderSections();
}

function removeItem(secId,itemId){
  const sec=sections.find(s=>s.id===secId);
  if(sec) sec.items=sec.items.filter(i=>i.id!==itemId);
  estDirty=true;
  renderSections();
}

function removeSection(secId){
  if(!confirm('このセクションを削除しますか？')) return;
  sections=sections.filter(s=>s.id!==secId);
  estDirty=true;
  renderSections();
}

function updateItem(secId,itemId,field,val){
  estDirty=true;
  const sec=sections.find(s=>s.id===secId);if(!sec)return;
  const item=sec.items.find(i=>i.id===itemId);if(!item)return;
  if(['qty','cost','margin','price'].includes(field)) item[field]=parseFloat(val)||0;
  else item[field]=val;
  if(field==='name'){
    // 同じ工種のリストから選択された場合、単位・原価を自動入力
    const preset=(estimatePresets||[]).find(p=>p.cat===sec.name && p.name===val && p.workType===currentEstWorkType());
    if(preset){item.unit=preset.unit;item.cost=Number(preset.cost);}
  }
  if(field==='cost'||field==='margin'||field==='name') item.price=calcPrice(item.cost,item.margin);
  setTimeout(renderSections,150);
}

// テキスト入力中はデータだけ更新。品目名がプリセットと一致した場合のみ再描画する
function updateItemText(secId,itemId,field,val){
  const sec=sections.find(s=>s.id===secId);if(!sec)return;
  const item=sec.items.find(i=>i.id===itemId);if(!item)return;
  item[field]=val;
  estDirty=true;
  if(field==='name'){
    const preset=(estimatePresets||[]).find(p=>p.cat===sec.name && p.name===val && p.workType===currentEstWorkType());
    if(preset){
      item.unit=preset.unit;item.cost=Number(preset.cost);
      item.price=calcPrice(item.cost,item.margin);
      renderSections();
    }
  }
}

// 編集中の見積の工事区分（新築／リフォーム等）。未取得時は「新築」扱い
function currentEstWorkType(){
  return document.getElementById('est-type')?.value || '新築';
}

// 工種名のリスト候補（datalist）を更新。リストに無いものは自由記述可。
// 編集中の見積の工事区分に登録された工種・工事品目だけを候補にする
function renderPresetDatalists(){
  const catEl=document.getElementById('sec-cat-list');
  if(!catEl) return;
  const type=currentEstWorkType();
  catEl.innerHTML=(estimateCategories||[]).filter(c=>c.workType===type).map(c=>`<option value="${esc(c.name)}">`).join('');
}

function updateSecName(secId,val){const sec=sections.find(s=>s.id===secId);if(sec){sec.name=val;estDirty=true;}}
function toggleSec(secId){const sec=sections.find(s=>s.id===secId);if(sec){sec.open=!sec.open;renderSections();}}

// 工種（セクション）の並び替え
function estDragStartSec(secId){ dragSrcSecId=secId; }
function estDropSec(targetSecId){
  if(dragSrcSecId===null||dragSrcSecId===targetSecId) return;
  const fromIdx=sections.findIndex(s=>s.id===dragSrcSecId);
  const toIdx=sections.findIndex(s=>s.id===targetSecId);
  if(fromIdx<0||toIdx<0) return;
  const [moved]=sections.splice(fromIdx,1);
  sections.splice(toIdx,0,moved);
  dragSrcSecId=null;
  renderSections();
}

// 明細行（品目）の並び替え（同じ工種内のみ）
function estDragStartItem(secId,itemId){ dragSrcItemSecId=secId; dragSrcItemId=itemId; }
function estDropItem(secId,itemId){
  if(dragSrcItemSecId!==secId||dragSrcItemId===null||dragSrcItemId===itemId) return;
  const sec=sections.find(s=>s.id===secId); if(!sec) return;
  const fromIdx=sec.items.findIndex(i=>i.id===dragSrcItemId);
  const toIdx=sec.items.findIndex(i=>i.id===itemId);
  if(fromIdx<0||toIdx<0) return;
  const [moved]=sec.items.splice(fromIdx,1);
  sec.items.splice(toIdx,0,moved);
  dragSrcItemSecId=null;dragSrcItemId=null;
  renderSections();
}

function renderSections(){
  const wrap=document.getElementById('sections-wrap');
  let gTotal=0,gCost=0;
  wrap.innerHTML=sections.map(sec=>{
    const sTotal=sec.items.reduce((s,i)=>s+i.qty*i.price,0);
    const sCost=sec.items.reduce((s,i)=>s+i.qty*i.cost,0);
    gTotal+=sTotal;gCost+=sCost;
    const sMargin=sTotal>0?((sTotal-sCost)/sTotal*100):0;
    const secPresets=(estimatePresets||[]).filter(p=>p.cat===sec.name && p.workType===currentEstWorkType());
    const secDatalistId=`item-presets-list-${sec.id}`;
    const rows=sec.items.map(item=>{
      const mc=item.price>0?((item.price-item.cost)/item.price*100):0;
      const mc_col=mc>=25?'var(--accent-t)':mc>=15?'var(--warn-t)':'var(--danger)';
      return `<tr ondragover="event.preventDefault()" ondrop="estDropItem(${sec.id},${item.id})">
        <td draggable="true" ondragstart="estDragStartItem(${sec.id},${item.id})" style="width:18px;text-align:center;cursor:grab;color:var(--text-muted)" title="ドラッグで並び替え">⠿</td>
        <td><input type="text" list="${secDatalistId}" value="${esc(item.name)}" placeholder="工事・品目名（リストから選択 または自由入力）" oninput="updateItemText(${sec.id},${item.id},'name',this.value)" style="min-width:100px"></td>
        <td><input type="text" value="${esc(item.spec)}" placeholder="規格・仕様" oninput="updateItemText(${sec.id},${item.id},'spec',this.value)" style="min-width:70px"></td>
        <td class="num"><input type="number" value="${item.qty}" min="0" step="1" onchange="updateItem(${sec.id},${item.id},'qty',this.value)" style="width:48px;text-align:right"></td>
        <td><select onchange="updateItem(${sec.id},${item.id},'unit',this.value)" style="width:48px">${['式','本','枚','坪','台','箱','袋','巻','梱','セット','ヶ所','個','m','㎡','m³','kg','t','人工'].map(u=>`<option${u===item.unit?' selected':''}>${u}</option>`).join('')}</select></td>
        <td class="num"><input type="number" value="${item.cost}" min="0" step="100" onchange="updateItem(${sec.id},${item.id},'cost',this.value)" style="width:78px;text-align:right"></td>
        <td class="num"><input type="number" value="${item.margin}" min="0" max="99" step="1" onchange="updateItem(${sec.id},${item.id},'margin',this.value)" style="width:42px;text-align:right;color:${mc_col};font-weight:700"><span style="font-size:10px;color:var(--text-muted)">%</span></td>
        <td class="num" style="color:var(--wood-t);font-weight:600;padding-right:6px">¥${fmt(item.price)}</td>
        <td class="amt">¥${fmt(item.qty*item.price)}</td>
        <td style="width:24px;text-align:center"><button class="btn danger xs" onclick="removeItem(${sec.id},${item.id})" style="padding:2px 5px">×</button></td>
      </tr>`;}).join('');
    return `<div class="section-block">
      <div class="section-head" ondragover="event.preventDefault()" ondrop="estDropSec(${sec.id})">
        <span draggable="true" ondragstart="estDragStartSec(${sec.id})" style="cursor:grab;color:var(--text-muted);padding:0 2px" title="ドラッグで工種の順序を変更">⠿</span>
        <button class="sec-toggle" onclick="toggleSec(${sec.id})">${sec.open?'▾':'▸'}</button>
        <input class="sec-name" type="text" list="sec-cat-list" value="${esc(sec.name)}" placeholder="工種名（例：仮設工事）" oninput="updateSecName(${sec.id},this.value)">
        <span style="font-size:11px;color:var(--accent-t);font-weight:700;white-space:nowrap;margin-right:4px">粗利 ${sMargin.toFixed(1)}%</span>
        <span style="font-size:12px;font-weight:700;color:var(--wood-t);white-space:nowrap">¥${fmt(sTotal)}</span>
        <button class="btn danger xs" onclick="removeSection(${sec.id})" style="padding:2px 6px;margin-left:4px">削除</button>
      </div>
      <datalist id="${secDatalistId}">${secPresets.map(p=>`<option value="${esc(p.name)}">`).join('')}</datalist>
      ${sec.open?`<div class="items-wrap">
        <table class="items-table">
          <thead><tr>
            <th style="width:18px"></th><th>工事・品目名</th><th>規格・仕様</th>
            <th class="r" style="width:52px">数量</th><th style="width:50px">単位</th>
            <th class="r" style="width:86px">原価（円）</th>
            <th class="r" style="width:60px">粗利率</th>
            <th class="r" style="width:86px">単価（円）</th>
            <th class="r" style="width:86px">金額（円）</th>
            <th style="width:26px"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="add-row-btn" onclick="addItem(${sec.id})">＋ 行を追加</button>
      </div>
      <div class="sec-foot">
        <span class="muted">原価：¥${fmt(sCost)}</span>
        <span style="color:var(--accent-t)">粗利：¥${fmt(sTotal-sCost)}（${sMargin.toFixed(1)}%）</span>
        <span>小計：¥${fmt(sTotal)}</span>
      </div>`:''}
    </div>`;
  }).join('');
  const gMargin=gTotal>0?((gTotal-gCost)/gTotal*100):0;
  document.getElementById('est-grand').textContent=`¥${fmt(gTotal)}　粗利 ${gMargin.toFixed(1)}%`;
}
