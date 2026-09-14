import { useState, type ChangeEvent } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import BoltIcon from '@mui/icons-material/Bolt';
import RedeemIcon from '@mui/icons-material/Redeem';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { useNavigate } from 'react-router-dom';
import { LedgerList } from '@/components/credit/LedgerList';
import { RedeemCodeDialog } from '@/components/credit/RedeemCodeDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { SystemNoticeBanner } from '@/components/common/SystemNoticeBanner';
import { TypeChip } from '@/components/common/TypeChip';
import { useToast } from '@/components/common/ToastHost';
import { useAuth } from '@/hooks/useAuth';
import { useCredits } from '@/hooks/useCredits';
import { useMyApps } from '@/hooks/useMyApps';
import { updateProfile } from '@/services/authService';
import { ROUTES } from '@/config/routes';
import { appRunPath } from '@/config/routes';
import { formatDateTime, formatRelativeTime } from '@/utils/format';
import type { App } from '@/types/models';

/**
 * 个人中心 / 工作台（UI-6，桌面优先重做）。
 *
 * 布局：桌面两栏——左栏用户卡（头像 / 昵称可编辑 / 任教学科·学段·学校 / 会员身份与有效期）
 * + 积分看板；右栏 Tab 分区（我的生成记录 / 我发布的内容 / 积分流水 / 账号设置）。
 * 窄屏（< md）自动折叠为单栏。所有积分数值来自 useCredits（creditService），
 * 昵称编辑复用 authService.updateProfile，兑换/充值/退出/管理员入口全部保留。
 */
export function MePage(): JSX.Element {
  const navigate = useNavigate();
  const { user, isAdmin, signOut, setBalance, refresh } = useAuth();
  const { account, ledger, loading, refresh: refreshCredits } = useCredits();
  const { items: apps, loading: appsLoading } = useMyApps('all');
  const toast = useToast();

  const [tab, setTab] = useState(0);
  const [redeemOpen, setRedeemOpen] = useState(false);
  // 编辑昵称
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameError, setNicknameError] = useState('');

  const openEditNickname = (): void => {
    setNicknameDraft(user?.profile?.nickname ?? '');
    setNicknameError('');
    setNicknameOpen(true);
  };

  const handleSaveNickname = async (): Promise<void> => {
    const next = nicknameDraft.trim();
    if (!next) {
      setNicknameError('昵称不能为空');
      return;
    }
    if (next.length > 20) {
      setNicknameError('昵称最多 20 个字');
      return;
    }
    setNicknameSaving(true);
    setNicknameError('');
    try {
      await updateProfile({ nickname: next });
      await refresh();
      setNicknameOpen(false);
      toast.success('昵称已更新');
    } catch (err: unknown) {
      setNicknameError(err instanceof Error ? err.message : '更新昵称失败');
    } finally {
      setNicknameSaving(false);
    }
  };

  if (!user) {
    return <InlineLoading message="正在读取你的信息…" />;
  }

  const profile = user.profile;
  const membership = user.membership;
  const planName = membership?.plan?.name ?? '免费版';
  const membershipValid = membership?.expiresAt
    ? `有效期至 ${formatDateTime(membership.expiresAt)}`
    : '长期有效';

  const publishedApps = apps.filter((a) => a.status === 'published');
  const recentApps = apps.slice(0, 10);

  const openApp = (id: string): void => {
    navigate(appRunPath(id));
  };

  return (
    <Box sx={{ py: { xs: 2, sm: 3 } }}>
      <SystemNoticeBanner />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '340px 1fr' },
          gap: { xs: 2, md: 3 },
          alignItems: 'start',
        }}
      >
        {/* ============ 左栏：用户卡 + 积分看板 ============ */}
        <Stack spacing={2} sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>
          {/* 用户卡 */}
          <Paper
            elevation={0}
            sx={{ borderRadius: 3, p: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  bgcolor: 'primary.main',
                  color: '#fff',
                  fontSize: 24,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                {profile.nickname.slice(0, 1)}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.4 }} noWrap>
                    {profile.nickname}
                  </Typography>
                  <IconButton
                    aria-label="编辑昵称"
                    size="small"
                    onClick={openEditNickname}
                    sx={{ color: 'text.secondary' }}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }} noWrap>
                  {[profile.subject, profile.grade, profile.school].filter(Boolean).join(' · ') || '还没有填写学科与年级'}
                </Typography>
              </Box>
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip label={planName} size="small" color="primary" variant="outlined" />
            </Stack>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.75 }}>
              {membershipValid}
            </Typography>
          </Paper>

          {/* 积分看板（余额存在感） */}
          <Box
            sx={{
              borderRadius: 3,
              p: 2.5,
              color: '#fff',
              background: 'linear-gradient(135deg,#2F6BFF 0%, #7A5CFF 100%)',
              boxShadow: '0 8px 24px rgba(47,107,255,0.18)',
            }}
          >
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <BoltIcon sx={{ color: '#FFE08A' }} aria-hidden="true" />
              <Typography sx={{ fontSize: 15, fontWeight: 600, opacity: 0.95 }}>剩余积分</Typography>
            </Stack>
            <Typography sx={{ fontSize: 48, fontWeight: 800, lineHeight: 1.1, mt: 0.5, letterSpacing: '-0.5px' }}>
              {account?.balance ?? 0}
            </Typography>
            <Typography sx={{ fontSize: 13.5, opacity: 0.9, mt: 0.25 }}>
              共获得 {account?.totalEarned ?? 0} · 本月已用 {account?.totalUsed ?? 0}
            </Typography>
            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={<RedeemIcon />}
              onClick={() => setRedeemOpen(true)}
              sx={{
                minHeight: 46,
                mt: 1.75,
                bgcolor: '#fff',
                color: 'primary.main',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' },
              }}
            >
              兑换码充值
            </Button>
          </Box>

          {/* 自助充值 */}
          <Button
            variant="outlined"
            size="large"
            fullWidth
            startIcon={<PaidOutlinedIcon />}
            onClick={() => navigate(ROUTES.RECHARGE)}
            sx={{ minHeight: 48, borderRadius: 3, fontWeight: 700 }}
          >
            自助充值（扫码付款，管理员核对到账）
          </Button>

          {/* 退出登录 */}
          <Button
            variant="text"
            size="large"
            fullWidth
            startIcon={<LogoutIcon />}
            onClick={() => {
              void signOut();
              navigate(ROUTES.HOME);
            }}
            sx={{ minHeight: 44, color: 'text.secondary' }}
          >
            退出登录
          </Button>
        </Stack>

        {/* ============ 右栏：Tab 分区 ============ */}
        <Box>
          <Tabs
            value={tab}
            onChange={(_e, v: number) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}
          >
            <Tab icon={<AutoAwesomeOutlinedIcon />} iconPosition="start" label="我的生成记录" />
            <Tab icon={<LibraryBooksOutlinedIcon />} iconPosition="start" label="我发布的内容" />
            <Tab icon={<ReceiptLongOutlinedIcon />} iconPosition="start" label="积分流水" />
            <Tab icon={<SettingsOutlinedIcon />} iconPosition="start" label="账号设置" />
          </Tabs>

          {/* 我的生成记录 */}
          {tab === 0 ? (
            appsLoading ? (
              <InlineLoading message="正在加载我的生成…" />
            ) : recentApps.length === 0 ? (
              <EmptyState
                icon="✨"
                title="还没有做过应用"
                description="用一句话描述你的想法，几十秒就能做出一个可以发给学生的小应用。"
                actionText="去做第一个"
                onAction={() => navigate(ROUTES.GENERATE)}
              />
            ) : (
              <MyAppList apps={recentApps} onOpen={openApp} />
            )
          ) : null}

          {/* 我发布的内容 */}
          {tab === 1 ? (
            publishedApps.length === 0 ? (
              <EmptyState
                icon="📢"
                title="还没有发布到广场的内容"
                description="生成的应用点「发布」后会出现在这里，同行也能看到你的作品。"
                actionText="去生成"
                onAction={() => navigate(ROUTES.GENERATE)}
              />
            ) : (
              <MyAppList apps={publishedApps} onOpen={openApp} />
            )
          ) : null}

          {/* 积分流水 */}
          {tab === 2 ? (
            loading ? (
              <InlineLoading message="正在读取积分明细…" />
            ) : (
              <LedgerList items={ledger} emptyText="还没有积分记录，做第一个应用试试" />
            )
          ) : null}

          {/* 账号设置 */}
          {tab === 3 ? (
            <Stack spacing={1.5} sx={{ maxWidth: 420 }}>
              <Button
                variant="outlined"
                size="large"
                fullWidth
                startIcon={<EditOutlinedIcon />}
                onClick={openEditNickname}
                sx={{ minHeight: 48, borderRadius: 2.5, justifyContent: 'flex-start' }}
              >
                编辑昵称
              </Button>
              <Button
                variant="outlined"
                size="large"
                fullWidth
                startIcon={<PaidOutlinedIcon />}
                onClick={() => navigate(ROUTES.RECHARGE)}
                sx={{ minHeight: 48, borderRadius: 2.5, justifyContent: 'flex-start' }}
              >
                自助充值
              </Button>
              <Button
                variant="outlined"
                size="large"
                fullWidth
                startIcon={<RedeemIcon />}
                onClick={() => setRedeemOpen(true)}
                sx={{ minHeight: 48, borderRadius: 2.5, justifyContent: 'flex-start' }}
              >
                兑换码充值
              </Button>
              {isAdmin ? (
                <Button
                  variant="outlined"
                  size="large"
                  fullWidth
                  startIcon={<AdminPanelSettingsIcon />}
                  onClick={() => navigate(ROUTES.ADMIN)}
                  sx={{ minHeight: 48, borderRadius: 2.5, justifyContent: 'flex-start' }}
                >
                  进入管理员后台
                </Button>
              ) : null}
            </Stack>
          ) : null}
        </Box>
      </Box>

      <RedeemCodeDialog
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        onSuccess={(balance) => {
          setBalance(balance);
          void refreshCredits();
        }}
      />

      {/* 编辑昵称 Dialog */}
      <Dialog open={nicknameOpen} onClose={() => setNicknameOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>编辑昵称</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="昵称"
            value={nicknameDraft}
            onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              setNicknameDraft(e.target.value.slice(0, 20))
            }
            error={Boolean(nicknameError)}
            helperText={nicknameError || '最多 20 个字，方便别人知道这是谁的资源'}
            inputProps={{ 'aria-label': '昵称', maxLength: 20 }}
            sx={{ mt: 1, '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNicknameOpen(false)}>取消</Button>
          <Button onClick={() => void handleSaveNickname()} disabled={nicknameSaving} variant="contained">
            {nicknameSaving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** 我的应用列表行（两个 Tab 复用）。 */
function MyAppList({ apps, onOpen }: { apps: readonly App[]; onOpen: (id: string) => void }): JSX.Element {
  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', overflow: 'hidden' }}>
      {apps.map((app, index) => (
        <Box key={app.id}>
          {index > 0 ? <Divider /> : null}
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ px: 2, py: 1.5, minHeight: 68, cursor: 'pointer' }}
            onClick={() => onOpen(app.id)}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 15.5,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {app.title}
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }}>
                <TypeChip type={app.appType} />
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  {app.status === 'published' ? '已发布' : app.status === 'taken_down' ? '已下架' : '未发布'}
                  {' · '}
                  {formatRelativeTime(app.createdAt)}
                </Typography>
              </Stack>
            </Box>
            <ChevronRightIcon sx={{ color: 'text.disabled' }} />
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

export default MePage;
