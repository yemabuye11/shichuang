import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from '@/App';
import { BRAND } from '@/config/brand';
import '@/styles/index.css';
import '@/styles/mui-overrides.css';

/**
 * 应用入口。
 *
 * PWA：`registerType:'autoUpdate'`，有新版本时自动激活并在下次刷新生效。
 */

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 挂载点，请检查 index.html');
}

// 标题从品牌配置注入，避免 index.html 硬编码产品名
document.title = `${BRAND.name} · ${BRAND.slogan}`;

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 注册 Service Worker（生产环境生效；开发环境由 vite.config.ts 关闭）
registerSW({
  immediate: true,
  onRegisteredSW(_url) {
    if (import.meta.env.DEV) console.debug('[PWA] Service Worker 已注册');
  },
  onRegisterError(error) {
    if (import.meta.env.DEV) console.warn('[PWA] 注册失败（不影响使用）', error);
  },
});
