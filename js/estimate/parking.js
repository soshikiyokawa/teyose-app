// ════ 契約済み駐車場（住所・地図ピン・区画図などの資料） ════
// 住所とピンは案件（projects）に保存。資料は drawings に kind='parking' で保存する。

let _parkMap = null, _parkMarker = null;

// 入力欄優先、無ければ案件に保存済みの駐車場住所
function _currentParkingAddress(){
  const v = document.getElementById('est-parking')?.value.trim();
  return v || selectedProject?.parkingAddress || '';
}

// Googleマップで開く（ピンがあればその座標、無ければ住所で検索）
function openParkingMap(){
  const lat = window._parkingLat, lng = window._parkingLng;
  const addr = _currentParkingAddress();
  if(lat && lng){ window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank'); return; }
  if(!addr){ showToast('駐車場の住所を入力してください'); return; }
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`, '_blank');
}

// ピン調整（工事場所と同じ操作感。住所を中心に開く）
async function openParkingPicker(){
  const addr = _currentParkingAddress();
  document.getElementById('park-picker-overlay').style.display = 'flex';
  await new Promise(r=>setTimeout(r,100));

  if(!_parkMap){
    _parkMap = L.map('park-picker-container').setView([34.5,132.5], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(_parkMap);
    _parkMap.on('click', e=>{
      if(_parkMarker) _parkMarker.setLatLng(e.latlng);
      else _parkMarker = L.marker(e.latlng,{draggable:true}).addTo(_parkMap);
      document.getElementById('park-picker-coords').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    });
  } else {
    _parkMap.invalidateSize();
  }

  // 既存ピンがあればそこを表示
  if(window._parkingLat && window._parkingLng){
    const latlng = L.latLng(window._parkingLat, window._parkingLng);
    if(_parkMarker) _parkMarker.setLatLng(latlng);
    else _parkMarker = L.marker(latlng,{draggable:true}).addTo(_parkMap);
    _parkMap.setView(latlng, 17);
    document.getElementById('park-picker-coords').textContent = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    _parkMarker.on('dragend', e=>{
      const p=e.target.getLatLng();
      document.getElementById('park-picker-coords').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
    });
    return;
  }

  // 住所を中心に表示（工事場所と同じジオコーディングを利用）
  if(addr){
    document.getElementById('park-picker-coords').textContent = `「${addr}」を検索中…`;
    try{
      const latlng = await _geocodeAddress(addr);
      if(latlng){
        if(_parkMarker) _parkMarker.setLatLng(latlng);
        else _parkMarker = L.marker(latlng,{draggable:true}).addTo(_parkMap);
        _parkMap.setView(latlng, 17);
        document.getElementById('park-picker-coords').textContent = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        _parkMarker.on('dragend', e=>{
          const p=e.target.getLatLng();
          document.getElementById('park-picker-coords').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
        });
      } else {
        document.getElementById('park-picker-coords').textContent = '地図をタップしてピンを置いてください';
        showToast('住所が見つかりませんでした。地図をタップしてピンを置いてください。');
      }
    }catch(_){
      document.getElementById('park-picker-coords').textContent = '地図をタップしてピンを置いてください';
      showToast('住所検索に失敗しました');
    }
  } else {
    showToast('駐車場の住所を入力すると、その位置を中心に表示します');
  }
}
function closeParkingPicker(){ document.getElementById('park-picker-overlay').style.display='none'; }

async function recenterParkingToAddress(){
  const addr = _currentParkingAddress();
  if(!addr){ showToast('駐車場の住所が入力されていません'); return; }
  document.getElementById('park-picker-coords').textContent = `「${addr}」を検索中…`;
  try{
    const latlng = await _geocodeAddress(addr);
    if(!latlng){ showToast('住所が見つかりませんでした'); return; }
    _parkMap.setView(latlng, 17);
    showToast(`「${addr}」を表示しました`);
  }catch(_){ showToast('住所検索に失敗しました'); }
}

function saveParkingPin(){
  if(!_parkMarker){ showToast('ピンを置いてください'); return; }
  const p = _parkMarker.getLatLng();
  window._parkingLat = p.lat; window._parkingLng = p.lng;
  updateParkingPinIndicator();
  closeParkingPicker();
  showToast('✅ 駐車場のピンを保存しました（案件保存で確定します）');
}
function clearParkingPin(){
  window._parkingLat = null; window._parkingLng = null;
  if(_parkMarker){ _parkMarker.remove(); _parkMarker = null; }
  document.getElementById('park-picker-coords').textContent = '地図をタップしてピンを置いてください';
  updateParkingPinIndicator();
  showToast('ピンをクリアしました');
}
function updateParkingPinIndicator(){
  const el = document.getElementById('parking-pin-indicator');
  if(el) el.style.display = (window._parkingLat && window._parkingLng) ? '' : 'none';
}

// ── 区画図などの資料（PDF・画像） ──
async function onParkingDocFiles(input){
  const files = [...(input.files||[])];
  input.value = '';
  if(!files.length) return;
  const projectId = selectedProject?.id;
  if(!projectId){ showToast('先に案件を保存してください'); return; }
  const btn = document.getElementById('parking-doc-add-btn');
  if(btn) btn.disabled = true;
  try{
    for(let i=0;i<files.length;i++){
      const f = files[i];
      showToast(`アップロード中…（${i+1}/${files.length}）`, 30000);
      const extMatch = f.name.match(/\.[a-zA-Z0-9]+$/);
      const url = await dbUploadSiteFile('parking', projectId, f, extMatch?extMatch[0]:'');
      await dbAddDrawing({projectId, kind:'parking', fileUrl:url, fileName:f.name, fileMime:f.type||''});
    }
    showToast(files.length+'件の資料を登録しました');
  }finally{ if(btn) btn.disabled = false; }
  try{ await fetchGenbaData(); }catch(e){}
  renderParkingDocs();
}

function renderParkingDocs(){
  const wrap = document.getElementById('parking-doc-list');
  if(!wrap) return;
  const pid = selectedProject?.id || null;
  const list = pid ? drawings.filter(d=>d.projectId===pid && d.kind==='parking') : [];
  if(!list.length){
    wrap.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">区画図などの資料は未登録です</div>';
    return;
  }
  wrap.innerHTML = list.map(d=>{
    const isPdf = /pdf/i.test(d.fileMime) || /\.pdf$/i.test(d.fileName);
    const canDelete = currentUserRole==='staff' || d.uploadedBy===currentUserId;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:15px">${isPdf?'📄':'🖼'}</span>
      <span style="flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.fileName)}</span>
      <a class="btn xs" href="${esc(d.fileUrl)}" target="_blank" rel="noopener">開く</a>
      ${canDelete?`<button class="btn xs danger" onclick="deleteParkingDoc(${d.id})">削除</button>`:''}
    </div>`;
  }).join('');
}

async function deleteParkingDoc(id){
  const d = drawings.find(x=>x.id===id);
  if(!d) return;
  if(!confirm(`「${d.fileName}」を削除しますか？`)) return;
  await dbDeleteDrawing(id);
  drawings = drawings.filter(x=>x.id!==id);
  showToast('資料を削除しました');
  renderParkingDocs();
}
