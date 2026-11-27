import { HashRouter, Outlet, Route, Routes } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { PageHeader } from './components/PageHeader';
import HomePage from './pages/HomePage';
import JobDetailPage from './pages/JobDetailPage';
import MapPage from './pages/MapPage';
import PassportPage from './pages/PassportPage';
import StampPage from './pages/StampPage';
import WalletPage from './pages/WalletPage';
import SettingsPage from './pages/SettingsPage';
import { UpdatePrompt } from './components/UpdatePrompt';

/** 有底部導覽的四個主頁 */
function TabLayout() {
  return (
    <div className="min-h-dvh">
      <Outlet />
      <BottomNav />
    </div>
  );
}

function NotFound() {
  return (
    <>
      <PageHeader title="找不到頁面" />
      <main className="mx-auto max-w-md px-4 py-10 text-center text-ink/60">這個頁面不存在。</main>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <UpdatePrompt />
      <Routes>
        <Route element={<TabLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/passport" element={<PassportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/job/:id" element={<JobDetailPage />} />
        <Route path="/passport/wallet" element={<WalletPage />} />
        <Route path="/job/:id/stamp" element={<StampPage mode="new" />} />
        <Route path="/completion/:id/edit" element={<StampPage mode="edit" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </HashRouter>
  );
}
