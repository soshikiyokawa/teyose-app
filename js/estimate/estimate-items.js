// ════ 見積：明細入力（工種セクション・行）の編集と描画 ════

// 原価→粗利率→単価（10円切り上げ）
function calcPrice(cost,margin){
  if(!cost||margin>=100) return 0;
  return Math.ceil(cost/(1-margin/100)/10)*10;
}

// 再描画前にフォーカス中テキスト入力の値をモデルに確実に反映する
// itemNameFocus で一時的にクリアされた状態（dataset.prev あり & value 空）はスキップ
function syncActiveTextInput(){
  const el=document.activeElement;
  if(el && el.tagName==='INPUT' && el.type==='text'){
    if(el.dataset.prev !== undefined && el.value === '') return;
    el.dispatchEvent(new Event('input',{bubbles:true}));
  }
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
    const preset=(estimatePresets||[]).find(p=>p.cat===sec.name && p.name===val && p.workType===currentEstWorkType());
    if(preset){item.unit=preset.unit;item.cost=Number(preset.cost);}
  }
  if(field==='cost'||field==='margin'||field==='name') item.price=calcPrice(item.cost,item.margin);
  renderSections();
}

// 品目名inputのフォーカス時：一時的にクリアして全候補を表示
function itemNameFocus(el){
  el.dataset.prev = el.value;
  el.value = '';
}
// 品目名inputのブラー時：何も入力しなかった場合は元の値に戻す
function itemNameBlur(el){
  if(el.value === '' && el.dataset.prev !== undefined){
    el.value = el.dataset.prev;
  }
  delete el.dataset.prev;
}

// 単位選択変更：データだけ更新（再描画不要）
function updateItemUnit(secId,itemId,val){
  const sec=sections.find(s=>s.id===secId);if(!sec)return;
  const item=sec.items.find(i=>i.id===itemId);if(!item)return;
  item.unit=val;
  estDirty=true;
}

// テキスト入力中はデータだけ更新（再描画なし）。プリセット一致時はDOM直接更新
function updateItemText(secId,itemId,field,val){
  const sec=sections.find(s=>s.id===secId);if(!sec)return;
  const item=sec.items.find(i=>i.id===itemId);if(!item)return;
  item[field]=val;
  estDirty=true;
  if(field==='name'){
    const preset=(estimatePresets||[]).find(p=>p.cat===sec.name && p.name===val && p.workType===currentEstWorkType());
    if(preset){
      item.unit=preset.unit;item.cost=Number(preset.cost);item.price=calcPrice(item.cost,item.margin);
      // 全再描画せず対象行のDOMだけ更新（フォーカスを奪わないため）
      const unitEl=document.getElementById('item-unit-'+itemId);
      const costEl=document.getElementById('item-cost-'+itemId);
      const priceEl=document.getElementById('item-price-'+itemId);
      const amtEl=document.getElementById('item-amt-'+itemId);
      if(unitEl) unitEl.value=item.unit;
      if(costEl) costEl.value=fmt(item.cost);
      if(priceEl) priceEl.textContent='¥'+fmt(item.price);
      if(amtEl) amtEl.textContent='¥'+fmt(item.qty*item.price);
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

// 工種内の全行の粗利率を一括変更
function setSecMargin(secId,val){
  const margin=parseFloat(val);
  if(isNaN(margin)||margin<0||margin>=100) return;
  const sec=sections.find(s=>s.id===secId);if(!sec)return;
  sec.items.forEach(item=>{item.margin=margin;item.price=calcPrice(item.cost,margin);});
  estDirty=true;
  renderSections();
}
// 工種内の全行の粗利率を±stepで一括増減
function stepSecMargin(secId,step){
  const sec=sections.find(s=>s.id===secId);if(!sec||!sec.items.length)return;
  const base=sec.items[0].margin;
  setSecMargin(secId,Math.min(99,Math.max(0,base+step)));
}
// 行の粗利率を±stepで増減
function stepItemMargin(secId,itemId,step){
  const sec=sections.find(s=>s.id===secId);if(!sec)return;
  const item=sec.items.find(i=>i.id===itemId);if(!item)return;
  updateItem(secId,itemId,'margin',Math.min(99,Math.max(0,item.margin+step)));
}
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
        <td style="width:100%"><input type="text" list="${secDatalistId}" value="${esc(item.name)}" placeholder="工事・品目名（リストから選択 または自由入力）" onfocus="itemNameFocus(this)" onblur="itemNameBlur(this)" oninput="updateItemText(${sec.id},${item.id},'name',this.value)" onkeydown="if(event.key==='Enter'){updateItemText(${sec.id},${item.id},'name',this.value);this.blur();}" style="width:100%;min-width:160px"></td>
        <td><input type="text" value="${esc(item.spec)}" placeholder="規格・仕様" oninput="updateItemText(${sec.id},${item.id},'spec',this.value)" style="min-width:70px"></td>
        <td class="num"><input type="number" value="${item.qty}" min="0" step="1" onchange="updateItem(${sec.id},${item.id},'qty',this.value)" style="width:48px;text-align:right"></td>
        <td><select id="item-unit-${item.id}" onchange="updateItemUnit(${sec.id},${item.id},this.value)" style="width:48px">${['式','本','枚','坪','台','箱','袋','巻','梱','セット','ヶ所','個','m','㎡','m³','kg','t','人工'].map(u=>`<option${u===item.unit?' selected':''}>${u}</option>`).join('')}</select></td>
        <td class="num"><input id="item-cost-${item.id}" type="text" inputmode="numeric" value="${item.cost?fmt(item.cost):0}" onfocus="this.value=this.value.replace(/,/g,'')" onblur="this.value=fmt(parseFloat(this.value.replace(/,/g,''))||0)" onchange="updateItem(${sec.id},${item.id},'cost',this.value.replace(/,/g,''))" style="width:78px;text-align:right"></td>
        <td class="num" style="white-space:nowrap">
          <button class="btn xs" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onclick="stepItemMargin(${sec.id},${item.id},-1)" style="padding:1px 4px;font-size:12px">－</button>
          <input type="text" inputmode="numeric" value="${item.margin}" onchange="updateItem(${sec.id},${item.id},'margin',this.value)" style="width:30px;text-align:center;color:${mc_col};font-weight:700">
          <button class="btn xs" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onclick="stepItemMargin(${sec.id},${item.id},1)" style="padding:1px 4px;font-size:12px">＋</button>
        </td>
        <td id="item-price-${item.id}" class="num" style="color:var(--wood-t);font-weight:600;padding-right:6px">¥${fmt(item.price)}</td>
        <td id="item-amt-${item.id}" class="amt">¥${fmt(item.qty*item.price)}</td>
        <td style="width:24px;text-align:center"><button class="btn danger xs" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onclick="removeItem(${sec.id},${item.id})" style="padding:2px 5px">×</button></td>
      </tr>`;}).join('');
    return `<div class="section-block">
      <div class="section-head" ondragover="event.preventDefault()" ondrop="estDropSec(${sec.id})">
        <span draggable="true" ondragstart="estDragStartSec(${sec.id})" style="cursor:grab;color:var(--text-muted);padding:0 2px" title="ドラッグで工種の順序を変更">⠿</span>
        <button class="sec-toggle" onclick="toggleSec(${sec.id})">${sec.open?'▾':'▸'}</button>
        <input class="sec-name" type="text" list="sec-cat-list" value="${esc(sec.name)}" placeholder="工種名（例：仮設工事）" onfocus="itemNameFocus(this)" onblur="itemNameBlur(this)" oninput="updateSecName(${sec.id},this.value)">
        <span style="font-size:11px;color:var(--accent-t);font-weight:700;white-space:nowrap">粗利 ${sMargin.toFixed(1)}%</span>
        <div style="display:flex;align-items:center;gap:2px;margin:0 4px;white-space:nowrap">
          <span style="font-size:10px;color:var(--text-muted)">一括</span>
          <button class="btn xs" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onclick="stepSecMargin(${sec.id},-1)" style="padding:1px 5px;font-size:13px">－</button>
          <input type="text" inputmode="numeric" id="sec-margin-input-${sec.id}" placeholder="${sMargin.toFixed(0)}" style="width:34px;text-align:center;font-size:11px;padding:1px 3px" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onchange="setSecMargin(${sec.id},this.value);this.value=''">
          <button class="btn xs" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onclick="stepSecMargin(${sec.id},1)" style="padding:1px 5px;font-size:13px">＋</button>
          <span style="font-size:10px;color:var(--text-muted)">%</span>
        </div>
        <span style="font-size:12px;font-weight:700;color:var(--wood-t);white-space:nowrap">¥${fmt(sTotal)}</span>
        <button class="btn danger xs" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onclick="removeSection(${sec.id})" style="padding:2px 6px;margin-left:4px">削除</button>
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
        <button class="add-row-btn" ontouchstart="syncActiveTextInput()" onmousedown="syncActiveTextInput()" onclick="addItem(${sec.id})">＋ 行を追加</button>
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
