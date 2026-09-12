import { Box, Divider, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { BRAND } from '@/config/brand';
import { ROUTES } from '@/config/routes';

/**
 * 页脚：三步说明 + AI 声明 + 备案位。
 *
 * 仅在中大屏展示完整内容，移动端折叠为一行提示。
 */
export function Footer(): JSX.Element {
  const { brand } = useAuth();

  return (
    <Box component="footer" sx={{ mt: 6, pb: { xs: 10, sm: 4 }, px: 2 }}>
      <Divider sx={{ mb: 3 }} />
      <Stack spacing={1.5} alignItems="center" textAlign="center">
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          三步搞定：① 说出想法 → ② AI 生成 → ③ 分享链接
        </Typography>
        <Typography variant="caption" color="text.secondary">
          本平台的所有应用内容均由 AI 生成，请教师审核后再用于课堂。
        </Typography>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <Typography
            component={RouterLink}
            to={ROUTES.SQUARE}
            variant="caption"
            color="text.secondary"
            sx={{ '&:hover': { color: 'primary.main' } }}
          >
            应用广场
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {brand.name || BRAND.name} · 给老师用的一句话做课工具
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

export default Footer;
