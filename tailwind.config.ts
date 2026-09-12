import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS v3 配置（**锁 v3，禁止升级 v4**，见 ARCHITECTURE.md §6）。
 *
 * 说明：颜色与字号的主真相源是 `src/theme.ts`（MUI 主题）。此处仅同步一份
 * 供 Tailwind 原子类使用，避免两套主题漂移。
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EEF3FF',
          100: '#DCE6FF',
          200: '#B9CDFF',
          300: '#8FADFF',
          400: '#5F88FF',
          500: '#2F6BFF',
          600: '#1F52DB',
          700: '#193FAD',
          800: '#16337F',
          900: '#122453',
        },
        ink: {
          900: '#1B1F27',
          700: '#3D4451',
          500: '#6B7280',
          300: '#9CA3AF',
          100: '#E5E7EB',
          50: '#F7F8FA',
        },
        warn: '#F59E0B',
        danger: '#E5484D',
        success: '#12A150',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Source Han Sans SC"',
          '"Noto Sans CJK SC"',
          '"WenQuanYi Micro Hei"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // 正文基线：≥16px（移动端优先 / 课堂投屏可读）
        xs: ['12px', '18px'],
        sm: ['14px', '22px'],
        base: ['16px', '26px'],
        lg: ['18px', '28px'],
        xl: ['20px', '30px'],
        '2xl': ['24px', '34px'],
        '3xl': ['30px', '40px'],
        '4xl': ['36px', '46px'],
      },
      spacing: {
        // 触控基线：所有可点击区域 ≥44×44
        touch: '44px',
        touchLg: '48px',
      },
      minHeight: {
        touch: '44px',
        touchLg: '48px',
      },
      minWidth: {
        touch: '44px',
      },
      borderRadius: {
        card: '16px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 2px 12px rgba(27, 31, 39, 0.06)',
        float: '0 8px 28px rgba(27, 31, 39, 0.12)',
      },
    },
  },
  plugins: [],
  // Tailwind 与 MUI/Emotion 共存：关闭 preflight，避免重置 MUI 组件样式
  corePlugins: {
    preflight: false,
  },
};

export default config;
