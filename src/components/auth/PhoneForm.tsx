import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';

/**
 * 手机号 + 验证码登录（**P1 预留，P0 不启用**）。
 *
 * 保留文件与 UI 骨架是为了「配置一次即可启用」：
 * 1. Supabase Auth 后台启用 Phone Provider 并配好短信服务商；
 * 2. `system_config.auth.providers` 加入 `"phone"`；
 * 3. 把 `src/services/authProvider/phone.ts` 的两个方法替换为真实实现。
 *
 * 在此之前，表单保持禁用并给出明确中文说明（ARCHITECTURE.md §3.6 Q2）。
 */
export interface PhoneFormProps {
  /** 切换到已启用的登录方式。 */
  onSwitch?: () => void;
}

export function PhoneForm({ onSwitch }: PhoneFormProps): JSX.Element {
  return (
    <Stack spacing={1.75}>
      <Alert severity="info" icon={<SmsOutlinedIcon />}>
        手机号验证码登录需要企业主体与短信签名报备，当前尚未启用。
      </Alert>

      <TextField
        label="手机号"
        value=""
        disabled
        placeholder="暂未开放"
        inputProps={{ 'aria-label': '手机号（暂未开放）' }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
      />
      <TextField
        label="验证码"
        value=""
        disabled
        placeholder="暂未开放"
        inputProps={{ 'aria-label': '验证码（暂未开放）' }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
      />

      <Button variant="contained" size="large" disabled sx={{ minHeight: 50 }}>
        登录 / 注册
      </Button>

      <Box sx={{ textAlign: 'center' }}>
        <Typography sx={{ fontSize: 12.5, color: 'text.disabled', lineHeight: 1.7 }}>
          学校如需开通，请联系平台管理员办理短信签名报备。
        </Typography>
        {onSwitch ? (
          <Button variant="text" size="large" onClick={onSwitch} sx={{ minHeight: 44, color: 'text.secondary' }}>
            用邮箱 + 密码登录
          </Button>
        ) : null}
      </Box>
    </Stack>
  );
}

export default PhoneForm;
