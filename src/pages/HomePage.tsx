import { useCallback, useEffect, useMemo, useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SchoolIcon from '@mui/icons-material/School';
import { useNavigate } from 'react-router-dom';
import { PromptInput } from '@/components/generate/PromptInput';
import { TypeSelector } from '@/components/generate/TypeSelector';
import { ExampleChips } from '@/components/generate/ExampleChips';
import { AppCard } from '@/components/square/AppCard';
import { AiDisclaimer } from '@/components/common/AiDisclaimer';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { SystemNoticeBanner } from '@/components/common/SystemNoticeBanner';
import { useAuth } from '@/hooks/useAuth';
import { loginPath, ROUTES } from '@/config/routes';
import { DOC_TYPES, MIN_PROMPT_LENGTH } from '@/config/constants';
import { PRIMARY, SECONDARY } from '@/theme';
import * as squareService from '@/services/squareService';
import type { SquareItem } from '@/types/models';
import type { AppType } from '@/types/enums';

/**
 * 首页（UI-1）。
 *
 * 视觉改版参考 www.haoyue01.cn（皓月运动会）的设计语言：超大主标题 + 副标题 +
 * 单一主 CTA 的 Hero、数据背书条、01–05 编号的核心亮点卡片、卡片网格入口区、
 * 底部 CTA。整体气质向「清新校园风」靠拢——留白充足、圆角、轻渐变、不花哨。
 *
 * 内容面向「师创 · 教师 AI 备课办公台」，与参考站的运动会主题无关。
 *
 * 未登录可看（P0-A3 硬性）：热门应用直接展示，
 * 但点「生成」会带 `?redirect=` 跳登录，登录后自动回到生成页并保留提示词。
 *
 * 设计约束（来自主理人）：
 * - 保留四个备课入口（写教案 / 做 PPT / 3D 课件 / 办公文档）作为核心功能区，卡片网格呈现；
 * - 底部保留「做互动应用」入口（即原提示词输入区）；
 * - 不改动除 HomePage 以外的业务组件；保持对 PromptInput / TypeSelector /
 *   ExampleChips / AppCard / AiDisclaimer 的引用不变；
 * - 配色沿用现有主题主色（PRIMARY / SECONDARY），不引入冲突新色板。
 */

/**
 * 数据背书条（占位示意）。
 *
 * ⚠️ 待补真实数据：以下数值均为「占位示意」，并非真实统计，正式上线前必须替换为
 * 后端统计接口返回的真实数字，禁止把这里的占位值当真对外宣传。
 */
const STATS: readonly { value: string; unit: string; label: string }[] = [
  { value: '1,200', unit: '+', label: '已服务的学校' },
  { value: '38', unit: '万+', label: '生成的备课物料' },
  { value: '120', unit: '万+', label: '累计节省备课工时（小时）' },
  { value: '15', unit: '个', label: '覆盖学科' },
];

/** 核心亮点（01–05 编号卡片）。 */
const FEATURES: readonly { no: string; icon: string; title: string; desc: string }[] = [
  {
    no: '01',
    icon: '📝',
    title: '上传教材大纲，AI 写教案',
    desc: '上传章节要求或教材截图，几分钟产出教学目标、重难点、教学过程与作业，可直接打印。',
  },
  {
    no: '02',
    icon: '📊',
    title: '一句话生成 PPT 课件',
    desc: '描述主题与年级，自动分页并配演讲者备注，课堂直接放映，告别熬夜排版。',
  },
  {
    no: '03',
    icon: '🧊',
    title: '3D 课件，让知识转起来',
    desc: '几何、分子、天体等可旋转拆解的 Three.js 3D 模型，抽象概念一眼看懂。',
  },
  {
    no: '04',
    icon: '📄',
    title: '办公文档自动整理',
    desc: '通知、计划、总结、发言稿，套模板一键成稿，行政事务不再挤压备课时间。',
  },
  {
    no: '05',
    icon: '✨',
    title: '互动应用，链接即发',
    desc: '闯关、点名、单词卡……一句话生成网页应用，一个链接或二维码发班级群就能用。',
  },
];

/** 文档入口图标（UI-1，沿用既有映射）。 */
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

/** 区块小标题（eyebrow + 主标题）样式，统一各 section 视觉节奏。 */
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <Stack spacing={0.75} sx={{ mb: { xs: 2.5, sm: 3 } }}>
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1,
          color: 'primary.main',
          textTransform: 'uppercase',
        }}
      >
        {eyebrow}
      </Typography>
      <Typography sx={{ fontSize: { xs: 22, sm: 28 }, fontWeight: 800, color: 'text.primary' }}>
        {title}
      </Typography>
    </Stack>
  );
}

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

  /** 跳转生成页（未登录带 redirect）。 */
  const goGenerate = useCallback(() => {
    navigate(user ? ROUTES.GENERATE : loginPath(ROUTES.GENERATE));
  }, [user, navigate]);

  const heroSubtitle = useMemo(
    () =>
      brand.subSlogan ||
      '写教案、做 PPT、3D 课件、办公文档、互动应用——一个 AI 备课台全帮你搞定。',
    [brand.subSlogan],
  );

  return (
    <Box sx={{ py: { xs: 2, sm: 3 } }}>
      <SystemNoticeBanner />

      {/* ================= Hero ================= */}
      <Box
        sx={{
          position: 'relative',
          textAlign: 'center',
          px: { xs: 2, sm: 4 },
          py: { xs: 6, sm: 8 },
          borderRadius: { xs: 4, sm: 6 },
          overflow: 'hidden',
          background: `linear-gradient(180deg, ${alpha(PRIMARY, 0.12)} 0%, ${alpha(
            PRIMARY,
            0.04,
          )} 55%, #FFFFFF 100%)`,
        }}
      >
        <Chip
          icon={<SchoolIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
          label={`${brand.name} · 教师 AI 备课办公台`}
          sx={{
            mb: 2.5,
            height: 34,
            borderRadius: 999,
            bgcolor: 'rgba(255,255,255,0.8)',
            border: '1px solid',
            borderColor: alpha(PRIMARY, 0.3),
            color: 'primary.main',
            fontWeight: 700,
            fontSize: 13,
            boxShadow: `0 2px 10px ${alpha(PRIMARY, 0.12)}`,
            '& .MuiChip-label': { px: 1.5 },
          }}
        />
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: 34, sm: 48, md: 56 },
            fontWeight: 800,
            lineHeight: 1.18,
            letterSpacing: '-0.5px',
            background: `linear-gradient(100deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            mx: 'auto',
            maxWidth: 760,
          }}
        >
          备课，交给 AI
        </Typography>
        <Typography
          sx={{
            fontSize: { xs: 15, sm: 18 },
            color: 'text.secondary',
            maxWidth: 620,
            mx: 'auto',
            mt: 2,
            lineHeight: 1.7,
          }}
        >
          {heroSubtitle}
        </Typography>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems="center"
          justifyContent="center"
          sx={{ mt: 3.5 }}
        >
          <Button
            variant="contained"
            size="large"
            onClick={goGenerate}
            endIcon={<ArrowForwardIcon />}
            sx={{
              minHeight: 52,
              px: 4,
              fontSize: 17,
              borderRadius: 999,
              width: { xs: '100%', sm: 'auto' },
              boxShadow: `0 10px 24px ${alpha(PRIMARY, 0.32)}`,
            }}
          >
            免费开始备课
          </Button>
          <Button
            variant="text"
            size="large"
            onClick={() => navigate(ROUTES.SQUARE)}
            sx={{ minHeight: 52, color: 'text.primary', fontWeight: 600, width: { xs: '100%', sm: 'auto' } }}
          >
            看看大家怎么做 ›
          </Button>
        </Stack>
      </Box>

      {/* ================= 数据背书条 ================= */}
      {/* 注：STATS 为占位示意（待补真实数据），非真实统计，上线前替换。 */}
      <Box
        sx={{
          mt: { xs: 3, sm: 4 },
          p: { xs: 2.5, sm: 3 },
          borderRadius: { xs: 4, sm: 5 },
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#fff',
          boxShadow: '0 2px 12px rgba(27,31,39,0.05)',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
            gap: { xs: 2, sm: 1 },
          }}
        >
          {STATS.map((s) => (
            <Box key={s.label} sx={{ textAlign: 'center', px: 1 }}>
              <Typography
                component="span"
                sx={{
                  fontWeight: 800,
                  fontSize: { xs: 26, sm: 34 },
                  lineHeight: 1.1,
                  background: `linear-gradient(120deg, ${PRIMARY}, ${SECONDARY})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {s.value}
                <Box component="span" sx={{ fontSize: { xs: 16, sm: 20 }, ml: 0.25 }}>
                  {s.unit}
                </Box>
              </Typography>
              <Typography sx={{ fontSize: { xs: 12, sm: 14 }, color: 'text.secondary', mt: 0.5 }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography
          sx={{
            textAlign: 'center',
            fontSize: 12,
            color: 'text.disabled',
            mt: 2,
          }}
        >
          以上为示意数据，正式上线前补充真实统计
        </Typography>
      </Box>

      {/* ================= 做互动应用（原提示词输入区，现前置到首屏下方） ================= */}
      <Box sx={{ mt: { xs: 5, sm: 7 } }}>
        <SectionHeading eyebrow="INTERACTIVE APPS" title="做互动应用 · 一句话生成" />
        <Box
          sx={{
            borderRadius: { xs: 4, sm: 5 },
            border: '1.5px solid',
            borderColor: 'divider',
            bgcolor: '#fff',
            p: { xs: 2, sm: 3 },
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

          <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mt: 1.5 }}>
            <Button
              variant="contained"
              size="large"
              onClick={handleSubmit}
              endIcon={<ArrowForwardIcon />}
              sx={{ minHeight: 52, px: 3.5, fontSize: 16, width: { xs: '100%', sm: 'auto' } }}
            >
              生成应用
            </Button>
          </Box>

          {/* 8 类胶囊 */}
          <Box sx={{ mt: 2.5 }}>
            <TypeSelector value={appType} onChange={setAppType} variant="chips" />
          </Box>

          {/* 示例 chips */}
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
      </Box>

      {/* ================= 大家都在用 ================= */}
      <Box sx={{ mt: { xs: 5, sm: 7 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.5 }}>
          <SectionHeading eyebrow="COMMUNITY" title="大家都在用" />
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

      {/* ================= 核心亮点（01–05） ================= */}
      <Box sx={{ mt: { xs: 5, sm: 7 } }}>
        <SectionHeading eyebrow="CORE FEATURES" title="一个台子，备齐全部课程物料" />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          {FEATURES.map((f) => (
            <Box
              key={f.no}
              sx={{
                p: { xs: 2.25, sm: 2.75 },
                borderRadius: { xs: 4, sm: 5 },
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#fff',
                boxShadow: '0 2px 12px rgba(27,31,39,0.05)',
                transition: 'transform .18s, box-shadow .18s, border-color .18s',
                '&:hover': {
                  transform: 'translateY(-3px)',
                  borderColor: 'primary.main',
                  boxShadow: `0 14px 30px ${alpha(PRIMARY, 0.16)}`,
                },
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.25 }}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 18,
                    color: '#fff',
                    background: `linear-gradient(135deg, ${PRIMARY}, ${SECONDARY})`,
                    boxShadow: `0 6px 16px ${alpha(PRIMARY, 0.28)}`,
                  }}
                >
                  {f.no}
                </Box>
                <Typography sx={{ fontSize: 22 }} aria-hidden="true">
                  {f.icon}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary' }}>
                {f.title}
              </Typography>
              <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.75, lineHeight: 1.7 }}>
                {f.desc}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ================= 备课入口区（四/五类一键入口，UI-1） ================= */}
      <Box sx={{ mt: { xs: 5, sm: 7 } }}>
        <SectionHeading eyebrow="DOCUMENTS" title="备课文档 · 一键生成" />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              md: 'repeat(5, minmax(0, 1fr))',
            },
            gap: 1.5,
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
                  p: 2,
                  borderRadius: 4,
                  border: '1.5px solid',
                  borderColor: 'divider',
                  bgcolor: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  minHeight: 104,
                  transition: 'border-color .15s, transform .15s, box-shadow .15s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    transform: 'translateY(-2px)',
                    boxShadow: `0 10px 22px ${alpha(PRIMARY, 0.14)}`,
                  },
                }}
              >
                <Typography sx={{ fontSize: 24 }} aria-hidden="true">
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

      {/* ================= 底部 CTA ================= */}
      <Box
        sx={{
          mt: { xs: 5, sm: 7 },
          p: { xs: 3.5, sm: 5 },
          borderRadius: { xs: 4, sm: 6 },
          textAlign: 'center',
          background: `linear-gradient(135deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
          color: '#fff',
          boxShadow: `0 16px 40px ${alpha(PRIMARY, 0.3)}`,
        }}
      >
        <Typography sx={{ fontSize: { xs: 22, sm: 30 }, fontWeight: 800, lineHeight: 1.3 }}>
          一节课的工夫，备好全部物料
        </Typography>
        <Typography sx={{ fontSize: { xs: 14, sm: 16 }, mt: 1, opacity: 0.9, maxWidth: 560, mx: 'auto' }}>
          写教案、做 PPT、3D 课件、办公文档、互动应用，现在就交给 AI。
        </Typography>
        <Button
          variant="contained"
          size="large"
          onClick={goGenerate}
          startIcon={<AutoAwesomeIcon />}
          sx={{
            mt: 3,
            minHeight: 52,
            px: 4,
            fontSize: 17,
            borderRadius: 999,
            bgcolor: '#fff',
            color: 'primary.main',
            fontWeight: 800,
            boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' },
          }}
        >
          免费开始备课
        </Button>
      </Box>

      <Divider sx={{ my: { xs: 4, sm: 5 }, borderColor: 'divider' }} />

      <Box>
        <AiDisclaimer />
      </Box>
    </Box>
  );
}

export default HomePage;
