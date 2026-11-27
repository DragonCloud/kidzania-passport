import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { OFFICIAL_SITE } from '../config/defaults';
import { db } from '../db/db';
import { isPersisted, isStandalone, requestPersistence, storageUsage, type StorageUsage } from '../db/persist';
import { BottomSheet } from '../components/BottomSheet';
import { ChildSetupCard } from '../components/ChildSetupCard';
import { FamilySyncSection, SignOutDialog } from '../components/sync/FamilySyncSection';
import { TrashSection } from '../components/sync/TrashSection';
import { useSyncAccount } from '../sync/SyncProvider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconAlert, IconExternal } from '../components/icons';
import { useChild } from '../hooks/useChild';
import { useSetting } from '../hooks/useSetting';
import { formatAge } from '../lib/age';
import { BackupError, clearAllData, downloadBlob, exportBackup, importBackup, inspectBackup, type ImportSummary } from '../lib/backup';
import { formatDateTime } from '../lib/format';
import { looksLikeFullPage, removeOfficialMap, saveOfficialMap } from '../lib/officialMap';
import { prepareMapImage } from '../lib/photo';
import { setSetting } from '../lib/settings';
import type { Floor } from '../types/models';

const BACKUP_REMIND_DAYS = 14;

function Card({ title, children, tone = 'normal' }: { title: string; children: ReactNode; tone?: 'normal' | 'danger' }) {
  return (
    <section className="mt-6">
      <h2 className={`mb-2 px-1 text-sm font-bold ${tone === 'danger' ? 'text-red-700' : 'text-ink/60'}`}>{title}</h2>
      <div className={`rounded-3xl bg-white p-4 shadow-sm ring-1 ${tone === 'danger' ? 'ring-red-200' : 'ring-ink/5'}`}>{children}</div>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="block text-sm font-bold">{label}</span>
        {hint && <span className="block text-xs text-ink/50">{hint}</span>}
      </span>
      <span className="relative inline-flex h-7 w-12 shrink-0">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="absolute inset-0 rounded-full bg-ink/20 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40" />
        <span className="absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4" role="status">
      <p className="rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-white shadow-lg">{text}</p>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { loaded, child, age } = useChild();
  const soundOn = useSetting('soundOn');
  const showService = useSetting('showServiceIcons');
  const lastBackupAt = useSetting('lastBackupAt');
  const map1 = useSetting('officialMap1F');
  const map2 = useSetting('officialMap2F');
  const counts = useLiveQuery(
    async () => ({
      completions: await db.completions.count(),
      photos: await db.blobs.where('kind').equals('photo').count(),
      // 家庭同步拉下來、但原圖還沒打開過（尚未下載）的照片
      cloudOnly: await db.blobs.where('kind').equals('photo').filter((b) => !b.data).count(),
    }),
    [],
  ) ?? { completions: 0, photos: 0, cloudOnly: 0 };

  const [toast, setToast] = useState<string | null>(null);
  const [includeMaps, setIncludeMaps] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [shareFile, setShareFile] = useState<File | null>(null);

  const importRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importInfo, setImportInfo] = useState<ImportSummary | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const [clearOpen, setClearOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const { state: account } = useSyncAccount();
  // 這支手機已接上家庭同步（資料會上傳）：匯入只能合併、清除改為登出並清除快取
  const familySynced = useLiveQuery(async () => account.status === 'inFamily' && !!(await db.syncState.get('familyId')), [account.status], false);
  const trashCount = useLiveQuery(() => db.trash.count(), [], 0);
  const [clearText, setClearText] = useState('');

  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const standalone = isStandalone();
  useEffect(() => {
    void isPersisted().then(setPersisted);
    void storageUsage().then(setUsage);
  }, [counts.photos, map1, map2]);

  const backupOverdue = counts.completions > 0 && (lastBackupAt === null || Date.now() - lastBackupAt > BACKUP_REMIND_DAYS * 86400_000);

  async function doExport() {
    setExporting(true);
    try {
      const { blob, filename } = await exportBackup({ includeOfficialMaps: includeMaps });
      await setSetting('lastBackupAt', Date.now());
      const file = new File([blob], filename, { type: 'application/zip' });
      // iPhone：用分享選單存到「檔案」或傳給自己較方便；不支援時直接下載
      if (navigator.canShare?.({ files: [file] })) setShareFile(file);
      else {
        downloadBlob(blob, filename);
        setToast('備份檔已下載');
      }
    } catch {
      setToast('匯出失敗，請再試一次');
    } finally {
      setExporting(false);
    }
  }

  async function pickImport(f: File | undefined) {
    if (importRef.current) importRef.current.value = '';
    if (!f) return;
    setImportError(null);
    setImportMode(familySynced ? 'merge' : 'replace');
    try {
      setImportInfo(await inspectBackup(f));
      setImportFile(f);
    } catch (e) {
      setImportFile(f);
      setImportInfo(null);
      setImportError(e instanceof BackupError ? e.message : '無法讀取這個檔案');
    }
  }

  async function doImport() {
    if (!importFile) return;
    setImporting(true);
    try {
      // 家庭同步中一律合併：匯入的紀錄會上傳給家人，不清除雲端資料
      const s = await importBackup(importFile, familySynced ? 'merge' : importMode);
      // 取代後，手機上的資料就等於這份備份
      if (importMode === 'replace' && !familySynced) await setSetting('lastBackupAt', Date.parse(s.exportedAt));
      setImportFile(null);
      setToast(`已匯入 ${s.completions} 筆紀錄、${s.photos} 張照片`);
    } catch (e) {
      setImportError(e instanceof BackupError ? e.message : '匯入失敗');
    } finally {
      setImporting(false);
    }
  }

  async function doClear() {
    await clearAllData();
    setClearOpen(false);
    setClearText('');
    navigate('/', { replace: true });
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-5 pb-28">
      <h1 className="text-2xl font-black">設定</h1>

      <Card title="孩子">
        {loaded && (
          <>
            {age && (
              <p className="mb-1 text-sm text-ink/60">
                目前 <b className="text-ink">{formatAge(age)}</b>（依今天日期自動計算）
              </p>
            )}
            <ChildSetupCard key={`${child.name}|${child.birthday}`} child={child} compact onSaved={() => setToast('已儲存')} />
          </>
        )}
      </Card>

      <Card title="家庭同步">
        <FamilySyncSection onMessage={setToast} />
      </Card>

      <Card title="備份與還原">
        {backupOverdue && (
          <p className="mb-3 flex items-start gap-1.5 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {lastBackupAt === null ? '還沒備份過。' : `已超過 ${BACKUP_REMIND_DAYS} 天沒備份。`}
            照片與紀錄只在這支手機，換手機或清除瀏覽器資料就會不見。
          </p>
        )}
        <p className="text-sm text-ink/65">
          目前 {counts.completions} 筆紀錄、{counts.photos} 張照片。
          {lastBackupAt !== null && <span className="block text-xs text-ink/45">上次匯出：{formatDateTime(lastBackupAt)}</span>}
          {counts.cloudOnly > 0 && (
            <span className="block text-xs text-ink/45">其中 {counts.cloudOnly} 張原圖還在雲端、尚未下載到這支手機，匯出的 ZIP 不會包含（打開照片即會下載）。</span>
          )}
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeMaps} onChange={(e) => setIncludeMaps(e.target.checked)} className="h-5 w-5 accent-brand" />
          一併備份本機官方地圖（檔案較大，請勿公開分享）
        </label>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void doExport()}
          className="mt-3 w-full rounded-2xl bg-brand py-3 font-bold text-white disabled:opacity-60"
        >
          {exporting ? '打包中…' : '匯出備份 ZIP'}
        </button>
        <input ref={importRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void pickImport(e.target.files?.[0])} />
        <button type="button" onClick={() => importRef.current?.click()} className="mt-2 w-full rounded-2xl bg-white py-3 font-bold ring-1 ring-ink/15">
          從備份 ZIP 匯入
        </button>
        <p className="mt-2 text-xs text-ink/45">ZIP 內含孩子名字、生日、照片與帳目，請自己保存，不要上傳到公開位置。</p>
      </Card>

      <Card title="官方地圖（只存在這支手機）">
        <p className="text-sm text-ink/65">網站本身只有自繪示意圖。若你有官方城市地圖，可以在這裡載入當作底圖，圖檔不會上傳、也不在網站裡。</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink/50">
          <li>請用 PDF「整頁」輸出的圖片（1 樓、2 樓各一張），圖釘才會對準。</li>
          <li>PDF 可先用「檔案」App 或電腦轉成 JPG／PNG。</li>
        </ul>
        <div className="mt-3 space-y-2">
          {([1, 2] as const).map((f) => (
            <OfficialMapRow key={f} floor={f} loadedId={f === 1 ? map1 : map2} onMessage={setToast} />
          ))}
        </div>
      </Card>

      <Card title="地圖與音效">
        <Toggle label="蓋章音效" checked={soundOn} onChange={(v) => void setSetting('soundOn', v)} />
        <Toggle label="地圖顯示廁所／ATM／AED" checked={showService} onChange={(v) => void setSetting('showServiceIcons', v)} />
      </Card>

      <Card title="這支手機">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink/55">加入主畫面</dt>
            <dd className="font-bold">{standalone ? '已加入 ✓' : '尚未（建議加入）'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink/55">資料保存</dt>
            <dd className="font-bold">{persisted === null ? '不支援查詢' : persisted ? '已設為持久保存 ✓' : '一般（可能被系統清除）'}</dd>
          </div>
          {usage && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink/55">已使用空間</dt>
              <dd className="font-bold">{(usage.usedBytes / 1024 / 1024).toFixed(1)} MB</dd>
            </div>
          )}
        </dl>
        {persisted === false && (
          <button
            type="button"
            onClick={() =>
              void requestPersistence().then((ok) => {
                setPersisted(ok);
                setToast(ok ? '已設為持久保存' : '瀏覽器未同意，建議加入主畫面並定期備份');
              })
            }
            className="mt-3 w-full rounded-2xl bg-white py-2.5 text-sm font-bold ring-1 ring-ink/15"
          >
            請瀏覽器保留資料
          </button>
        )}
        {!standalone && (
          <p className="mt-3 rounded-xl bg-ink/[0.04] p-3 text-xs leading-relaxed text-ink/65">
            iPhone：用 Safari 開啟 → 下方「分享」→「加入主畫面」。
            <br />
            Android：用 Chrome 開啟 → 右上「⋮」→「安裝應用程式」或「加到主畫面」。
          </p>
        )}
      </Card>

      <Card title="隱私">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink/70">
          {familySynced ? (
            <>
              <li>孩子名字、生日、照片、蓋章與 kidZos 帳目存在這支手機，並同步到你們家庭的 Supabase 專案；只有家庭成員能讀取（RLS），照片放在私有空間。</li>
              <li>本機載入的官方地圖與這支手機的設定永遠不會上傳。</li>
            </>
          ) : (
            <>
              <li>未加入家庭同步時，沒有任何資料會上傳。</li>
              <li>孩子名字、生日、照片、蓋章與 kidZos 帳目，只存在這支手機的瀏覽器資料庫（IndexedDB）。</li>
              <li>除非你自己匯出 ZIP，資料不會離開這支手機。</li>
            </>
          )}
        </ul>
      </Card>

      {trashCount > 0 && (
        <Card title="最近刪除">
          <TrashSection onMessage={setToast} />
        </Card>
      )}

      {familySynced ? (
        <Card title="登出並清除本機快取" tone="danger">
          <p className="text-sm text-ink/70">
            已加入家庭同步：清除這支手機的家庭紀錄、照片與帳目，並登出。雲端資料保留（不會刪除家人看到的紀錄），重新登入後會再下載。設定與本機官方地圖保留。
          </p>
          <button type="button" onClick={() => setSignOutOpen(true)} className="mt-3 w-full rounded-2xl py-3 font-bold text-red-700 ring-1 ring-red-300">
            登出並清除本機快取…
          </button>
          <SignOutDialog open={signOutOpen} onClose={() => setSignOutOpen(false)} onMessage={setToast} />
        </Card>
      ) : (
        <Card title="清除本機資料" tone="danger">
          <p className="text-sm text-ink/70">刪除這支手機上的全部紀錄、照片、帳目、孩子資料與本機官方地圖。無法復原，建議先匯出備份。</p>
          <button type="button" onClick={() => setClearOpen(true)} className="mt-3 w-full rounded-2xl py-3 font-bold text-red-700 ring-1 ring-red-300">
            清除本機資料…
          </button>
        </Card>
      )}

      <footer className="mt-8 space-y-1 text-center text-[11px] leading-relaxed text-ink/45">
        <p>KidZania 職業護照 v{__APP_VERSION__}・非官方家庭紀錄工具，與 KidZania 無關。</p>
        <p>職業資料整理自官方網站與城市地圖，實際條件以園區現場公告與官方網站為準。</p>
        <a href={OFFICIAL_SITE} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold underline">
          KidZania Taipei 官方網站 <IconExternal className="h-3 w-3" />
        </a>
      </footer>

      {/* 匯出完成：分享（iPhone 存到「檔案」） */}
      <BottomSheet open={!!shareFile} title="備份檔已準備好" onClose={() => setShareFile(null)}>
        {shareFile && (
          <div className="mt-2 pb-2">
            <p className="text-sm text-ink/65">
              {shareFile.name}（{(shareFile.size / 1024 / 1024).toFixed(1)} MB）
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.share({ files: [shareFile], title: '職業護照備份' }).then(
                  () => setShareFile(null),
                  () => undefined,
                );
              }}
              className="mt-3 w-full rounded-2xl bg-brand py-3 font-bold text-white"
            >
              分享／儲存到「檔案」
            </button>
            <button
              type="button"
              onClick={() => {
                downloadBlob(shareFile, shareFile.name);
                setShareFile(null);
              }}
              className="mt-2 w-full rounded-2xl bg-white py-3 font-bold ring-1 ring-ink/15"
            >
              直接下載
            </button>
          </div>
        )}
      </BottomSheet>

      {/* 匯入確認 */}
      <BottomSheet
        open={!!importFile}
        title="匯入備份"
        onClose={() => setImportFile(null)}
        footer={
          importInfo && (
            <button
              type="button"
              disabled={importing}
              onClick={() => void doImport()}
              className={`w-full rounded-2xl py-3 font-bold text-white disabled:opacity-60 ${importMode === 'replace' && !familySynced ? 'bg-red-600' : 'bg-brand'}`}
            >
              {importing ? '匯入中…' : familySynced ? '合併匯入並上傳' : importMode === 'replace' ? '取代並匯入' : '合併匯入'}
            </button>
          )
        }
      >
        {importError && <p className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">{importError}</p>}
        {importInfo && (
          <>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-center">
              {[
                ['匯出時間', formatDateTime(new Date(importInfo.exportedAt).getTime())],
                ['蓋章紀錄', `${importInfo.completions} 筆`],
                ['照片', `${importInfo.photos} 張`],
                ['入園／帳目', `${importInfo.visits}／${importInfo.ledger}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-white p-2.5 ring-1 ring-ink/5">
                  <dt className="text-xs text-ink/50">{k}</dt>
                  <dd className="font-bold">{v}</dd>
                </div>
              ))}
            </dl>
            {importInfo.officialMaps > 0 && <p className="mt-2 text-xs text-ink/50">內含 {importInfo.officialMaps} 張本機官方地圖。</p>}
            {familySynced ? (
              <p className="mt-4 rounded-2xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200">
                已加入家庭同步：只能<b>合併</b>匯入。備份裡的紀錄與照片會加進來並上傳給家人；同一筆以備份為準，不會刪除任何家庭紀錄。
              </p>
            ) : (
              <fieldset className="mt-4 space-y-2">
                <legend className="mb-1 text-sm font-bold text-ink/70">匯入方式</legend>
                {(
                  [
                    ['replace', '取代', '清空這支手機目前的資料，換成備份內容（換手機時用）'],
                    ['merge', '合併', '保留目前資料，把備份加進來；同一筆以備份為準'],
                  ] as const
                ).map(([v, label, hint]) => (
                  <label key={v} className={`flex items-start gap-2.5 rounded-2xl p-3 ring-1 ${importMode === v ? 'bg-white ring-brand' : 'ring-ink/10'}`}>
                    <input type="radio" name="mode" checked={importMode === v} onChange={() => setImportMode(v)} className="mt-1 h-4 w-4 accent-brand" />
                    <span>
                      <span className="block text-sm font-bold">{label}</span>
                      <span className="block text-xs text-ink/55">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
      </BottomSheet>

      <ConfirmDialog
        open={clearOpen}
        title="清除這支手機上的全部資料？"
        confirmLabel="永久清除"
        danger
        busy={clearText !== '清除'}
        onConfirm={() => void doClear()}
        onCancel={() => {
          setClearOpen(false);
          setClearText('');
        }}
      >
        <p>
          {counts.completions} 筆紀錄、{counts.photos} 張照片、所有帳目與孩子資料都會刪除，無法復原。
        </p>
        <label className="mt-3 block">
          <span className="text-sm">請輸入「清除」確認：</span>
          <input
            type="text"
            value={clearText}
            onChange={(e) => setClearText(e.target.value)}
            className="mt-1 w-full rounded-xl bg-white px-3 py-2 text-base ring-1 ring-ink/20 outline-none focus:ring-2 focus:ring-red-500"
            autoComplete="off"
          />
        </label>
      </ConfirmDialog>

      <Toast text={toast} onDone={() => setToast(null)} />
    </main>
  );
}

function OfficialMapRow({ floor, loadedId, onMessage }: { floor: Floor; loadedId: string | null; onMessage: (m: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (ref.current) ref.current.value = '';
    if (!f) return;
    if (f.type === 'application/pdf') {
      onMessage('請先把 PDF 轉成圖片再載入');
      return;
    }
    setBusy(true);
    try {
      const { blob, width, height } = await prepareMapImage(f);
      await saveOfficialMap(floor, blob);
      onMessage(looksLikeFullPage(width, height) ? `${floor}F 官方地圖已載入` : `${floor}F 已載入，但圖片比例不像整頁，圖釘可能對不準`);
    } catch {
      onMessage('這張圖片無法讀取');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-paper p-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black text-white ${floor === 1 ? 'bg-brand' : 'bg-teal-600'}`}>
        {floor}F
      </span>
      <span className="min-w-0 flex-1 text-sm">{loadedId ? <b className="text-earn">已載入 ✓</b> : <span className="text-ink/50">未載入</span>}</span>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="rounded-full bg-white px-3 py-1.5 text-sm font-bold ring-1 ring-ink/15 disabled:opacity-50"
      >
        {busy ? '處理中…' : loadedId ? '更換' : '選圖片'}
      </button>
      {loadedId && (
        <button
          type="button"
          onClick={() => void removeOfficialMap(floor).then(() => onMessage(`${floor}F 官方地圖已移除`))}
          className="rounded-full px-2 py-1.5 text-sm font-bold text-red-700"
        >
          移除
        </button>
      )}
    </div>
  );
}
