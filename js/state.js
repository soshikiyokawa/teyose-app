// ════ グローバル状態（アプリ起動中に変化するデータ） ════
// 初期データは js/data/ 配下のシードファイルを参照（index.html でこのファイルより先に読み込む）

// やり取り
let talkPanelOpen = false;
let activeTalkPanelSupplier = null;
let talkThreads = {};

// 受発注
let cart=[], orders=[], orderSeq=1, costEntries=[], currentOrder=null;

// 見積
let estimates=[],estSeq=1,editingEstId=null;
let sections=[],secSeq=1,itemSeq=1;

// 発注先マスタ
let suppliers = SUPPLIERS_SEED;
let supplierIdSeq = SUPPLIERS_SEED_NEXT_ID, editingSupplierId=null;

// 品目マスタ
let master = MASTER_ITEMS_SEED;
let masterIdSeq = MASTER_ITEMS_SEED_NEXT_ID, editingMasterId=null;

// 発注作成フロー（発注先選択 → 品目選択）の一時状態
let selectedSupplier=null, activeCat='全て', pendingItem=null;

// 品目マスタ画面（ドラッグ並び替え）の一時状態
let dragSrcId = null;
let activeMasterSupplier = null;
let masterDirty = false; // 並び替え後に保存ボタンを光らせるフラグ
