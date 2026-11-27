// ============================================================
// 靜態資料（src/data/*.json，由 scripts/csv-to-json.mjs 產生）
// ============================================================

export type Floor = 1 | 2;
export type Confidence = 'high' | 'medium' | 'low';
export type JobFlag = '待確認';

export interface Job {
  id: string;
  nameZh: string;
  venueZh: string;
  sponsor: string | null;
  mapNo: number | null;
  floor: Floor | null;
  /** 0–1，各樓層取景框左上為原點 */
  x: number | null;
  y: number | null;
  mapCategory: string;
  minAge: number | null;
  maxAge: number | null;
  /** CSV 原字串，例如 "110cm" */
  heightReq: string | null;
  heightCm: number | null;
  /** 正數＝賺、負數＝付；null＝官方未列 kidZos */
  kidzoDelta: number | null;
  /** 需另付新臺幣 */
  ntdFee: number | null;
  durationMin: number | null;
  accompanyRule: string | null;
  /** CSV 原文，完整保留 */
  description: string | null;
  /** 詳情頁「簡介」 */
  summary: string | null;
  /** 詳情頁「備註」（description 內的內部註記） */
  note: string | null;
  officialUrl: string | null;
  sourceUrls: string[];
  flag: JobFlag | null;
  confidence: Confidence;
}

export interface Facility {
  id: string;
  /** A–X；服務設施（廁所、ATM…）為 null */
  letter: string | null;
  nameZh: string;
  floor: Floor;
  x: number;
  y: number;
  facilityType: string;
  sponsor: string | null;
  notes: string | null;
}

// ============================================================
// 本機資料（Dexie / IndexedDB）— 第 3 批建立資料表
// ============================================================

/** 單一孩子；原始碼不放任何姓名、生日，首次開啟時輸入 */
export interface ChildProfile {
  id: 'kid';
  name: string;
  /** 'YYYY-MM-DD'；尚未設定為 null */
  birthday: string | null;
  avatarBlobId?: string;
}

export interface Visit {
  id: string;
  /** 'YYYY-MM-DD' */
  visitDate: string;
  /** 預設 50，可改成上次留下的餘額 */
  startingKidzos: number;
  notes?: string;
  createdAt: number;
}

export interface Completion {
  id: string;
  jobId: string;
  visitId?: string;
  /** epoch ms，可修改 */
  completedAt: number;
  photoBlobId?: string;
  thumbBlobId?: string;
  note?: string;
}

export type LedgerType =
  | 'grant'     // 入園起始資金
  | 'earn'      // 職業賺得
  | 'spend'     // 職業支付
  | 'adjust'    // 手動調整
  | 'purchase'  // 購物中心兌換
  | 'donate'    // 捐款
  | 'atm'       // ATM／銀行存提
  | 'twd_fee';  // 自費新臺幣
export type Currency = 'kidZos' | 'TWD';

export interface LedgerEntry {
  id: string;
  visitId?: string;
  at: number;
  type: LedgerType;
  /** 帶正負號：earn +10、spend −5、twd_fee −199 */
  amount: number;
  currency: Currency;
  jobId?: string;
  /** 蓋章自動產生的帳；刪除完成紀錄時一起處理 */
  completionId?: string;
  note?: string;
}

export type BlobKind = 'photo' | 'thumb' | 'official-map';

export interface StoredBlob {
  id: string;
  kind: BlobKind;
  mime: string;
  /** 圖檔本體；同步拉下來、但原圖尚未下載時為 undefined */
  data?: Blob;
  createdAt: number;
  /** 雲端路徑 {family_id}/{blob_id}.jpg（家庭同步） */
  remotePath?: string;
  /** 已上傳到雲端 */
  uploaded?: boolean;
}

export type SettingKey = 'officialMap1F' | 'officialMap2F' | 'showServiceIcons' | 'soundOn' | 'lastBackupAt';

export interface AppSetting {
  key: SettingKey;
  value: unknown;
}

// ============================================================
// 家庭同步（Dexie version 2）
// ============================================================

/** 會同步的資料表（settings 與官方地圖永不同步） */
export type SyncTable = 'child' | 'visits' | 'completions' | 'ledger' | 'blobs';
export const SYNC_TABLES: SyncTable[] = ['child', 'visits', 'completions', 'ledger', 'blobs'];

/** 待送清單：同一筆（tbl+rowId）只留最新一次 */
export interface OutboxEntry {
  tbl: SyncTable;
  rowId: string;
  op: 'put' | 'delete';
  /** 送出順序（遞增） */
  seq: number;
  queuedAt: number;
  /** 刪除時的最後內容（軟刪除仍保留在雲端，供「還原」） */
  snapshot?: unknown;
}

export type SyncStateKey = 'familyId' | 'userId' | 'cursor' | 'lastSyncAt' | 'lastError' | 'firstFailAt';

export interface SyncStateRow {
  key: SyncStateKey;
  value: unknown;
}

/** 最近刪除（30 天內可還原） */
export interface TrashEntry {
  /** 'completions:<id>' */
  key: string;
  label: string;
  jobId?: string;
  deletedAt: number;
  items: { tbl: SyncTable; id: string; data: unknown }[];
}

// ============================================================
// 備份 ZIP（manifest.json ＋ blobs/）
// ============================================================

export interface BackupManifest {
  app: 'kidzania-passport';
  schemaVersion: 1;
  exportedAt: string;
  child: ChildProfile;
  visits: Visit[];
  completions: Completion[];
  ledger: LedgerEntry[];
  blobs: { id: string; kind: BlobKind; mime: string; file: string; createdAt: number }[];
  settings: AppSetting[];
  includesOfficialMaps: boolean;
}
