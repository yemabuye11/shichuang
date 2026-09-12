import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';
import { PromptInput } from '@/components/generate/PromptInput';
import { TypeSelector } from '@/components/generate/TypeSelector';
import { ExampleChips } from '@/components/generate/ExampleChips';
import { AppCard } from '@/components/square/AppCard';
import { AiDisclaimer } from '@/components/common/AiDisclaimer';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { useAuth } from '@/hooks/useAuth';
import { loginPath, ROUTES } from '@/config/routes';
import { DOC_TYPES, MIN_PROMPT_LENGTH } from '@/config/constants';
import * as squareService from '@/services/squareService';
import type { SquareItem } from '@/types/models';
import type { AppType } from '@/types/enums';

/**
 * 首页（UI-1）。
 *
 * 未登录可看（P0-A3 硬性）：热门应用直接展示，
 * 但点「生成应用」会带 `?redirect=` 跳登录，登录后自动回到生成页并保留提示词。
 */

const STEPS: readonly { no: string; title: string; desc: string }[] = [
  { no: '①', title: '说出想法', desc: '用一句话描述你要什么，不用写代码' },
  { no: '②', title: 'AI 生成', desc: '几十秒产出一个能直接用的网页应用' },
  { no: '③', title: '分享链接', desc: '一个链接或二维码，发到班级群就能用' },
];

/** 文档类型入口图标（UI-1）。 */
const DOC_ENTRY_ICONS: Record<
  'lesson_plan' | 'ppt' | 'courseware_2d' | 'courseware_3d' | 'office_doc',
  string
> = {
  lesson_plan: '✍️',
  ppt: '📊',
  courseware_2d: '🖼️',
  courseware_3d: '🧊',
  office_doc: '📄',
};

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const { user, brand } = useAuth();

  const [prompt, setPrompt] = useState('');
  const [appType, setAppType] = useState<AppType>('auto');
  const [error, setError] = useState('');
  const [hot, setHot] = useState<SquareItem[]>([]);
  const [hotLoading, setHotLoading] = useState(true);

  // 热门应用：未登录也可读（`list_square` 是 SECURITY DEFINER，anon 可调用）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const page = await squareService.list({ sort: 'hottest', limit: 4 });
        if (alive) setHot([...page.items]);
      } catch {
        /* 首页热门失败不阻断主流程 */
      } finally {
        if (alive) setHotLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSubmit = useCallback(() => {
    const text = prompt.trim();
    if (text.length < MIN_PROMPT_LENGTH) {
      setError(`请先简单描述一下你要做什么（至少 ${MIN_PROMPT_LENGTH} 个字）`);
      return;
    }
    setError('');

    const params = new URLSearchParams({ prompt: text });
    if (appType !== 'auto') params.set('type', appType);
    const target = `${ROUTES.GENERATE}?${params.toString()}`;

    if (!user) {
      navigate(loginPath(target));
      return;
    }
    navigate(target);
  }, [prompt, appType, user, navigate]);

  const heroSubtitle = useMemo(
    () => brand.subSlogan || '不用写代码，生成后一个链接就能发给学生',
    [brand.subSlogan],
  );

  return (
    <Box sx={{ py: { xs: 3, sm: 5 } }}>
      {/* ---- Hero ---- */}
      <Stack spacing={2.5} alignItems="center" textAlign="center">
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: 28, sm: 38 },
            fontWeight: 800,
            lineHeight: 1.3,
            letterSpacing: '-0.5px',
          }}
        >
          {brand.slogan}
        </Typography>
        <Typography sx={{ fontSize: { xs: 16, sm: 18 }, color: 'text.secondary', maxWidth: 640 }}>
          {heroSubtitle}
        </Typography>
      </Stack>

      {/* ---- 输入区 ---- */}
      <Box sx={{ maxWidth: 760, mx: 'auto', mt: 3.5 }}>
        <Box
          sx={{
            borderRadius: 4,
            border: '1.5px solid',
            borderColor: 'divider',
            bgcolor: '#fff',
            p: { xs: 1.5, sm: 2 },
            boxShadow: '0 8px 30px rgba(27,31,39,0.06)',
          }}
        >
          <PromptInput
            value={prompt}
            onChange={(v) => {
              setPrompt(v);
              if (error) setError('');
            }}
            minRows={3}
            error={error}
            helper="描述得越具体，效果越好：说清 学科 + 年级 + 玩法 + 题量"
            id="home-prompt"
          />

          <Box
            sx={{
              display: 'flex',
              justifyContent: { xs: 'stretch', sm: 'flex-end' },
              mt: 1.5,
            }}
          >
            <Button
              variant="contained"
              size="large"
              onClick={handleSubmit}
              endIcon={<ArrowForwardIcon />}
              sx={{
                minHeight: 52,
                px: 3.5,
                fontSize: 16,
                width: { xs: '100%', sm: 'auto' },
              }}
            >
              生成应用
            </Button>
          </Box>
        </Box>

        {/* ---- 8 类胶囊 ---- */}
        <Box sx={{ mt: 2.5 }}>
          <TypeSelector value={appType} onChange={setAppType} variant="chips" />
        </Box>

        {/* ---- 示例 chips ---- */}
        <Box sx={{ mt: 2.5 }}>
          <ExampleChips
            onPick={(text, type) => {
              setPrompt(text);
              setAppType(type);
              setError('');
            }}
          />
        </Box>
      </Box>

      {/* ---- 备课文档：四（五）类一键入口（UI-1）---- */}
      <Box sx={{ mt: { xs: 4, sm: 5 } }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 18 }} aria-hidden="true">
            📚
          </Typography>
          <Typography sx={{ fontSize: 19, fontWeight: 700 }}>备课文档 · 一键生成</Typography>
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              md: 'repeat(5, minmax(0, 1fr))',
            },
            gap: 1.25,
          }}
        >
          {DOC_TYPES.map((doc) => {
            const icon = DOC_ENTRY_ICONS[doc.key as keyof typeof DOC_ENTRY_ICONS] ?? '📄';
            const to = `${ROUTES.GENERATE}?type=${encodeURIComponent(doc.key)}&category=doc`;
            return (
              <Box
                key={doc.key}
                component="button"
                type="button"
                onClick={() => navigate(user ? to : loginPath(to))}
                sx={{
                  textAlign: 'left',
                  p: 1.75,
                  borderRadius: 3,
                  border: '1.5px solid',
                  borderColor: 'divider',
                  bgcolor: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  minHeight: 92,
                  transition: 'border-color .15s, transform .15s',
                  '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)' },
                }}
              >
                <Typography sx={{ fontSize: 22 }} aria-hidden="true">
                  {icon}
                </Typography>
                <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{doc.label}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.45 }}>
                  {doc.hint}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* ---- 大家都在用 ---- */}
      <Box sx={{ mt: { xs: 5, sm: 6 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography sx={{ fontSize: 18 }} aria-hidden="true">
              🔥
            </Typography>
            <Typography sx={{ fontSize: 19, fontWeight: 700 }}>大家都在用</Typography>
          </Stack>
          <Button
            variant="text"
            size="large"
            onClick={() => navigate(ROUTES.SQUARE)}
            sx={{ minHeight: 44, color: 'primary.main', fontWeight: 600 }}
          >
            查看全部 ›
          </Button>
        </Stack>

        {hotLoading ? (
          <InlineLoading message="正在加载热门应用…" />
        ) : hot.length === 0 ? (
          <Typography sx={{ fontSize: 15, color: 'text.secondary', py: 3, textAlign: 'center' }}>
            还没有人发布应用，你可以成为第一个。
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(1, minmax(0, 1fr))',
                sm: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
              },
              gap: 2,
            }}
          >
            {hot.map((item) => (
              <AppCard key={item.id} item={item} hot />
            ))}
          </Box>
        )}
      </Box>

      {/* ---- 三步说明 ---- */}
      <Box
        sx={{
          mt: { xs: 5, sm: 6 },
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#fff',
          p: { xs: 2.5, sm: 3.5 },
        }}
      >
        <Typography
          sx={{ fontSize: 18, fontWeight: 700, textAlign: 'center', mb: 2.5 }}
        >
          三步搞定，不用学任何软件
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          {STEPS.map((s) => (
            <Box key={s.no} sx={{ textAlign: 'center', px: 1 }}>
              <Typography sx={{ fontSize: 30, lineHeight: 1 }} aria-hidden="true">
                {s.no}
              </Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 700, mt: 1 }}>{s.title}</Typography>
              <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.5, lineHeight: 1.7 }}>
                {s.desc}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<AutoAwesomeIcon />}
            onClick={() => navigate(user ? ROUTES.GENERATE : loginPath(ROUTES.GENERATE))}
            sx={{ minHeight: 50, px: 3 }}
          >
            免费做一个
          </Button>
        </Box>
      </Box>

      <Box sx={{ mt: 3 }}>
        <AiDisclaimer />
      </Box>
    </Box>
  );
}

export default HomePage;
