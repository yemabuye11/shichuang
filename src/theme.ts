import { createTheme, alpha, type ThemeOptions } from '@mui/material/styles';
import { BRAND } from '@/config/brand';

/**
 * MUI 主题（中文优先字体栈 + 移动端优先尺寸基线）。
 *
 * 基线要求（ARCHITECTURE.md §8.8）：
 * - 正文 ≥ 16px；
 * - 可点击区域 ≥ 44×44px，主按钮高度 ≥ 48px；
 * - 颜色对比度 ≥ 4.5:1。
 */

/** 主色（与 tailwind.config.ts 的 brand.500 保持一致）。 */
export const PRIMARY = '#2F6BFF';
/** 辅助色。 */
export const SECONDARY = '#7A5CFF';
/** 成功色。 */
export const SUCCESS = '#12A150';
/** 警告色。 */
export const WARNING = '#F59E0B';
/** 危险色。 */
export const ERROR = '#E5484D';

/** 中文优先字体栈。 */
export const FONT_STACK = [
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
].join(',');

const baseOptions: ThemeOptions = {
  palette: {
    mode: 'light',
    primary: { main: PRIMARY, contrastText: '#FFFFFF' },
    secondary: { main: SECONDARY, contrastText: '#FFFFFF' },
    success: { main: SUCCESS },
    warning: { main: WARNING },
    error: { main: ERROR },
    background: { default: '#F7F8FA', paper: '#FFFFFF' },
    text: { primary: '#1B1F27', secondary: '#6B7280' },
    divider: 'rgba(27,31,39,0.08)',
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: FONT_STACK,
    // 正文基线 16px
    fontSize: 16,
    htmlFontSize: 16,
    button: { fontSize: 16, fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    body1: { fontSize: 16, lineHeight: 1.625 },
    body2: { fontSize: 14, lineHeight: 1.6 },
    caption: { fontSize: 12, lineHeight: 1.5 },
    h1: { fontSize: 30, fontWeight: 700, lineHeight: 1.3 },
    h2: { fontSize: 24, fontWeight: 700, lineHeight: 1.35 },
    h3: { fontSize: 20, fontWeight: 700, lineHeight: 1.4 },
    h4: { fontSize: 18, fontWeight: 600, lineHeight: 1.45 },
    h5: { fontSize: 16, fontWeight: 600, lineHeight: 1.5 },
    h6: { fontSize: 16, fontWeight: 600, lineHeight: 1.5 },
  },
  breakpoints: {
    values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { fontSize: 16, WebkitTextSizeAdjust: '100%' },
        body: {
          fontFamily: FONT_STACK,
          backgroundColor: '#F7F8FA',
          // 移动端点击高亮
          WebkitTapHighlightColor: 'transparent',
        },
        // 全站禁止横向滚动条（移动优先）
        'html, body': { overscrollBehaviorY: 'none' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 12,
          paddingInline: 20,
          fontWeight: 600,
        },
        sizeLarge: { minHeight: 48, fontSize: 16, paddingInline: 24 },
        sizeSmall: { minHeight: 36, fontSize: 14, paddingInline: 14 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { minWidth: 44, minHeight: 44, borderRadius: 12 },
        sizeSmall: { minWidth: 36, minHeight: 36 },
      },
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: false },
      styleOverrides: {
        root: { '&:focus-visible': { outline: `2px solid ${PRIMARY}`, outlineOffset: 2 } },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'medium', fullWidth: true },
      styleOverrides: {
        root: {
          '& .MuiInputBase-root': { minHeight: 44, fontSize: 16 },
          '& .MuiInputLabel-root': { fontSize: 16 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { height: 36, fontSize: 14, borderRadius: 999 },
        clickable: { '&:hover': { backgroundColor: alpha(PRIMARY, 0.08) } },
      },
    },
    MuiTab: {
      styleOverrides: { root: { minHeight: 48, fontSize: 15, fontWeight: 600 } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { minHeight: 48 } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 16, margin: 16, width: '100%' } },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
  },
};

/**
 * 应用主题。
 *
 * 品牌名不进主题（主题只管视觉），品牌文案统一从 `@/config/brand` 读取。
 */
export const theme = createTheme({
  ...baseOptions,
  typography: {
    ...(baseOptions.typography as NonNullable<ThemeOptions['typography']>),
    // 保持品牌名在窗口标题等处的一致性（仅用于文档说明，不参与渲染）
    fontFamily: FONT_STACK,
  },
});

/**
 * 应用运行页 / 全屏上课场景用的深色主题外壳（可选）。
 *
 * 目的：投屏时降低平台外壳的存在感，让生成物成为视觉主体。
 */
export const presentTheme = createTheme({
  ...baseOptions,
  palette: {
    ...baseOptions.palette,
    mode: 'dark',
    background: { default: '#0B0D12', paper: '#141821' },
    text: { primary: '#F5F7FA', secondary: '#9CA3AF' },
    divider: 'rgba(255,255,255,0.10)',
  },
});

/** 与品牌主色相关的派生色，供 Tailwind 无法覆盖的场景使用。 */
export const brandAlpha = {
  subtle: alpha(PRIMARY, 0.08),
  soft: alpha(PRIMARY, 0.16),
  ring: alpha(PRIMARY, 0.32),
};

/** 默认导出主题，便于 `import theme from '@/theme'`。 */
export default theme;

/** 供调试/埋点使用的主题元信息。 */
export const THEME_META = {
  brand: BRAND.name,
  primary: PRIMARY,
} as const;
