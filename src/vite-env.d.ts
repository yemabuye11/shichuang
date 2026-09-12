/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * 自定义环境变量的类型声明。
 *
 * ⚠️ 只有 `VITE_` 前缀的变量会出现在前端产物里。任何密钥都不得使用 `VITE_` 前缀。
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_BRAND_SLOGAN?: string;
  readonly VITE_BRAND_LOGO?: string;
  readonly VITE_PUBLIC_DOMAIN?: string;
  readonly VITE_ENABLE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** `*.svg` 作为 React 组件或 URL 导入。 */
declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}
