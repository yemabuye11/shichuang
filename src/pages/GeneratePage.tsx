import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PromptInput } from '@/components/generate/PromptInput';
import { TypeSelector } from '@/components/generate/TypeSelector';
import { CategoryEntry } from '@/components/generate/CategoryEntry';
import { DocTypeMultiSelect } from '@/components/generate/DocTypeMultiSelect';
import { OutlineImporter, type OutlineDraft } from '@/components/generate/OutlineImporter';
import { TemplateUploader, type TemplateFile } from '@/components/generate/TemplateUploader';
import { TextbookCascade } from '@/components/generate/TextbookCascade';
import { AdvancedOptionsPanel, EMPTY_ADVANCED, type AdvancedOptions } from '@/components/generate/AdvancedOptions';
import { ExampleChips } from '@/components/generate/ExampleChips';
import { CostHint } from '@/components/generate/CostHint';
import { useAuth } from '@/hooks/useAuth';
import { useGenerate } from '@/hooks/useGenerate';
import { useTextbook } from '@/hooks/useTextbook';
import { useToast } from '@/components/common/ToastHost';
import { generatingPath, ROUTES } from '@/config/routes';
import {
  getAppTypeCost,
  getDocTypeCost,
  getDocTypeLabel,
  getDocTypeMeta,
  isDocTypeKey,
  MIN_PROMPT_LENGTH,
} from '@/config/constants';
import { REFUND_POLICY_TEXT } from '@/config/creditRules';
import { openCourseResources, type OpenCourseResource } from '@/data/openCourseResources';
import { uuid } from '@/utils/hash';
import { estimateOutlinePageCount, inferOutlineTeachingContext } from '@/utils/outlineImport';
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
 * category='doc' 时显示文档类型多选 + 教材级联（UI 壳），提交体携带 `category/docType*`。
 *
 * 野马增强（一句话做课件）：保留大文本框为 PRIMARY 输入，下方仅在有需要时给出可选的
 * 上下文选项组（多格式勾选 / 时长 / 参考公开课 / 参考模板），不做成强制向导。
 */
export function GeneratePage(): JSX.Element {
  const navigate = useNavigate();
  const { user, brand } = useAuth();
  const toast = useToast();
  const { start } = useGenerate();
  const { versions, options, createVersion, loading: textbookLoading } = useTextbook();
  const [params] = useSearchParams();
  const location = useLocation();

  const [prompt, setPrompt] = useState('');
  const [creationMode, setCreationMode] = useState<'idea' | 'outline'>('idea');
  const [outline, setOutline] = useState<OutlineDraft | null>(null);
  const previousDocTypesRef = useRef<DocType[]>(['lesson_plan']);
  const [category, setCategory] = useState<Category>('app');
  const [appType, setAppType] = useState<AppType>('auto');
  // 文档类改为多选：一次可生成多种格式，积分分开计算（野马需求）。
  const [docTypes, setDocTypes] = useState<DocType[]>(['lesson_plan']);
  const [textbookVersionId, setTextbookVersionId] = useState<string | null>(null);
  const [chapter, setChapter] = useState('');
  const [advanced, setAdvanced] = useState<AdvancedOptions>(EMPTY_ADVANCED);
  // 参考公开课（仅传标题 + 来源作为提示，无法抓取外部视频正文）。
  const [referenceCourse, setReferenceCourse] = useState<{ title: string; source: string } | null>(null);
  // 上传的参考模板（.txt/.md 文本，截断后注入提示词）。
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateFile | null>(null);
  // T09：生成后是否发布到内容库（默认 false，需作者显式同意，保护隐私）。
  const [publishToLibrary, setPublishToLibrary] = useState(false);
  const [error, setError] = useState('');
  const [estimated, setEstimated] = useState<number | null>(null);
  // 文档类每种格式各自的预估积分（分开计费展示）。
  const [estMap, setEstMap] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  // estimate_cost 是网络请求；用户快速切换格式时，旧请求可能晚于新请求返回。
  // 用序号丢弃过期结果，避免出现“已选 PPT 却显示教案 + PPT 总价”的信任事故。
  const estimateRunRef = useRef(0);

  const remixId = params.get('remix') ?? '';

  // ---- 预填：来自首页输入、示例 chips 或「做一个同款」 ----
  useEffect(() => {
    const qPrompt = params.get('prompt') ?? '';
    const qType = params.get('type') ?? '';
    const qCategory = params.get('category') ?? '';
    if (qPrompt) setPrompt(qPrompt);
    if (qCategory === 'doc' && isDocTypeKey(qType)) {
      setCategory('doc');
      setDocTypes(isDocTypeKey(qType) ? [qType] : ['lesson_plan']);
    } else if (qType && isAppType(qType)) {
      setAppType(qType);
    }
  }, [params]);

  const balance = user?.account.balance ?? null;

  // ---- 生成前预估积分（P0-F2）----
  // ⚠️ 文档类也必须走 `estimate_cost` RPC 读配置表：否则会显示 constants.ts 里的
  //    兜底旧值，出现「页面显示 2 分、实际扣 3 分」这类信任事故（积分数值必须走配置表）。
  // 文档类：对每种勾选格式分别预估，得到分账 map，合计为本次总消耗。
  useEffect(() => {
    let alive = true;
    const runId = ++estimateRunRef.current;
    if (category === 'doc') {
      const types = docTypes;
      void (async () => {
        const map: Record<string, number> = {};
        await Promise.all(
          types.map(async (t) => {
            try {
              map[t] = await creditService.estimateCost(t);
            } catch {
              map[t] = getDocTypeCost(t);
            }
          }),
        );
        if (!alive || runId !== estimateRunRef.current) return;
        setEstMap(map);
        const sum = types.reduce((acc, t) => acc + (map[t] ?? getDocTypeCost(t)), 0);
        setEstimated(sum);
      })();
    } else {
      const type = appType;
      void (async () => {
        try {
          const cost = await creditService.estimateCost(type);
          if (alive && runId === estimateRunRef.current) setEstimated(cost);
        } catch {
          if (alive && runId === estimateRunRef.current) setEstimated(getAppTypeCost(appType));
        }
      })();
    }
    return () => {
      alive = false;
    };
  }, [category, docTypes, appType]);

  const cost = useMemo(
    () =>
      estimated ?? (category === 'doc' ? getDocTypeCost(docTypes[0]) : getAppTypeCost(appType)),
    [estimated, category, docTypes, appType],
  );

  const durationChip: string =
    advanced.duration === '40分钟'
      ? '40分钟'
      : advanced.duration === '45分钟'
        ? '45分钟'
        : '__other';

  const handleDurationChip = (value: string | null): void => {
    if (value === '40分钟' || value === '45分钟') {
      setAdvanced((prev) => ({ ...prev, duration: value }));
    } else {
      // 选「其他时长」或取消选择 → 时长交给高级设置决定（清空，避免误带 40/45）。
      setAdvanced((prev) => ({ ...prev, duration: '' }));
    }
  };

  const handleReferenceChange = (title: string): void => {
    if (!title) {
      setReferenceCourse(null);
      return;
    }
    const found: OpenCourseResource | undefined = openCourseResources.find((r) => r.title === title);
    if (found) setReferenceCourse({ title: found.title, source: found.source });
  };

  const handleSubmit = (): void => {
    const text = prompt.trim();
    const outlineText = creationMode === 'outline' ? outline?.content.trim() ?? '' : '';
    const derivedPrompt = outlineText
      .split('\n')
      .map((line) =>
        line
          .replace(/^#+\s*/, '')
          .replace(/^第\s*\d+\s*页\s*[｜|:：-]?\s*/, '')
          .trim()
      )
      .find(Boolean);
    const derivedOutlinePrompt = derivedPrompt
      ? `${derivedPrompt.slice(0, 80)}${derivedPrompt.length < 4 ? ' 课件' : ''}`
      : '';
    const effectivePrompt = text || derivedOutlinePrompt;
    if (creationMode === 'outline' && outlineText.length < 20) {
      setError('请先粘贴大纲，或导入 PPTX / DOCX / 文本文件');
      return;
    }
    if (creationMode === 'idea' && text.length < MIN_PROMPT_LENGTH) {
      setError(`请简单描述一下你要做什么（至少 ${MIN_PROMPT_LENGTH} 个字）`);
      return;
    }
    if (!effectivePrompt) {
      setError('请补一句课题或生成要求');
      return;
    }
    if (!user) {
      navigate(ROUTES.LOGIN);
      return;
    }
    setError('');
    setSubmitting(true);

    const jobId = uuid();
    const outlinePages =
      creationMode === 'outline' && outlineText
        ? outline?.pageCount || estimateOutlinePageCount(outlineText)
        : 0;
    const requestedPptPages = outlinePages > 0
      ? Math.min(45, Math.ceil(outlinePages / 3) * 3)
      : undefined;
    const common = {
      prompt: effectivePrompt,
      subject: advanced.subject || undefined,
      grade: advanced.grade || undefined,
      textbook: advanced.textbook || undefined,
      duration: advanced.duration || undefined,
      difficulty: advanced.difficulty || undefined,
      idempotencyKey: jobId,
      publishToLibrary,
    };

    const req: GenerateRequest =
      category === 'doc'
        ? {
            ...common,
            appType: docTypes[0],
            category: 'doc',
            docType: docTypes[0],
            docTypes,
            textbookVersionId,
            textbookContext: chapter.trim() || undefined,
            templateContent: selectedTemplate?.content?.slice(0, 16000) || undefined,
            outlineContent: outlineText || undefined,
            referenceTitle: referenceCourse?.title || undefined,
            referenceSource: referenceCourse?.source || undefined,
            pptTotalPages: requestedPptPages,
            pptTotalParts: requestedPptPages ? Math.ceil(requestedPptPages / 3) : undefined,
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

  const loadingCost = estimated === null;
  const outlinePreviewText = outline?.content.trim() ?? '';

  return (
    <Box sx={{ py: { xs: 2, sm: 3.5 }, maxWidth: 760, mx: 'auto' }}>
      {/* ---- 顶部返回 ---- */}
      {/* 登录后 `/` 直接就是制作页（见 router.tsx 的 HomeOrGenerate），此时点「返回」
          执行 navigate(-1) 会直接退出站点，所以在根路径隐藏该按钮；
          从 /generate 等路径进来时照旧显示。 */}
      {location.pathname === '/' ? null : (
        <Button
          variant="text"
          size="large"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          sx={{ minHeight: 44, color: 'text.secondary', mb: 1 }}
        >
          返回
        </Button>
      )}

      <Typography sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 800, lineHeight: 1.35 }}>
        你想生成什么？
      </Typography>
      <Typography sx={{ fontSize: 15, color: 'text.secondary', mt: 0.75, lineHeight: 1.7 }}>
        {remixId
          ? `已参考别人的作品，改改提示词就能变成你自己的版本。`
          : `用一句话描述，${brand.name}           会生成可以直接用的小应用或备课文档。`}
      </Typography>

      <Stack spacing={2.5} sx={{ mt: 2.5 }}>
        {/* ---- 产物大类切换 ---- */}
        <CategoryEntry
          value={category}
          onChange={(c) => {
            setCategory(c);
            setError('');
            if (c === 'doc' && creationMode === 'outline') setDocTypes(['ppt']);
          }}
        />

        {category === 'doc' ? (
          <>
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.25 }}>生成方式</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={creationMode}
                onChange={(_event, value: 'idea' | 'outline' | null) => {
                  if (!value) return;
                  setCreationMode(value);
                  setError('');
                  if (value === 'outline') {
                    previousDocTypesRef.current = docTypes;
                    setDocTypes(['ppt']);
                  } else if (docTypes.length === 1 && docTypes[0] === 'ppt') {
                    setDocTypes(previousDocTypesRef.current.length > 0 ? previousDocTypesRef.current : ['lesson_plan']);
                  }
                }}
                sx={{ width: '100%' }}
              >
                <ToggleButton value="idea" sx={{ flex: 1, gap: 0.75 }}>
                  <AutoAwesomeIcon fontSize="small" />
                  一句话生成
                </ToggleButton>
                <ToggleButton value="outline" sx={{ flex: 1, gap: 0.75 }}>
                  <UploadFileIcon fontSize="small" />
                  导入大纲
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {creationMode === 'outline' ? (
              <Box>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.25 }}>大纲内容</Typography>
                <OutlineImporter
                  value={outline}
                  onChange={(next) => {
                    setOutline(next);
                    if (error) setError('');
                    if (next?.content) {
                      const inferred = inferOutlineTeachingContext(next.content, next.name ?? '');
                      setAdvanced((prev) => ({
                        ...prev,
                        subject: prev.subject || inferred.subject || '',
                        grade: prev.grade || inferred.grade || '',
                      }));
                    }
                  }}
                />
                {advanced.subject || advanced.grade ? (
                  <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.75 }}>
                    {advanced.grade ? <Chip size="small" label={`年级：${advanced.grade}`} color="primary" variant="outlined" /> : null}
                    {advanced.subject ? <Chip size="small" label={`学科：${advanced.subject}`} color="primary" variant="outlined" /> : null}
                  </Stack>
                ) : null}
                <Box sx={{ mt: 2 }}>
                  <PromptInput
                    value={prompt}
                    onChange={(value) => {
                      setPrompt(value);
                      if (error) setError('');
                    }}
                    minRows={2}
                    minLength={0}
                    error={error}
                    helper="补充要求（选填）"
                    id="generate-prompt"
                  />
                </Box>
              </Box>
            ) : (
              <PromptInput
                value={prompt}
                onChange={(value) => {
                  setPrompt(value);
                  if (error) setError('');
                }}
                minRows={4}
                error={error}
                helper="描述得越具体，效果越好：说清 学科 + 年级 + 玩法 + 题量"
                id="generate-prompt"
              />
            )}

            <Box>
              {creationMode === 'outline' ? (
                <>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.25 }}>输出格式</Typography>
                  <Chip
                    label={`PPT 课件${outlinePreviewText
                      ? ` · 预计 ${Math.min(45, Math.ceil((outline?.pageCount || estimateOutlinePageCount(outlinePreviewText)) / 3) * 3)} 页`
                      : ''}`}
                    color="primary"
                    variant="outlined"
                  />
                </>
              ) : (
                <>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.25 }}>文档类型（可多选）</Typography>
                  <DocTypeMultiSelect value={docTypes} onChange={setDocTypes} />
                </>
              )}
            </Box>

            {/* 时长 quick chips：仅在需要时给出，避免把整册 / 整学期都做掉 */}
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.75 }}>一节课时长（选填）</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={durationChip}
                onChange={(_e, v) => handleDurationChip(v)}
                sx={{ flexWrap: 'wrap' }}
              >
                <ToggleButton value="40分钟">40 分钟</ToggleButton>
                <ToggleButton value="45分钟">45 分钟</ToggleButton>
                <ToggleButton value="__other">其他时长</ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                选一节课时长，避免把整学期 / 整册都做掉
              </Typography>
            </Box>

            {/* 参考公开课 picker */}
            <FormControl size="small" fullWidth>
              <InputLabel id="ref-course-label">参考公开课（选填）</InputLabel>
              <Select
                labelId="ref-course-label"
                label="参考公开课（选填）"
                value={referenceCourse?.title ?? ''}
                onChange={(e) => handleReferenceChange(e.target.value as string)}
              >
                <MenuItem value="">不参考</MenuItem>
                {openCourseResources.map((r) => (
                  <MenuItem key={r.title} value={r.title}>
                    《{r.title}》（{r.source}）
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {referenceCourse ? (
              <Chip
                label={`参考：《${referenceCourse.title}》（${referenceCourse.source}）— 生成时会参照其结构，让内容更厚实`}
                onDelete={() => setReferenceCourse(null)}
                color="primary"
                variant="outlined"
                sx={{ alignSelf: 'flex-start', maxWidth: '100%' }}
              />
            ) : null}

            {/* 参考模板上传 */}
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.75 }}>参考模板（选填）</Typography>
              <TemplateUploader value={selectedTemplate} onChange={setSelectedTemplate} />
            </Box>

            <TextbookCascade
              options={options}
              versions={versions}
              selectedVersionId={textbookVersionId}
              onSelectVersion={setTextbookVersionId}
              chapter={chapter}
              onChapterChange={setChapter}
              onCreateVersion={async (input) => {
                const created = await createVersion(input);
                toast.success('教材版本已创建并绑定');
                return created;
              }}
              loading={textbookLoading}
            />

            <AdvancedOptionsPanel value={advanced} onChange={setAdvanced} />
          </>
        ) : (
          <>
            <PromptInput
              value={prompt}
              onChange={(value) => {
                setPrompt(value);
                if (error) setError('');
              }}
              minRows={4}
              error={error}
              helper="描述得越具体，效果越好：说清 学科 + 年级 + 玩法 + 题量"
              id="generate-prompt"
            />
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.25 }}>应用类型</Typography>
              <TypeSelector value={appType} onChange={setAppType} variant="grid" />
            </Box>
            <AdvancedOptionsPanel value={advanced} onChange={setAdvanced} />
          </>
        )}

        {/* ---- 积分提示：文档类单独展示分账，应用类沿用 CostHint ---- */}
        {category === 'doc' ? (
          <Box
            sx={{
              borderRadius: 2.5,
              px: 2,
              py: 1.25,
              bgcolor: 'rgba(47,107,255,0.05)',
              border: '1px solid',
              borderColor: 'rgba(47,107,255,0.14)',
            }}
          >
            {loadingCost ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 15 }}>
                估算中…
              </Typography>
            ) : (
              <>
                <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.primary', lineHeight: 1.6 }}>
                  {docTypes
                    .map((t) => `${getDocTypeMeta(t).label} ${estMap[t] ?? getDocTypeCost(t)}`)
                    .join(' + ')}
                  {' = '}
                  {estimated} 积分（分开计费，每份独立扣除）
                  {balance !== null ? (
                    <Typography component="span" sx={{ fontSize: 15, color: 'text.secondary' }}>
                      ，生成后剩余 {Math.max(balance - (estimated ?? 0), 0)} 积分
                    </Typography>
                  ) : null}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.6 }}>
                  可勾选多种格式；生成后也能在预览页一键导出 PPTX / Word / 网页（导出免费）
                </Typography>
              </>
            )}
          </Box>
        ) : (
          <CostHint cost={cost} balance={balance} loading={loadingCost} note={REFUND_POLICY_TEXT} />
        )}

        {/* ---- T09：生成后发布到内容库（默认不勾选，需作者显式同意） ---- */}
        <Box
          sx={{
            borderRadius: 2.5,
            px: 2,
            py: 1.25,
            bgcolor: 'rgba(47,107,255,0.05)',
            border: '1px solid',
            borderColor: 'rgba(47,107,255,0.14)',
          }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={publishToLibrary}
                onChange={(e) => setPublishToLibrary(e.target.checked)}
                size="small"
              />
            }
            label="生成后发布到内容库（公开后他人可下载，你可得一半积分）"
            sx={{ alignItems: 'flex-start', m: 0, '& .MuiFormControlLabel-label': { fontSize: 14, lineHeight: 1.5 } }}
          />
        </Box>

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
              ? creationMode === 'outline'
                ? `按大纲生成 PPT（${cost} 积分）`
                : `生成${getDocTypeLabel(docTypes[0])}（${cost} 积分）`
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
            生成后可一键导出 PPTX / Word / 网页（导出免费，无需再消耗积分）。
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

export default GeneratePage;
