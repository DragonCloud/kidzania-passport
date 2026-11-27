import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// 捲動位置由各頁自己管理（總覽記住位置、詳情頁回到頂端），關掉瀏覽器自動還原以免互相覆蓋
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
