import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePassport } from '../../hooks/usePassport';
import { formatDateTime, formatISODate, localDateISO } from '../../lib/format';
import { PassportFixBanner } from './PassportFix';
import { LEVEL_LABEL } from '../../lib/passport';
import { recordUpgrade } from '../../lib/passportStore';
import { DateSheet } from './PassportSettings';
import { LevelChip } from './LevelChip';

/** 護照頁：市民等級與集章進度（同一職業每天 1 枚；升級要到現場換發，App 只做手動記錄） */
export function StampProgressCard() {
  const s = usePassport();
  const [upgrading, setUpgrading] = useState(false);
  if (!s.loaded) return null;
  if (!s.passport || !s.progress) {
    return (
      <Link to="/settings" className="mt-3 flex items-center justify-between gap-3 rounded-3xl bg-white p-4 text-sm shadow-sm ring-1 ring-ink/5">
        <span>
          <b className="block">B·KidZanian 市民護照</b>
          <span className="text-ink/55">記錄後可追蹤升級進度、蓋章自動加碼</span>
        </span>
        <span className="shrink-0 font-bold text-brand">設定 ›</span>
      </Link>
    );
  }
  const p = s.progress;
  const pct = Math.min(100, (p.count / p.needed) * 100);
  return (
    <section className="mt-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-ink/5" aria-label="市民等級">
      <div className="flex items-center justify-between gap-2">
        <LevelChip level={p.level} />
        {s.expiry.expiry && (
          <span className={`text-xs ${s.expiry.state === 'ok' ? 'text-ink/50' : 'font-bold text-amber-800'}`}>
            {s.expiry.state === 'expired' ? '已過期' : `有效至 ${formatISODate(s.expiry.expiry)}`}
          </span>
        )}
      </div>

      <PassportFixBanner />

      {p.nextLevel ? (
        <>
          <p className="mt-3 text-sm">
            {p.ready ? (
              <b className="text-earn">已集滿 {p.needed} 枚，可以到現場換發{LEVEL_LABEL[p.nextLevel]}！</b>
            ) : (
              <>
                距離{LEVEL_LABEL[p.nextLevel]}還差 <b className="text-xl font-black text-brand tabular-nums">{p.remaining}</b> 枚
              </>
            )}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={p.needed} aria-valuenow={Math.min(p.count, p.needed)}>
              <div className={`h-full rounded-full ${p.ready ? 'bg-earn' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-bold tabular-nums text-ink/60">
              {Math.min(p.count, p.needed)}/{p.needed}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-ink/45">
            從 {formatDateTime(p.windowStartAt)} 起算；同一個職業每天只算 1 枚，辦護照前的章不算。實際以護照上的章為準。
          </p>
          <button
            type="button"
            onClick={() => setUpgrading(true)}
            className={`mt-3 w-full rounded-2xl py-2.5 text-sm font-bold ${p.ready ? 'bg-brand text-white' : 'ring-1 ring-ink/15'}`}
          >
            已在現場換發 → 記錄升{LEVEL_LABEL[p.nextLevel]}
          </button>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink/65">已是最高等級，所有權益都是最高檔。</p>
      )}

      {upgrading && p.nextLevel && (
        <DateSheet
          title={`記錄升${LEVEL_LABEL[p.nextLevel]}`}
          hint={`換發當天起套用${LEVEL_LABEL[p.nextLevel]}權益，集章從這天重新計算。`}
          today={s.today}
          onClose={() => setUpgrading(false)}
          onSave={(at) => recordUpgrade(localDateISO(at), undefined, at).then(() => undefined)}
        />
      )}
    </section>
  );
}

/** 首頁：護照有效期限；最後 90 天顯示提醒 */
export function PassportExpiryNote() {
  const s = usePassport();
  if (!s.loaded || !s.passport || !s.expiry.expiry) return null;
  const { state, daysLeft, expiry } = s.expiry;
  if (state === 'ok') {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-ink/55">
        {s.level && <LevelChip level={s.level} small />}護照有效至 {formatISODate(expiry)}
      </p>
    );
  }
  return (
    <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
      {state === 'expired' ? (
        <>市民護照已於 {formatISODate(expiry)} 到期，蓋章不再套用加碼。</>
      ) : (
        <>
          市民護照有效至 {formatISODate(expiry)}，<b>剩 {daysLeft} 天</b>。到期後權益停止，記得把握最後幾次入園！
        </>
      )}
    </p>
  );
}
