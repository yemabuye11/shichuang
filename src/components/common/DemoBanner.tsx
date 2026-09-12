import { useState } from 'react';
import { Alert, Box, Button, Collapse, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { isMockMode } from '@/config/env';
import { BRAND } from '@/config/brand';
import { DEMO_BANNER_DETAIL, DEMO_BANNER_TEXT } from '@/config/creditRules';

/**
 * 演示模式提示条。
 *
 * 触发条件：`.env` 缺少 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，
 * 或显式设置 `VITE_ENABLE_MOCK=true`（见 `src/config/env.ts`）。
 *
 * 目的：客户（不懂代码的教务老师）在看到演示数据时**不会误以为是真实服务**。
 */
export function DemoBanner(): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  if (!isMockMode()) return null;

  return (
    <Box sx={{ px: { xs: 1.5, sm: 2 }, pt: 1.5 }}>
      <Alert
        severity="warning"
        icon={<InfoOutlinedIcon fontSize="inherit" />}
        variant="filled"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => setExpanded((v) => !v)}
            sx={{ minHeight: 36, whiteSpace: 'nowrap', fontWeight: 700 }}
          >
            {expanded ? '收起' : '说明'}
          </Button>
        }
        sx={{
          alignItems: 'center',
          borderRadius: 2,
          '& .MuiAlert-message': { width: '100%' },
          '& .MuiAlert-action': { alignItems: 'center', pt: 0 },
        }}
      >
        <Typography component="div" sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>
          {DEMO_BANNER_TEXT}
        </Typography>
        <Collapse in={expanded}>
          <Typography component="div" sx={{ fontSize: 13, mt: 1, lineHeight: 1.6, opacity: 0.95 }}>
            {DEMO_BANNER_DETAIL}。演示模式下 {BRAND.name} 的全部按钮都可以点、生成流程可以完整走一遍，
            但生成的是本地示例应用，不会调用真实大模型、不产生任何费用。
          </Typography>
        </Collapse>
      </Alert>
    </Box>
  );
}

export default DemoBanner;
