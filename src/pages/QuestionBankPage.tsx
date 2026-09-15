/**
 * 题库页（/exam/bank）。
 *
 * 能力：
 * - 按 学科 / 年级 / 单元 / 题型 / 知识点 检索题库（自己的题 + 公开题，见 0041 RLS）；
 * - 勾选若干题 → 「用选中的 N 题组成试卷」→ 跳到创建页预览（按题型自动分大题）；
 * - 手动录入一道题（add_question_to_bank）；删除自己录入的题（delete_question_from_bank）；
 * - 组卷产出会**自动沉淀**进题库（Edge 侧完成），老师下次可直接复用。
 *
 * 红线：不引入任何新依赖；页面禁止直接 import supabaseClient（一律走 service 层）。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';

import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/ToastHost';
import {
  addQuestionToBank,
  deleteQuestionFromBank,
  incrementBankUsage,
  listKnowledgePoints,
  listQuestionBank,
} from '@/services/examPaperService';
import { ROUTES } from '@/config/routes';
import type { ExamQType, ExamSection, KnowledgePoint, QuestionBankItem } from '@/types/examPaper';

/** 题型选项。 */
const QTYPES: { key: ExamQType; label: string }[] = [
  { key: 'choice', label: '选择题' },
  { key: 'fill', label: '填空题' },
  { key: 'judge', label: '判断题' },
  { key: 'subjective', label: '主观题' },
];

/** 中文序号。 */
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 题型 → 中文标签。 */
function qtypeLabel(qtype: ExamQType): string {
  switch (qtype) {
    case 'choice':
      return '选择题';
    case 'fill':
      return '填空题';
    case 'judge':
      return '判断题';
    case 'subjective':
      return '主观题';
    default:
      return '题目';
  }
}

/** 默认大题标题。 */
function defaultSectionTitle(sectionNo: number, qtype: ExamQType, score: number): string {
  return `${CN_NUM[sectionNo - 1] ?? sectionNo}、${qtypeLabel(qtype)}（每题 ${score} 分）`;
}

/** 答案数组 → 展示文本。 */
function answerToText(item: QuestionBankItem): string {
  if (!Array.isArray(item.answer) || item.answer.length === 0) return '';
  return item.answer.join(item.qtype === 'subjective' ? ' / ' : '');
}

/** 把老师填的答案文本按题型转成 answer 数组（与创建页同一套口径）。 */
function buildAnswer(qtype: ExamQType, text: string): string[] {
  const s = (text ?? '').trim();
  if (!s) return [];
  if (qtype === 'choice') {
    const m = s.match(/[A-Za-z]/);
    return m ? [m[0].toUpperCase()] : [];
  }
  if (qtype === 'judge') {
    if (s === '对' || s.toLowerCase() === 'true' || s === '√') return ['对'];
    if (s === '错' || s.toLowerCase() === 'false' || s === '×') return ['错'];
    return [s];
  }
  if (qtype === 'subjective') {
    return s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  return [s];
}

/**
 * 题库页。
 *
 * 导出方式：named export `QuestionBankPage` + default 兜底（与其它页面一致）。
 */
export function QuestionBankPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();

  // 筛选条件
  const [subject, setSubject] = useState<string>('');
  const [grade, setGrade] = useState<string>('');
  const [unit, setUnit] = useState<string>('');
  const [qtype, setQtype] = useState<ExamQType | ''>('');
  const [kpId, setKpId] = useState<string>('');
  const [publicOnly, setPublicOnly] = useState<boolean>(false);

  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 录入弹层
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [addSaving, setAddSaving] = useState<boolean>(false);
  const [draft, setDraft] = useState<{
    qtype: ExamQType;
    stem: string;
    options: string[];
    answer: string;
    explanation: string;
    difficulty: string;
    score: number;
    knowledgePoint: string;
    isPublic: boolean;
  }>({
    qtype: 'choice',
    stem: '',
    options: ['', '', '', ''],
    answer: '',
    explanation: '',
    difficulty: '',
    score: 2,
    knowledgePoint: '',
    isPublic: false,
  });

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<QuestionBankItem | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  /** 检索题库（挂载即拉一次）。 */
  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [list, kps] = await Promise.all([
        listQuestionBank({
          subject,
          grade,
          unit,
          qtype: qtype || undefined,
          knowledgePointId: kpId || undefined,
          publicOnly,
        }),
        listKnowledgePoints(),
      ]);
      setItems(list);
      setPoints(kps);
      setSelectedIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取题库失败，请重试');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 挂载时拉一次；后续由「搜索」按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 勾选 / 取消勾选。 */
  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** 用选中题目组成试卷：按题型分大题，跳到创建页预览。 */
  const handleCompose = (): void => {
    const picked = items.filter((it) => selectedIds.includes(it.id));
    if (picked.length === 0) {
      toast.error('请先勾选要用的题目');
      return;
    }
    const byType = new Map<ExamQType, QuestionBankItem[]>();
    for (const it of picked) {
      const list = byType.get(it.qtype) ?? [];
      list.push(it);
      byType.set(it.qtype, list);
    }
    const sections: ExamSection[] = [];
    let idx = 0;
    for (const [type, list] of byType) {
      idx += 1;
      const score = list[0]?.score ?? 1;
      const title = defaultSectionTitle(idx, type, score);
      sections.push({
        sectionNo: idx,
        sectionTitle: title,
        qtype: type,
        score,
        questions: list.map((it, i) => ({
          sectionNo: idx,
          sectionTitle: title,
          seq: i + 1,
          qtype: type,
          stem: it.stem,
          options: it.options,
          answer: it.answer,
          explanation: it.explanation,
          score: it.score,
          knowledgePoint: it.knowledgePoint,
        })),
      });
    }
    void incrementBankUsage(selectedIds);
    navigate(ROUTES.EXAM_NEW, { state: { bankSections: sections } });
  };

  /** 确认删除题目。 */
  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteQuestionFromBank(deleteTarget.id);
      toast.success('已删除该题目');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  };

  /** 保存手工录入的题目。 */
  const handleAdd = async (): Promise<void> => {
    if (!draft.stem.trim()) {
      toast.error('请填写题干');
      return;
    }
    const answer = buildAnswer(draft.qtype, draft.answer);
    if (answer.length === 0) {
      toast.error('请填写答案');
      return;
    }
    if (draft.qtype === 'choice') {
      const opts = draft.options.filter((o) => o.trim().length > 0);
      if (opts.length < 2) {
        toast.error('选择题至少要有 2 个选项');
        return;
      }
      if (!/^[A-Za-z]$/.test(answer[0] ?? '')) {
        toast.error('选择题答案必须是选项字母（A/B/C…）');
        return;
      }
    }
    setAddSaving(true);
    try {
      await addQuestionToBank({
        subject,
        grade,
        unit,
        knowledgePointId: kpId || null,
        knowledgePoint: draft.knowledgePoint || undefined,
        qtype: draft.qtype,
        stem: draft.stem.trim(),
        options: draft.qtype === 'choice' ? draft.options.filter((o) => o.trim().length > 0) : undefined,
        answer,
        explanation: draft.explanation || undefined,
        difficulty: draft.difficulty || undefined,
        score: draft.score,
        isPublic: draft.isPublic,
      });
      toast.success('已录入题库');
      setAddOpen(false);
      setDraft({
        qtype: 'choice',
        stem: '',
        options: ['', '', '', ''],
        answer: '',
        explanation: '',
        difficulty: '',
        score: 2,
        knowledgePoint: '',
        isPublic: false,
      });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '录入失败，请重试');
    } finally {
      setAddSaving(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 800 }}>题库</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
            我的题目 · 公开题目 · 挑题组卷
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
          sx={{ minHeight: 40 }}
        >
          录入题目
        </Button>
      </Stack>

      {/* ---- 筛选栏 ---- */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap">
          <TextField
            label="学科"
            size="small"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
          />
          <TextField
            label="年级"
            size="small"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
          />
          <TextField
            label="单元"
            size="small"
            placeholder="如：第一单元"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
          />
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="bank-qtype-label">题型</InputLabel>
            <Select
              labelId="bank-qtype-label"
              label="题型"
              value={qtype}
              onChange={(e) => setQtype(e.target.value as ExamQType | '')}
            >
              <MenuItem value="">全部</MenuItem>
              {QTYPES.map((t) => (
                <MenuItem key={t.key} value={t.key}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="bank-kp-label">知识点</InputLabel>
            <Select
              labelId="bank-kp-label"
              label="知识点"
              value={kpId}
              onChange={(e) => setKpId(String(e.target.value))}
            >
              <MenuItem value="">全部</MenuItem>
              {points.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                  {p.unit ? `（${p.unit}）` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControlLabel
              control={
                <Checkbox
                  checked={publicOnly}
                  onChange={(e) => setPublicOnly(e.target.checked)}
                />
              }
              label="只看公开"
            />
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? <CircularProgress size={20} color="inherit" /> : '搜索'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* ---- 列表 ---- */}
      {loading ? (
        <InlineLoading message="正在加载题库…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="题库还没有题"
          description="组卷产出的题目会自动沉淀进题库；也可以点右上角「录入题目」手动添加。"
        />
      ) : (
        <Stack spacing={1.5}>
          {items.map((it) => (
            <Paper key={it.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Checkbox
                  checked={selectedIds.includes(it.id)}
                  onChange={() => toggleSelect(it.id)}
                  sx={{ mt: -1 }}
                  inputProps={{ 'aria-label': '选择该题目' }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                    <Chip size="small" label={qtypeLabel(it.qtype)} color="primary" variant="outlined" />
                    {it.knowledgePoint ? <Chip size="small" label={it.knowledgePoint} /> : null}
                    {it.difficulty ? (
                      <Chip size="small" variant="outlined" label={it.difficulty} />
                    ) : null}
                    {it.isPublic ? <Chip size="small" label="公开" color="success" /> : null}
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                      {it.subject} {it.grade} {it.unit} · {it.score} 分 · 用过 {it.usageCount} 次
                    </Typography>
                  </Stack>

                  <Typography sx={{ fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {it.stem}
                  </Typography>

                  {it.options && it.options.length > 0 && (
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.5 }}>
                      {it.options.join('  ')}
                    </Typography>
                  )}

                  <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.5 }}>
                    答案：{answerToText(it) || '（未填）'}
                  </Typography>

                  {it.explanation ? (
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>
                      解析：{it.explanation}
                    </Typography>
                  ) : null}
                </Box>
                <IconButton
                  aria-label="删除该题目"
                  color="error"
                  onClick={() => setDeleteTarget(it)}
                  sx={{ flexShrink: 0 }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* ---- 底部组卷条 ---- */}
      {items.length > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'sticky',
            bottom: { xs: 70, sm: 16 },
            mt: 2,
            p: 1.5,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Stack direction="row" spacing={1} alignItems="center">
              <LibraryBooksIcon sx={{ color: 'text.secondary' }} />
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                已选 {selectedIds.length} 题
              </Typography>
            </Stack>
            <Button
              variant="contained"
              disabled={selectedIds.length === 0}
              onClick={handleCompose}
              sx={{ minHeight: 44 }}
            >
              组成试卷
            </Button>
          </Stack>
        </Paper>
      )}

      {/* ---- 录入题目弹层 ---- */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700 }}>录入一道题</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.75}>
            <FormControl size="small" fullWidth>
              <InputLabel id="add-qtype-label">题型</InputLabel>
              <Select
                labelId="add-qtype-label"
                label="题型"
                value={draft.qtype}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    qtype: e.target.value as ExamQType,
                    options: e.target.value === 'choice' ? ['', '', '', ''] : [],
                  })
                }
              >
                {QTYPES.map((t) => (
                  <MenuItem key={t.key} value={t.key}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="题干"
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={draft.stem}
              onChange={(e) => setDraft({ ...draft, stem: e.target.value })}
            />

            {draft.qtype === 'choice' && (
              <Stack spacing={1}>
                {draft.options.map((opt, oi) => (
                  <TextField
                    key={oi}
                    label={`选项 ${String.fromCharCode(65 + oi)}`}
                    size="small"
                    fullWidth
                    value={opt}
                    onChange={(e) => {
                      const opts = [...draft.options];
                      opts[oi] = e.target.value;
                      setDraft({ ...draft, options: opts });
                    }}
                  />
                ))}
              </Stack>
            )}

            <TextField
              label="答案"
              size="small"
              fullWidth
              multiline={draft.qtype === 'subjective'}
              minRows={draft.qtype === 'subjective' ? 2 : 1}
              placeholder={
                draft.qtype === 'choice'
                  ? '正确选项字母，如 A'
                  : draft.qtype === 'fill'
                    ? '多个空用竖线 | 分隔'
                    : draft.qtype === 'judge'
                      ? '对 或 错'
                      : '得分要点，多条请换行'
              }
              value={draft.answer}
              onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
            />

            <TextField
              label={draft.qtype === 'subjective' ? '参考答案 / 评分要点' : '解析'}
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={draft.explanation}
              onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="分值"
                size="small"
                type="number"
                value={draft.score}
                onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) || 0 })}
                sx={{ width: { xs: '100%', sm: 110 } }}
              />
              <TextField
                label="难度（选填）"
                size="small"
                placeholder="如 基础 / 提高"
                value={draft.difficulty}
                onChange={(e) => setDraft({ ...draft, difficulty: e.target.value })}
                sx={{ width: { xs: '100%', sm: 150 } }}
              />
              <TextField
                label="知识点（选填）"
                size="small"
                fullWidth
                value={draft.knowledgePoint}
                onChange={(e) => setDraft({ ...draft, knowledgePoint: e.target.value })}
              />
            </Stack>

            <Divider />

            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.isPublic}
                  onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })}
                />
              }
              label="公开给全校老师使用（仅管理员可生效）"
            />
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              归属：当前登录老师；学科 / 年级 / 单元取上方筛选条件（{subject || '未填'} {grade || '未填'}{' '}
              {unit || '未填'}）。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} size="large" sx={{ minHeight: 44 }}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleAdd()}
            disabled={addSaving}
            size="large"
            sx={{ minHeight: 44 }}
          >
            {addSaving ? <CircularProgress size={20} color="inherit" /> : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- 删除确认 ---- */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除这道题？"
        description="将从题库中永久删除这道题（不影响已经出好的试卷）。"
        confirmText="确认删除"
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </Container>
  );
}

export default QuestionBankPage;
