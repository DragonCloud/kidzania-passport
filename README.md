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

官方地圖只能在「設定 → 官方地圖（只存在這支手機）」中由使用者自行載入，只存在本機。
請使用官方 PDF 的「整頁」輸出圖片（例如 300 dpi、3509×2481），圖釘才會對準。

## 資料保存提醒

- 所有紀錄只存在該手機瀏覽器的 IndexedDB，沒有雲端同步。
- iOS Safari 可能清除久未開啟網站的資料；加入主畫面並定期匯出備份 ZIP。
- 「設定 → 清除本機資料」會刪除全部紀錄、照片與本機官方地圖，無法復原。
