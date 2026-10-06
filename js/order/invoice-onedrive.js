// ════ 業者から届いた請求書を、OneDriveのフォルダへ保存する ════
//
// やること
//   指定したフォルダの下に、請求月ごとのフォルダ（2026年9月分 →「202609」）を作り、
//   業者から送られてきた請求書をその中に入れる。
//
// 入れないもの
//   きよかわの社員が代わりに登録したものは入れない（業者から届いたものだけが対象）。
//
// どうやって入れるか
//   OneDriveはパソコンの中のフォルダと同じなので、ブラウザからそこへ直に書き込む。
//   最初の1回だけフォルダを選んでいただき、そのあとは覚えておく。
//   Microsoftのアカウント連携は要らない（パソコンのOneDriveが同期してくれる）。
//
// 使える場所
//   パソコンの Edge / Chrome のみ。iPhoneやSafariでは、この仕組みが無い。

const INV_FS_DB    = 'teyose-fs';
const INV_FS_STORE = 'handles';
const INV_FS_KEY   = 'invoice-root';

function invFsSupported(){ return typeof window.showDirectoryPicker === 'function'; }

// ── 選んでもらったフォルダを覚えておく（IndexedDBにしか入れられない） ──
function invFsOpenDb(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(INV_FS_DB, 1);
    r.onupgradeneeded = ()=>{ r.result.createObjectStore(INV_FS_STORE); };
    r.onsuccess = ()=>res(r.result);
    r.onerror   = ()=>rej(r.error);
  });
}
function invFsGet(){
  return invFsOpenDb().then(db=>new Promise((res)=>{
    const q = db.transaction(INV_FS_STORE,'readonly').objectStore(INV_FS_STORE).get(INV_FS_KEY);
    q.onsuccess = ()=>res(q.result||null);
    q.onerror   = ()=>res(null);
  })).catch(()=>null);
}
function invFsPut(handle){
  return invFsOpenDb().then(db=>new Promise((res)=>{
    const q = db.transaction(INV_FS_STORE,'readwrite').objectStore(INV_FS_STORE).put(handle, INV_FS_KEY);
    q.onsuccess = ()=>res(true);
    q.onerror   = ()=>res(false);
  })).catch(()=>false);
}

// 保存先のフォルダ。覚えていれば使い、無ければ選んでもらう
async function invFsRoot(ask){
  const saved = await invFsGet();
  if(saved){
    try{
      let p = await saved.queryPermission({ mode:'readwrite' });
      if(p !== 'granted' && ask) p = await saved.requestPermission({ mode:'readwrite' });
      if(p === 'granted') return saved;
    }catch(_){}
  }
  if(!ask) return null;
  const picked = await window.showDirectoryPicker({ id:'teyose-invoices', mode:'readwrite' });
  await invFsPut(picked);
  return picked;
}

// 保存先を選び直す
async function invPickOneDriveFolder(){
  if(!invFsSupported()){ showToast(INV_FS_NG, 6000); return; }
  try{
    const picked = await window.showDirectoryPicker({ id:'teyose-invoices', mode:'readwrite' });
    await invFsPut(picked);
    showToast(`保存先を「${picked.name}」にしました`);
  }catch(_){ /* 選ぶのをやめただけ */ }
  renderInvoices();
}

const INV_FS_NG = 'この端末では使えません。パソコンの Edge か Chrome からお使いください';

// ── 業者から届いたものか（きよかわの社員が登録したものは除く） ──
function invFromSupplier(v){
  const by = String(v.uploadedBy||'').trim();
  if(!by) return true;                       // 記録が無いものは、業者から届いたものとして扱う
  const p = (typeof allProfiles!=='undefined' ? allProfiles : [])
    .find(x=>String(x.displayName||'').trim() === by);
  return !(p && (p.role === 'staff' || p.role === 'carpenter'));
}

// ファイル名に使えない字を落とす
function invFsSafe(s){
  return String(s||'').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim() || '名前なし';
}
function invFsExt(v){
  const m = String(v.fileName||'').match(/\.[A-Za-z0-9]{1,8}$/);
  if(m) return m[0].toLowerCase();
  return /pdf/i.test(v.fileMime||'') ? '.pdf' : '';
}

// 保存する一覧と、それぞれの入れ先・名前を決める。
// 同じ業者・同じ月のものが複数あるときだけ、うしろに枝番を付ける
function invOneDrivePlan(){
  const list = (invoices||[])
    .filter(v=>v.filePath && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v.month||'')))
    .filter(invFromSupplier)
    .sort((a,b)=> a.month<b.month?-1 : a.month>b.month?1 : a.id-b.id);

  const total = {};
  list.forEach(v=>{ const k=v.month+'|'+v.supplierName; total[k]=(total[k]||0)+1; });

  const seq = {};
  return list.map(v=>{
    const k = v.month+'|'+v.supplierName;
    seq[k] = (seq[k]||0)+1;
    const folder = v.month.replace('-','');                   // 2026-09 → 202609
    const base   = `${invFsSafe(v.supplierName)}_${folder}`;
    const name   = (total[k] > 1 ? `${base}_${seq[k]}` : base) + invFsExt(v);
    return { v, folder, name };
  });
}

// ── 保存する ──
async function saveInvoicesToOneDrive(){
  if(!invIsStaff()){ showToast('管理者のみです'); return; }
  if(!invFsSupported()){ showToast(INV_FS_NG, 6000); return; }

  const plan = invOneDrivePlan();
  if(!plan.length){ showToast('業者から届いた請求書がありません'); return; }

  let root;
  try{ root = await invFsRoot(true); }catch(_){ return; }
  if(!root) return;

  const folders = [...new Set(plan.map(p=>p.folder))].sort();
  if(!confirm(`業者から届いた請求書 ${plan.length}件を、「${root.name}」の中に入れます。\n\n`
    + `入れ先のフォルダ：${folders.join('・')}\n\n`
    + `すでに入っているものは飛ばします。よろしいですか？`)) return;

  let saved=0, skipped=0, failed=0;
  const dirs = {};
  for(let i=0;i<plan.length;i++){
    const { v, folder, name } = plan[i];
    showToast(`保存しています…（${i+1}/${plan.length}）`, 30000);
    try{
      if(!dirs[folder]) dirs[folder] = await root.getDirectoryHandle(folder, { create:true });
      // すでにあるものは触らない
      let exists = false;
      try{ await dirs[folder].getFileHandle(name); exists = true; }catch(_){}
      if(exists){ skipped++; continue; }

      const url = await dbInvoiceUrl(v.filePath);
      const res = await fetch(url);
      if(!res.ok) throw new Error(res.status+'');
      const blob = await res.blob();

      const fh = await dirs[folder].getFileHandle(name, { create:true });
      const w  = await fh.createWritable();
      await w.write(blob);
      await w.close();
      saved++;
    }catch(e){
      console.warn('保存できませんでした', name, e?.message||e);
      failed++;
    }
  }
  showToast(`${saved}件を保存しました`
    + (skipped?`　すでにあった ${skipped}件`:'')
    + (failed ?`　できなかった ${failed}件`:''), 8000);
}
