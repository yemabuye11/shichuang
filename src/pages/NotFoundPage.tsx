import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { BRAND } from '@/config/brand';
import { ROUTES } from '@/config/routes';

/**
 * 404 页面。
 */
export function NotFoundPage(): JSX.Element {
  return (
    <Container maxWidth="sm">
      <Stack spacing={3} alignItems="center" textAlign="center" sx={{ py: 10 }}>
        <Typography sx={{ fontSize: 72, fontWeight: 800, lineHeight: 1, color: 'primary.main' }}>
          404
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          这个页面找不到了
        </Typography>
        <Typography variant="body2" color="text.secondary">
          链接可能已经失效，或者应用被作者取消了发布。要不回{BRAND.name}首页看看？
        </Typography>
        <Stack direction="row" spacing={1.5}>
          <Button component={RouterLink} to={ROUTES.HOME} variant="contained" size="large">
            回首页
          </Button>
          <Button component={RouterLink} to={ROUTES.SQUARE} variant="outlined" size="large">
            逛逛应用广场
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
}

export default NotFoundPage;
