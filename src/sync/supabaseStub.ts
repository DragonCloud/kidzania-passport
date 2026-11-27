/**
 * build 時沒有設定 VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY 時，vite.config.ts 會把
 * '@supabase/supabase-js' 指向這個空殼，網站不包含、也不預快取 supabase-js。
 * （執行時 syncEnabled=false，本來就不會呼叫到這裡。）
 */
export function createClient(): never {
  throw new Error('此版本未啟用同步');
}
