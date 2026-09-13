import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import { formatDateTime } from '@/utils/format';
import { isMockMode } from '@/config/env';
import * as adminService from '@/services/adminService';
import type { AdminUserView } from '@/services/adminService';

/**
 * 管理员「查看注册用户」列表（Q10 之外的客户新增需求）。
 *
 * 安全约束（与后端 admin_list_users RPC 配套）：
 * - 接口为 SECURITY DEFINER，仅 role='admin' 可调用，非管理员直接 42501；
 * - 每页 ≤ 50 条（后端已 clamp），分页上限 + 身份校验双重防爬；
 * - 邮箱 / 生成次数等 PII 不进任何视图、不下发到非 admin 客户端；
 * - 本组件整体处于 /admin 路由的 RequireAuth requireAdmin 守卫内，非管理员看不到入口。
 */

const PAGE_SIZE = 50;

export interface UserListProps {
  /** 数据加载失败时的回调（用于顶层 toast）。 */
  onError?: (message: string) => void;
}

export function UserList({ onError }: UserListProps): JSX.Element {
  const [items, setItems] = useState<AdminUserView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 0-based
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (targetPage: number, query: string) => {
      setLoading(true);
      setError('');
      try {
        const { items: rows, total: t } = await adminService.listUsers(
          query.trim(),
          targetPage * PAGE_SIZE,
          PAGE_SIZE,
        );
        setItems(rows);
        setTotal(t);
        setPage(targetPage);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '加载用户列表失败';
        setError(msg);
        onError?.(msg);
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    void load(0, '');
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 0.5 }}>
        <PeopleAltOutlinedIcon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>注册用户</Typography>
        {!loading ? (
          <Chip size="small" label={`共 ${total} 人`} sx={{ fontWeight: 700 }} />
        ) : null}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        查看注册用户的邮箱、昵称、注册时间、积分余额与生成次数。仅管理员可见，列表接口已做分页与身份校验。
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="按昵称或邮箱搜索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(0, q);
          }}
          InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: 'text.secondary' }} /> }}
          sx={{ flex: 1 }}
        />
        <Button variant="contained" onClick={() => void load(0, q)} disabled={loading} sx={{ minHeight: 40 }}>
          搜索
        </Button>
      </Stack>

      {isMockMode() ? (
        <Alert severity="info" sx={{ mb: 2 }}>演示模式：仅展示本机模拟账户，连接真实服务后读取云端用户。</Alert>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} action={
          <Box
            component="button"
            type="button"
            onClick={() => void load(page, q)}
            style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer', minHeight: 36 }}
          >
            重试
          </Box>
        }>
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} />
        </Stack>
      ) : items.length === 0 ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 3, textAlign: 'center' }}>
          没有匹配的用户
        </Typography>
      ) : (
        <TableContainer sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>昵称</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>邮箱</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>角色</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">积分余额</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">生成次数</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>注册时间</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>{u.nickname}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{u.email || '—'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={u.role === 'admin' ? '管理员' : '教师'}
                      color={u.role === 'admin' ? 'primary' : 'default'}
                      sx={{ fontWeight: 700 }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {u.balance}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {u.generationCount}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {formatDateTime(u.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="flex-end" sx={{ mt: 2 }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          第 {page + 1} / {totalPages} 页
        </Typography>
        <Button size="small" variant="outlined" disabled={!canPrev || loading} onClick={() => void load(page - 1, q)}>
          上一页
        </Button>
        <Button size="small" variant="outlined" disabled={!canNext || loading} onClick={() => void load(page + 1, q)}>
          下一页
        </Button>
      </Stack>
    </Box>
  );
}

export default UserList;
