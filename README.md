# KidZania 職業護照（非官方）

記錄孩子在 KidZania Taipei（台北市南港區經貿二路 131 號 5 樓，LaLaport 南港）的職業體驗：查職業、蓋章、拍照、記 kidZos。
這是家庭自用的非官方工具，與 KidZania 無關。實際遊玩條件以園區現場公告與官方網站為準。

- 技術：Vite + React + TypeScript + Tailwind v4 + Dexie（IndexedDB）+ vite-plugin-pwa
- 網址：`https://<GitHub 帳號>.github.io/kidzania-passport/`

## 開發

```bash
npm install
npm run dev          # http://localhost:5173/kidzania-passport/
npm test             # 單元測試
npm run typecheck
npm run build        # 會先檢查 JSON 與 CSV 一致，再型別檢查，最後打包
```

## 職業資料更新流程

1. 修改 `data-src/kidzania_taipei_jobs_v2.csv` 或 `data-src/facilities_v2.csv`
2. 執行 `npm run data`，重新產生 `src/data/jobs.json`、`facilities.json`
3. 一起提交 CSV 與 JSON（若 JSON 沒更新，`npm run build` 會失敗提醒）

轉換規則（`scripts/csv-to-json.mjs`）：

- 空白欄位一律轉成 `null`，不補任何數值
- 文字欄位只去掉頭尾空白
- `description` 原文保留；另拆出 `summary`（簡介）與 `note`（備註）：
  - 沒有官方頁的職業（披薩、大學），整段都當成備註
  - 燒肉職人從「官方經濟欄位」開始算備註
- 資料修正集中寫在 `CORRECTIONS`，會先核對原值才套用（目前只有救護員品牌去掉開頭的「Z 」）

## 部署到 GitHub Pages（repo：`kidzania-passport`）

### 第一次設定

1. 在 GitHub 右上角「＋」→ **New repository**
   - Repository name：`kidzania-passport`（必須是這個名字，網址路徑寫在 `vite.config.ts` 的 `BASE`）
   - 選 **Public**，不要勾選新增 README／.gitignore（專案裡已經有）
2. 在電腦上解壓專案資料夾，於資料夾內執行（把 `<帳號>` 換成你的 GitHub 帳號）：

   ```bash
   npm install
   npm test && npm run build    # 先確認本機能通過
   git init
   git add .
   git status                   # 確認清單裡沒有官方地圖、照片或備份 ZIP
   git commit -m "KidZania 職業護照 MVP"
   git branch -M main
   git remote add origin https://github.com/<帳號>/kidzania-passport.git
   git push -u origin main
   ```

3. GitHub repo 頁面 → **Settings** → 左側 **Pages** → Build and deployment 的 **Source** 選 **GitHub Actions**
4. 到 repo 的 **Actions** 分頁，等「Deploy to GitHub Pages」變成綠色勾勾（約 1–2 分鐘）。
   第一次 push 時 Pages 還沒啟用，若失敗，完成第 3 步後在該 workflow 按 **Re-run all jobs**。
5. 網址：`https://<帳號>.github.io/kidzania-passport/`

### 之後更新

修改程式或 CSV 後 `git add` → `git commit` → `git push`，GitHub 會自動測試、build、部署。
手機上已開啟的網站會出現「有新版本可以使用」提示，按「更新」即可（不會自動重新整理，避免蓋章填到一半被打斷）。

若改用其他 repo 名稱，請一併修改 `vite.config.ts` 裡的 `BASE`。

## 啟用家庭同步（Supabase 免費方案，選用）

不設定也能用：沒有 Supabase 設定時，網站以「本機模式」運作（設定頁顯示「此版本未啟用同步」）。
設定後，兩位家長各自登入同一個「家庭」，都能看、都能蓋章；離線也能用，連線後自動同步。照片放在私有空間，只有家庭成員看得到。
本機載入的官方地圖與各手機的偏好設定永遠不會上傳。


> [!CAUTION]
> **網站只能使用 anon（publishable）key。** 這把 key 會出現在公開網站的程式碼裡，這是設計如此：它只有「訪客」權限，資料由資料庫的 RLS 保護。
>
> | 可以用 ✅ | 絕對不可以用 ❌ |
> | --- | --- |
> | `sb_publishable_…`（新版 publishable key） | `sb_secret_…`（新版 secret key） |
> | 舊版 **anon** key（JWT，內容的 role 是 `anon`） | 舊版 **service_role** key（JWT，role 是 `service_role`） |
>
> secret／service_role key 可以略過所有 RLS、讀寫刪除全部資料。它不可以放進 GitHub Variables、`.env.local`、網站或任何聊天訊息。
> App 偵測到這類 key 會拒絕啟用同步，並在設定頁顯示警告。若不小心外流，請立刻到 Supabase **Project Settings → API Keys** 撤銷並重新產生。

### 1. 建立 Supabase 專案（約 15 分鐘，免費、不需信用卡）

1. 到 Supabase 官網，用 GitHub 或 email 註冊 → **New project**
   - 名稱：`kidzania-passport`
   - 區域：**Northeast Asia (Tokyo)** 或 Singapore
   - 設定資料庫密碼（自己保存）；方案選 **Free**
2. 左側 **SQL Editor** → **New query** → 貼上本 repo 的 [`supabase/schema.sql`](supabase/schema.sql) 整段 → **Run**
   - 這份 SQL 已包含新專案必要的 GRANT（2026-05-30 後的新專案不會自動開放資料表），以及「刪除優先」規則
   - `npm test` 會用 PGlite 實際執行這份 SQL 並檢查權限
3. **Authentication → Sign In / Providers → Email**：保持啟用，並**關閉「Confirm email」**（完全不需要寄信）
4. **Project Settings → API Keys**：複製 **Project URL** 與 **anon（publishable）key**
   - ⚠️ 只能複製 `sb_publishable_…` 或舊版 **anon** key；**不要**複製 secret／service_role key（見上方說明）
5. （選用：要用「email 驗證碼登入」時）**Authentication → Emails → Magic Link** 範本加入 `{{ .Token }}`。
   Supabase 內建寄信只寄給專案團隊成員、每小時 2 封：請把另一位家長的 email 邀請為組織成員，或設定自訂 SMTP。

### 2. 讓網站帶入設定

- **GitHub Pages**：repo → **Settings → Secrets and variables → Actions → Variables** 分頁 → **New repository variable**，新增兩個：

  | 名稱 | 值 |
  | --- | --- |
  | `VITE_SUPABASE_URL` | Project URL（`https://<專案代號>.supabase.co`） |
  | `VITE_SUPABASE_ANON_KEY` | anon（publishable）key ⚠️ 只能是這把 |

  新增後到 **Actions → Deploy to GitHub Pages → Run workflow** 重新部署。
  這兩個值會出現在公開網站的程式碼裡，這是正常的：資料由資料庫的 RLS 保護。
- **本機開發**：複製 `.env.example` 為 `.env.local` 並填入（`.env.local` 已在 `.gitignore`，不會提交）。

### 3. 兩位家長建立帳號與家庭

1. 第一位家長：App →「設定 → 家庭同步」→ 輸入 email 與密碼 →「註冊」→「建立家庭」→「產生邀請碼給家人」
2. 第二位家長：同樣「註冊」→ 輸入邀請碼（10 碼、7 天內有效、用過即失效）→「加入家庭」
3. **兩個帳號都建好後，到 Supabase → Authentication → Sign In / Providers，關閉「Allow new users to sign up」。**
   網站是公開的，若不關閉，任何人都能註冊帳號並使用你的免費額度（看不到你家的資料，但會占用空間）。
   關閉後 App 的「註冊」會顯示中文說明；「email 驗證碼登入」也只適用已存在的帳號。

### 4. 同步怎麼運作

- **離線優先**：所有操作先存在手機（IndexedDB），連上網路後自動上傳；園區沒網路也能蓋章、記帳。
  觸發時機：開啟 App、回到前景、恢復連線、每次修改後約 2 秒、收到家人的即時更新（Realtime），也可在「設定 → 家庭同步」按「立即同步」。
- **照片**：先上傳到私有 Storage，成功後才寫入紀錄；縮圖同步後立即下載，原圖在打開照片時才下載（省流量）。
- **衝突**：同一筆紀錄兩人都改過時，以「最後送到雲端」的為準。
- **刪除優先**：已刪除的紀錄不會因為另一支手機較晚送達的舊修改而復活。刪除的蓋章紀錄會在「設定 → 最近刪除」保留 30 天，按「還原」（需連線）後兩支手機都會回來，照片與帳一起回來。
- **第一次接上家庭**：建立家庭的手機會把既有紀錄全部上傳（顯示「已上傳 n／m 張照片」）；加入家庭的手機若已有紀錄，可選「合併」或「捨棄本機、改用家庭資料」。孩子的名字與生日以家庭為準。
- **登出**：已加入家庭時，「登出」會一併清除這支手機的家庭資料快取（雲端保留，重新登入後再下載）；還有未上傳的資料時會先警告。
- **匯入備份**：已加入家庭時只能「合併」匯入，匯入的紀錄會上傳給家人。
- **永不上傳**：本機載入的官方地圖、各手機的設定（音效、地圖顯示等）。
- **狀態**：總覽頁右上角顯示 ✓ 已同步／↻ 同步中／離線・待送 n 筆；設定頁有詳細狀態與上次同步時間。

### 5. 免費專案會自動暫停

Supabase 免費專案一週內沒有活動會暫停（暫停前會寄信通知專案擁有者）。

- `.github/workflows/keepalive.yml` 每天呼叫一次 `keepalive()`，使用同樣的兩個 Variables；未設定時自動略過
- 公開 repo 60 天沒有任何 commit，GitHub 會停用排程 workflow（會寄信），到 Actions 頁按啟用即可
- 若專案已暫停：到 Supabase 後台打開專案，按 **Resume project**（暫停後 1 年內資料都在）
- App 連不上時一律視為離線，紀錄留在手機；恢復後自動補送

## 在手機上「加入主畫面」

加入主畫面後會像 App 一樣全螢幕開啟、可離線使用，瀏覽器也比較不會清掉本機資料。

### iPhone／iPad（必須用 Safari）

1. 用 **Safari** 開啟 `https://<帳號>.github.io/kidzania-passport/`
   （從 LINE、Facebook 點開的是內建瀏覽器，請先點「用 Safari 開啟」）
2. 點下方工具列的「分享」按鈕（方框加向上箭頭）
3. 往下滑，選「**加入主畫面**」→ 名稱保留「職業護照」→ 右上「加入」
4. 之後一律從主畫面的「職業護照」圖示開啟。
   注意：Safari 分頁和主畫面 App 的資料是分開的，請固定用主畫面那個。

### Android（Chrome）

1. 用 **Chrome** 開啟網址
2. 右上角「⋮」→「**安裝應用程式**」（或「加到主畫面」）→ 安裝
3. 之後從主畫面或應用程式清單開啟「職業護照」

### 第一次開啟後

1. 在總覽頁輸入孩子名字（選填）與生日 → 儲存
2. 看到「已可離線使用」提示，代表園區沒網路也能用
3. 到「設定」確認「加入主畫面：已加入 ✓」
4. 每次玩完，到「設定 → 匯出備份 ZIP」，存到「檔案」或雲端硬碟。換手機時用「從備份 ZIP 匯入 → 取代」還原

## ⚠️ 公開 repo 不可放的東西

- 官方城市地圖 PDF、官方平面圖、官方插畫與商標圖（`.gitignore` 已排除常見檔名，例如 `official_map*.pdf`、`maphi-*.jpg`）
- 孩子的姓名、生日、照片：一律在手機上輸入或拍攝，只存在該裝置的 IndexedDB 與使用者自己匯出的備份 ZIP
- 備份 ZIP（`kidzania-backup-*.zip` 已排除）
- `.env.local`（Supabase 設定）與任何 `service_role`／`secret` key（`.env.local` 已排除）

官方地圖只能在「設定 → 官方地圖（只存在這支手機）」中由使用者自行載入，只存在本機。
請使用官方 PDF 的「整頁」輸出圖片（例如 300 dpi、3509×2481），圖釘才會對準。

## 資料保存提醒

- 未啟用家庭同步時，所有紀錄只存在該手機瀏覽器的 IndexedDB；啟用後同時存在你們家庭的 Supabase 專案。
- iOS Safari 可能清除久未開啟網站的資料；加入主畫面並定期匯出備份 ZIP。
- 「設定 → 清除本機資料」會刪除全部紀錄、照片與本機官方地圖，無法復原。
