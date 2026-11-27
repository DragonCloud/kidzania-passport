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
  /** v0.3.0：B·KidZanian 市民護照（選填；舊資料沒有） */
  passport?: CitizenPassport | null;
  /** v0.3.1：已刪除過的護照費帳 id（雲端「刪除優先」不能復活同 id，再建立時改用新 id） */
  retiredPassportEntryIds?: string[];
  /** v0.3.0：門票價格預設（選填；沒有時用官方預設） */
  ticketPrices?: TicketPriceTable;
}

// ───────── v0.3.0 市民護照與門票（全部選填欄位，舊 App 讀到不會壞） ─────────

/** model＝模範市民、outstanding＝傑出市民、honor＝榮譽市民 */
export type PassportLevel = 'model' | 'outstanding' | 'honor';

export interface CitizenPassport {
  /** 辦理日 'YYYY-MM-DD'（保留給舊版 App／舊資料讀取；與 issuedAt 的當地日期一致） */
  issuedOn: string;
  /** v0.3.1：辦理時間（epoch ms）。這個時間之後蓋的章才算護照章、才套用權益。舊資料沒有時視為辦理日 00:00 */
  issuedAt?: number;
  /** 辦理費（新臺幣） */
  fee: number;
  /** 對應的台幣支出帳（twd_fee／passport） */
  feeEntryId?: string;
  /** 升級紀錄（到現場換發後手動記錄），依日期排序 */
  upgrades: { level: Exclude<PassportLevel, 'model'>; date: string; /** v0.3.1：換發時間（epoch ms）；舊資料只有日期時視為當天 00:00 */ at?: number }[];
  /** 遺失補發：等級保留、舊章不轉移 */
  replacements: { date: string; fee: number; entryId?: string; /** v0.3.1：補發時間（epoch ms） */ at?: number }[];
}

export type TicketTypeId = 'child' | 'adult' | 'senior' | 'careChild' | 'careAdult' | 'infant';

export interface TicketPriceTable {
  prices: Record<TicketTypeId, number>;
  /** 使用者最後修改日期；沒有＝官方預設 */
  updatedOn?: string;
}

/** 一行門票（同票種、同價格） */
export interface VisitTicket {
  /** 官方票種，或 'custom'（自訂／其他優惠：通路優惠、團體票…） */
  type: TicketTypeId | 'custom';
  label: string;
  qty: number;
  /** 每張原價 */
  listPrice: number;
  /** 每張實付 */
  paidPrice: number;
  note?: string;
}

export type TwdCategory = 'passport' | 'ticket' | 'job' | 'other';

export interface Visit {
  id: string;
  /** 'YYYY-MM-DD' */
  visitDate: string;
  /** 預設 50，可改成上次留下的餘額 */
  startingKidzos: number;
  notes?: string;
  createdAt: number;
  /** v0.3.0：這次入園的門票；undefined＝未記錄（不是 0 元） */
  tickets?: VisitTicket[];
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
  /** v0.3.1：蓋章時是否選「套用護照加碼」。舊資料沒有時：帳上有 passportBonus 視為有選 */
  passportPerk?: boolean;
  /** v0.3.1：手動指定算（true）／不算（false）護照集章；沒有時依時間自動判斷 */
  countsForPassport?: boolean;
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
  /** v0.3.0：新臺幣支出分類；舊資料沒有時，有 jobId 視為 job、否則 other */
  twdCategory?: TwdCategory;
  /** v0.3.0：護照權益帶來的 kidZos 效果（加碼或少付的數量，正數） */
  passportBonus?: number;
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
