import { useState } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import { useNavigate } from 'react-router-dom';
import { CreditBoard } from '@/components/credit/CreditBoard';
import { LedgerList } from '@/components/credit/LedgerList';
import { RedeemCodeDialog } from '@/components/credit/RedeemCodeDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { SystemNoticeBanner } from '@/components/common/SystemNoticeBanner';
import { TypeChip } from '@/components/common/TypeChip';
import { useAuth } from '@/hooks/useAuth';
import { useCredits } from '@/hooks/useCredits';
import { useMyApps } from '@/hooks/useMyApps';
import { ROUTES } from '@/config/routes';
import { appRunPath } from '@/config/routes';
import { formatRelativeTime } from '@/utils/format';

/**
 * 个人中心 / 额度看板（UI-6）。
 */
export function MePage(): JSX.Element {
  const navigate = useNavigate();
  const { user, isAdmin, signOut, setBalance } = useAuth();
  const { account, ledger, loading, refresh } = useCredits();
  const { items: apps, loading: appsLoading } = useMyApps('all');

  const [redeemOpen, setRedeemOpen] = useState(false);
  const [showAllLedger, setShowAllLedger] = useState(false);

  if (!user) {
    return <InlineLoading message="正在读取你的信息…" />;
  }

  const profile = user.profile;
  const recentApps = apps.slice(0, 5);
  const visibleLedger = showAllLedger ? ledger : ledger.slice(0, 8);

  return (
    <Box sx={{ py: { xs: 2, sm: 3 }, maxWidth: 720, mx: 'auto' }}>
      <SystemNoticeBanner />

      {/* ---- 用户信息 ---- */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: 999,
            bgcolor: 'primary.main',
            color: '#fff',
            fontSize: 22,
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
          <Typography sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.4 }}>
            {profile.nickname}
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>
            {[profile.grade, profile.subject, profile.school].filter(Boolean).join(' · ') || '还没有填写学科与年级'}
          </Typography>
        </Box>
        <Button
          variant="text"
          size="large"
          startIcon={<LogoutIcon />}
          onClick={() => {
            void signOut();
            navigate(ROUTES.HOME);
          }}
          sx={{ minHeight: 44, color: 'text.secondary' }}
        >
          退出
        </Button>
      </Stack>

      {/* ---- 额度看板 ---- */}
      <Box sx={{ mt: 2.5 }}>
        <CreditBoard
          account={account}
          appCount={apps.length}
          onRedeem={() => setRedeemOpen(true)}
        />
      </Box>

      {/* ---- 充值入口 ---- */}
      <Box sx={{ mt: 1.5 }}>
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
      </Box>

      {/* ---- 我的应用 ---- */}
      <Box sx={{ mt: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>我的应用（{apps.length}）</Typography>
          <Button
            variant="text"
            size="large"
            endIcon={<ChevronRightIcon />}
            onClick={() => navigate(ROUTES.MY_APPS)}
            sx={{ minHeight: 44, color: 'primary.main', fontWeight: 600 }}
          >
            全部
          </Button>
        </Stack>

        {appsLoading ? (
          <InlineLoading message="正在加载我的应用…" />
        ) : recentApps.length === 0 ? (
          <EmptyState
            icon="✨"
            title="还没有做过应用"
            description="用一句话描述你的想法，几十秒就能做出一个可以发给学生的小应用。"
            actionText="去做第一个"
            onAction={() => navigate(ROUTES.GENERATE)}
          />
        ) : (
          <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
            {recentApps.map((app, index) => (
              <Box key={app.id}>
                {index > 0 ? <Divider /> : null}
                <Stack
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  sx={{ px: 2, py: 1.5, minHeight: 68, cursor: 'pointer' }}
                  onClick={() => navigate(appRunPath(app.id))}
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
        )}
      </Box>

      {/* ---- 积分明细 ---- */}
      <Box sx={{ mt: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>积分明细</Typography>
          {ledger.length > 8 ? (
            <Button
              variant="text"
              size="large"
              onClick={() => setShowAllLedger((v) => !v)}
              sx={{ minHeight: 44, color: 'primary.main', fontWeight: 600 }}
            >
              {showAllLedger ? '收起' : '查看全部'}
            </Button>
          ) : null}
        </Stack>

        {loading ? (
          <InlineLoading message="正在读取积分明细…" />
        ) : (
          <LedgerList items={visibleLedger} emptyText="还没有积分记录，做第一个应用试试" />
        )}
      </Box>

      {/* ---- 管理员入口 ---- */}
      {isAdmin ? (
        <Box sx={{ mt: 3 }}>
          <Button
            variant="outlined"
            size="large"
            fullWidth
            startIcon={<AdminPanelSettingsIcon />}
            onClick={() => navigate(ROUTES.ADMIN)}
            sx={{ minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
          >
            进入管理员后台
          </Button>
        </Box>
      ) : null}

      <RedeemCodeDialog
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        onSuccess={(balance) => {
          setBalance(balance);
          void refresh();
        }}
      />
    </Box>
  );
}

export default MePage;
