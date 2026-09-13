import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PromptInput } from '@/components/generate/PromptInput';
import { TypeSelector } from '@/components/generate/TypeSelector';
import { CategoryEntry } from '@/components/generate/CategoryEntry';
import { DocTypeSelector } from '@/components/generate/DocTypeSelector';
import { TextbookCascade } from '@/components/generate/TextbookCascade';
import { AdvancedOptionsPanel, EMPTY_ADVANCED, type AdvancedOptions } from '@/components/generate/AdvancedOptions';
import { ExampleChips } from '@/components/generate/ExampleChips';
import { CostHint } from '@/components/generate/CostHint';
import { useAuth } from '@/hooks/useAuth';
import { useGenerate } from '@/hooks/useGenerate';
import { useTextbook } from '@/hooks/useTextbook';
import { useToast } from '@/components/common/ToastHost';
import { generatingPath, ROUTES } from '@/config/routes';
import { getAppTypeCost, getDocTypeCost, getDocTypeLabel, isDocTypeKey, MIN_PROMPT_LENGTH } from '@/config/constants';
import { REFUND_POLICY_TEXT } from '@/config/creditRules';
import { uuid } from '@/utils/hash';
import * as creditService from '@/services/creditService';
import { isAppType, type AppType } from '@/types/enums';
import type { Category, DocType } from '@/types/doc';
import type { GenerateRequest } from '@/types/api';

/**
 * 生成页（UI-2）。
 *
 * 支持 `?prompt=&type=&category=&remix=` 预填——「免费做一个同款」的增长闭环靠它（P0-C5）。
 *
 * T06 改造：顶部用 {@link CategoryEntry} 在「写文档」与「做应用」两条路径间切换；
 * category='doc' 时显示文档类型选择与教材级联（UI 壳），提交体携带 `category/docType/textbook*`。
 */
export function GeneratePage(): JSX.Element {
  const navigate = useNavigate();
  const { user, brand } = useAuth();
  const toast = useToast();
  const { start } = useGenerate();
  const { versions, options } = useTextbook();
  const [params] = useSearchParams();

  const [prompt, setPrompt] = useState('');
  const [category, setCategory] = useState<Category>('app');
  const [appType, setAppType] = useState<AppType>('auto');
  const [docType, setDocType] = useState<DocType>('lesson_plan');
  const [textbookVersionId, setTextbookVersionId] = useState<string | null>(null);
  const [chapter, setChapter] = useState('');
  const [advanced, setAdvanced] = useState<AdvancedOptions>(EMPTY_ADVANCED);
  const [error, setError] = useState('');
  const [estimated, setEstimated] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const remixId = params.get('remix') ?? '';

  // ---- 预填：来自首页输入、示例 chips 或「做一个同款」 ----
  useEffect(() => {
    const qPrompt = params.get('prompt') ?? '';
    const qType = params.get('type') ?? '';
    const qCategory = params.get('category') ?? '';
    if (qPrompt) setPrompt(qPrompt);
    if (qCategory === 'doc' && isDocTypeKey(qType)) {
      setCategory('doc');
      setDocType(qType);
    } else if (qType && isAppType(qType)) {
      setAppType(qType);
    }
  }, [params]);

  const balance = user?.account.balance ?? null;

  // ---- 生成前预估积分（P0-F2）----
  // ⚠️ 文档类也必须走 `estimate_cost` RPC 读配置表：否则会显示 constants.ts 里的
  //    兜底旧值，出现「页面显示 2 分、实际扣 3 分」这类信任事故（积分数值必须走配置表）。
  useEffect(() => {
    let alive = true;
    const type = category === 'doc' ? docType : appType;
    if (!type) return;
    void (async () => {
      try {
        const cost = await creditService.estimateCost(type);
        if (alive) setEstimated(cost);
      } catch {
        if (alive) setEstimated(category === 'doc' ? getDocTypeCost(docType) : getAppTypeCost(appType));
      }
    })();
    return () => {
      alive = false;
    };
  }, [category, docType, appType]);

  const cost = useMemo(
    () =>
      estimated ?? (category === 'doc' ? getDocTypeCost(docType) : getAppTypeCost(appType)),
    [estimated, category, docType, appType],
  );

  const handleSubmit = (): void => {
    const text = prompt.trim();
    if (text.length < MIN_PROMPT_LENGTH) {
      setError(`请简单描述一下你要做什么（至少 ${MIN_PROMPT_LENGTH} 个字）`);
      return;
    }
    if (!user) {
      navigate(ROUTES.LOGIN);
      return;
    }
    setError('');
    setSubmitting(true);

    const jobId = uuid();
    const common = {
      prompt: text,
      subject: advanced.subject || undefined,
      grade: advanced.grade || undefined,
      textbook: advanced.textbook || undefined,
      duration: advanced.duration || undefined,
      difficulty: advanced.difficulty || undefined,
      idempotencyKey: jobId,
    };

    const req: GenerateRequest =
      category === 'doc'
        ? {
            ...common,
            appType: docType,
            category: 'doc',
            docType,
            textbookVersionId,
            textbookContext: chapter.trim() || undefined,
          }
        : {
            ...common,
            appType,
            category: 'app',
          };

    start(req);
    toast.info(category === 'doc' ? '开始生成，正在为你整理文档…' : '开始生成，正在为你写代码…');
    navigate(generatingPath(jobId), { state: { remix: remixId } });
  };

  return (
    <Box sx={{ py: { xs: 2, sm: 3.5 }, maxWidth: 760, mx: 'auto' }}>
      {/* ---- 顶部返回 ---- */}
      <Button
        variant="text"
        size="large"
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(-1)}
        sx={{ minHeight: 44, color: 'text.secondary', mb: 1 }}
      >
        返回
      </Button>

      <Typography sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 800, lineHeight: 1.35 }}>
        你想生成什么？
      </Typography>
      <Typography sx={{ fontSize: 15, color: 'text.secondary', mt: 0.75, lineHeight: 1.7 }}>
        {remixId
          ? `已参考别人的作品，改改提示词就能变成你自己的版本。`
          : `用一句话描述，${brand.name} 会生成可以直接用的小应用或备课文档。`}
      </Typography>

      <Stack spacing={2.5} sx={{ mt: 2.5 }}>
        <PromptInput
          value={prompt}
          onChange={(v) => {
            setPrompt(v);
            if (error) setError('');
          }}
          minRows={4}
          error={error}
          helper="描述得越具体，效果越好：说清 学科 + 年级 + 玩法 + 题量"
          id="generate-prompt"
        />

        {/* ---- 产物大类切换 ---- */}
        <CategoryEntry
          value={category}
          onChange={(c) => {
            setCategory(c);
            setError('');
          }}
        />

        {category === 'doc' ? (
          <>
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.25 }}>文档类型</Typography>
              <DocTypeSelector value={docType} onChange={setDocType} />
            </Box>
            <TextbookCascade
              options={options}
              versions={versions}
              selectedVersionId={textbookVersionId}
              onSelectVersion={setTextbookVersionId}
              chapter={chapter}
              onChapterChange={setChapter}
            />
          </>
        ) : (
          <>
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.25 }}>应用类型</Typography>
              <TypeSelector value={appType} onChange={setAppType} variant="grid" />
            </Box>
            <AdvancedOptionsPanel value={advanced} onChange={setAdvanced} />
          </>
        )}

        <CostHint
          cost={cost}
          balance={balance}
          loading={estimated === null}
          note={REFUND_POLICY_TEXT}
        />

        <Button
          variant="contained"
          size="large"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={<AutoAwesomeIcon />}
          sx={{ minHeight: 54, fontSize: 17 }}
        >
          {submitting
            ? '正在开始…'
            : category === 'doc'
              ? `生成${getDocTypeLabel(docType)}（${cost} 积分）`
              : `生成应用（${cost} 积分）`}
        </Button>

        <Divider />

        {category === 'app' ? (
          <ExampleChips
            onPick={(text, type) => {
              setPrompt(text);
              setAppType(type);
              setError('');
            }}
          />
        ) : (
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.7 }}>
            提示：文档生成后会得到一份结构化内容，可在网页里直接查看、核对并分享链接，也可以一键导出打印（导出能力后续开放）。
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

export default GeneratePage;
