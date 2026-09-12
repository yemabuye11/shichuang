import { useEffect, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { FilterBar } from '@/components/square/FilterBar';
import { SortTabs } from '@/components/square/SortTabs';
import { AppCard } from '@/components/square/AppCard';
import { LoadMoreButton } from '@/components/square/LoadMoreButton';
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { useSquareList } from '@/hooks/useSquareList';
import { useDebounce } from '@/hooks/useDebounce';
import { SQUARE_PAGE_SIZE } from '@/config/creditRules';
import { ROUTES } from '@/config/routes';
import { useNavigate } from 'react-router-dom';
import type { SquareSort } from '@/services/squareService';
import type { AppType } from '@/types/enums';

/**
 * 应用广场（UI-5）—— 公开，未登录可浏览（P0-A3 硬性）。
 *
 * 响应式：手机 1 列 / 平板 2 列 / 桌面 3–4 列；每页 ≤24 条。
 */
export function SquarePage(): JSX.Element {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<AppType | ''>('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [sort, setSortState] = useState<SquareSort>('latest');
  const debouncedKeyword = useDebounce(keyword, 300);

  const list = useSquareList({ sort: 'latest', limit: SQUARE_PAGE_SIZE });
  const { update, setSort, items, total, loading, loadingMore, error, hasMore, loadMore, reload } = list;

  // 搜索防抖 300ms 后才真正请求
  useEffect(() => {
    update({ q: debouncedKeyword.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKeyword]);

  const handleType = (v: AppType | ''): void => {
    setType(v);
    update({ type: v || undefined });
  };

  const handleSubject = (v: string): void => {
    setSubject(v);
    update({ subject: v || undefined });
  };

  const handleGrade = (v: string): void => {
    setGrade(v);
    update({ grade: v || undefined });
  };

  const handleSort = (v: SquareSort): void => {
    setSortState(v);
    setSort(v);
  };

  const clearFilters = (): void => {
    setKeyword('');
    setType('');
    setSubject('');
    setGrade('');
    update({ type: undefined, subject: undefined, grade: undefined, q: undefined });
  };

  const showEmpty = !loading && !error && items.length === 0;

  return (
    <Box sx={{ py: { xs: 2, sm: 3 } }}>
      <Typography sx={{ fontSize: { xs: 21, sm: 25 }, fontWeight: 800 }}>应用广场</Typography>
      <Typography sx={{ fontSize: 15, color: 'text.secondary', mt: 0.5, lineHeight: 1.7 }}>
        看看同行做了什么，喜欢就点个赞，也可以一键做个同款。
      </Typography>

      <Box sx={{ mt: 2.5 }}>
        <FilterBar
          keyword={keyword}
          onKeywordChange={setKeyword}
          type={type}
          onTypeChange={handleType}
          subject={subject}
          onSubjectChange={handleSubject}
          grade={grade}
          onGradeChange={handleGrade}
          total={total}
        />
      </Box>

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <SortTabs value={sort} onChange={handleSort} />
      </Box>

      <Box sx={{ mt: 2.5 }}>
        {loading ? <InlineLoading message="正在加载应用…" /> : null}

        {error ? (
          <EmptyState
            icon="😵"
            title="加载失败了"
            description={error}
            actionText="重新加载"
            onAction={reload}
          />
        ) : null}

        {showEmpty ? (
          <EmptyState
            icon="🔍"
            title="没有找到匹配的应用"
            description="换个关键词，或者把筛选条件放宽一点试试。"
            actionText="清除筛选"
            onAction={clearFilters}
            secondaryText="我自己做一个"
            onSecondary={() => navigate(ROUTES.GENERATE)}
          />
        ) : null}

        {!loading && items.length > 0 ? (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(1, minmax(0, 1fr))',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(3, minmax(0, 1fr))',
                  lg: 'repeat(4, minmax(0, 1fr))',
                },
                gap: 2,
              }}
            >
              {items.map((item) => (
                <AppCard key={item.id} item={item} />
              ))}
            </Box>

            <LoadMoreButton
              hasMore={hasMore}
              loading={loadingMore}
              loaded={items.length}
              total={total}
              onClick={loadMore}
            />
          </>
        ) : null}
      </Box>

      {!loading && items.length > 0 ? (
        <Stack sx={{ alignItems: 'center', mt: 1 }}>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 1 }}>
            没找到想要的？自己做一个更快。
          </Typography>
          <Button
            variant="contained"
            size="large"
            onClick={() => navigate(ROUTES.GENERATE)}
            sx={{ minHeight: 50, px: 3 }}
          >
            我要做一个
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}

export default SquarePage;
