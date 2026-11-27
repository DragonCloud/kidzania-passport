import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { allTables, db, type AppDB } from '../db/db';
import { syncRuntime } from '../sync/hooks';
import type { AppSetting, BackupManifest, StoredBlob } from '../types/models';
import { getChild } from './child';

const MANIFEST = 'manifest.json';
const MAP_SETTING_KEYS = new Set(['officialMap1F', 'officialMap2F']);

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function backupFilename(now = new Date()): string {
  return `kidzania-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

/**
 * 匯出 ZIP：manifest.json（孩子、入園、完成、帳目、設定）＋ blobs/（照片）。
 * 官方地圖預設不放進備份；includeOfficialMaps=true 時才包含。
 */
export async function exportBackup(
  opts: { includeOfficialMaps?: boolean } = {},
  d: AppDB = db,
): Promise<{ blob: Blob; filename: string; manifest: BackupManifest }> {
  const includeMaps = opts.includeOfficialMaps ?? false;
  const [child, visits, completions, ledger, allBlobs, allSettings] = await Promise.all([
    getChild(d),
    d.visits.toArray(),
    d.completions.toArray(),
    d.ledger.toArray(),
    d.blobs.toArray(),
    d.settings.toArray(),
  ]);
  // 原圖尚未從雲端下載（data 為空）的不放進 ZIP；雲端仍保有
  const blobs = allBlobs.filter((b) => (includeMaps || b.kind !== 'official-map') && b.data);
  const settings = allSettings.filter((s) => includeMaps || !MAP_SETTING_KEYS.has(s.key));

  const files: Zippable = {};
  const blobMeta: BackupManifest['blobs'] = [];
  for (const b of blobs) {
    const file = `blobs/${b.id}.${EXT[b.mime] ?? 'bin'}`;
    // 照片已是 JPEG，不再壓縮（level 0）以加快速度
    files[file] = [await blobBytes(b.data!), { level: 0 }];
    blobMeta.push({ id: b.id, kind: b.kind, mime: b.mime, file, createdAt: b.createdAt });
  }
  const manifest: BackupManifest = {
    app: 'kidzania-passport',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    child,
    visits,
    completions,
    ledger,
    blobs: blobMeta,
    settings,
    includesOfficialMaps: includeMaps,
  };
  files[MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files);
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    filename: backupFilename(),
    manifest,
  };
}

export class BackupError extends Error {}

function readManifest(entries: Record<string, Uint8Array>): BackupManifest {
  const raw = entries[MANIFEST];
  if (!raw) throw new BackupError('這不是職業護照的備份檔（找不到 manifest.json）');
  let m: BackupManifest;
  try {
    m = JSON.parse(strFromU8(raw)) as BackupManifest;
  } catch {
    throw new BackupError('備份檔內容損毀，無法讀取');
  }
  if (m.app !== 'kidzania-passport') throw new BackupError('這不是職業護照的備份檔');
  if (m.schemaVersion !== 1) throw new BackupError(`不支援的備份版本：${String(m.schemaVersion)}`);
  for (const k of ['visits', 'completions', 'ledger', 'blobs', 'settings'] as const) {
    if (!Array.isArray(m[k])) throw new BackupError(`備份檔缺少 ${k}`);
  }
  for (const b of m.blobs) if (!entries[b.file]) throw new BackupError(`備份檔缺少照片檔：${b.file}`);
  return m;
}

export interface ImportSummary {
  visits: number;
  completions: number;
  ledger: number;
  photos: number;
  officialMaps: number;
  exportedAt: string;
}

/** 讀取但不寫入，供匯入前確認畫面顯示 */
export async function inspectBackup(file: Blob): Promise<ImportSummary> {
  const m = readManifest(unzip(await blobBytes(file)));
  return summarize(m);
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new BackupError('無法解開 ZIP 檔');
  }
}

function summarize(m: BackupManifest): ImportSummary {
  return {
    visits: m.visits.length,
    completions: m.completions.length,
    ledger: m.ledger.length,
    photos: m.blobs.filter((b) => b.kind === 'photo').length,
    officialMaps: m.blobs.filter((b) => b.kind === 'official-map').length,
    exportedAt: m.exportedAt,
  };
}

/**
 * 匯入備份。
 * - replace：清空本機資料後寫入備份內容（若備份沒有官方地圖，保留本機已載入的地圖）
 * - merge：依 id 合併，同 id 以備份為準
 */
export async function importBackup(file: Blob, mode: 'replace' | 'merge', d: AppDB = db): Promise<ImportSummary> {
  const entries = unzip(await blobBytes(file));
  const m = readManifest(entries);
  const blobs: StoredBlob[] = m.blobs.map((b) => ({
    id: b.id,
    kind: b.kind,
    mime: b.mime,
    createdAt: b.createdAt,
    data: new Blob([entries[b.file]! as Uint8Array<ArrayBuffer>], { type: b.mime }),
  }));

  await d.transaction('rw', [d.child, d.visits, d.completions, d.ledger, d.blobs, d.settings, d.outbox], async () => {
    if (mode === 'replace') {
      let keepMaps: StoredBlob[] = [];
      let keepMapSettings: AppSetting[] = [];
      if (!m.includesOfficialMaps) {
        keepMaps = await d.blobs.where('kind').equals('official-map').toArray();
        keepMapSettings = (await d.settings.toArray()).filter((s) => MAP_SETTING_KEYS.has(s.key));
      }
      await Promise.all([d.child.clear(), d.visits.clear(), d.completions.clear(), d.ledger.clear(), d.blobs.clear(), d.settings.clear()]);
      await d.blobs.bulkPut(keepMaps);
      await d.settings.bulkPut(keepMapSettings);
    }
    await d.child.put({ ...m.child, id: 'kid' });
    await d.visits.bulkPut(m.visits);
    await d.completions.bulkPut(m.completions);
    await d.ledger.bulkPut(m.ledger);
    await d.blobs.bulkPut(blobs);
    await d.settings.bulkPut(m.settings);
  });
  return summarize(m);
}

/** 清除本機全部資料（設定頁「清除本機資料」） */
export async function clearAllData(d: AppDB = db): Promise<void> {
  // clear() 不會觸發 hooks，不會產生雲端軟刪除
  await d.transaction('rw', allTables(d), async () => {
    await Promise.all(allTables(d).map((t) => t.clear()));
  });
  syncRuntime(d).familyId = null;
}

/** 觸發瀏覽器下載（iOS 會開啟分享／儲存到「檔案」） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
