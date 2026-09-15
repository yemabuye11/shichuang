import { useMemo, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { TextbookCascadeOptions, TextbookVersion } from '@/types/doc';
import type { CreateTextbookVersionInput } from '@/services/textbookService';

/**
 * 教材版本级联选择器（UI-2，category='doc' 时显示）。
 *
 * T07 接逻辑：版本列表与级联筛选项由上层通过 `useTextbook` 注入（mock / 真实统一）；
 * 支持「年级 → 学科 → 出版社 → 版本」逐级收窄，选中具体版本后经
 * `onSelectVersion(id)` 上报 `textbookVersionId`（最终由 `generateService` 传入生成请求）。
 *
 * ⚠️ 搜索密钥只在 Edge Secrets，本组件**绝不**接触任何检索 API Key。
 */
export interface TextbookCascadeProps {
  /** 级联筛选项（各维度去重集合），由 `useTextbook` 提供。 */
  options: TextbookCascadeOptions;
  /** 可选教材版本（由 `useTextbook` 提供）。 */
  versions: readonly TextbookVersion[];
  /** 当前选中的版本 id（null = 未绑定）。 */
  selectedVersionId: string | null;
  /** 选中版本回调。 */
  onSelectVersion: (id: string | null) => void;
  /** 章节 / 知识点（选填自由文本）。 */
  chapter: string;
  /** 章节文本变化回调。 */
  onChapterChange: (text: string) => void;
  /** 新建教材版本并可上传电子教材。 */
  onCreateVersion?: (input: CreateTextbookVersionInput) => Promise<TextbookVersion>;
  loading?: boolean;
}

/** 级联下拉的「全部」占位值（与真实维度值不冲突）。 */
const ALL = '__all__';

/**
 * 空库时的常用教材快捷入口。
 *
 * 这些不是“虚构教材知识”，点击后只会为当前教师创建一条待核对的版本记录，
 * 让生成页先能完成绑定；教材正文仍需教师上传或补写后才进入检索上下文。
 */
const COMMON_PRESETS: readonly CreateTextbookVersionInput[] = [
  { year: '2024', grade: '初三', subject: '数学', publisher: '人民教育出版社', version: '人教版 2024版', chapter: '' },
  { year: '2024', grade: '初三', subject: '语文', publisher: '人民教育出版社', version: '人教版 2024版', chapter: '' },
  { year: '2024', grade: '六年级', subject: '语文', publisher: '人民教育出版社', version: '部编版 2024版', chapter: '' },
  { year: '2024', grade: '六年级', subject: '数学', publisher: '人民教育出版社', version: '人教版 2024版', chapter: '' },
];

export function TextbookCascade({
  options,
  versions,
  selectedVersionId,
  onSelectVersion,
  chapter,
  onChapterChange,
  onCreateVersion,
  loading = false,
}: TextbookCascadeProps): JSX.Element {
  const [grade, setGrade] = useState<string>(ALL);
  const [subject, setSubject] = useState<string>(ALL);
  const [publisher, setPublisher] = useState<string>(ALL);
  const [versionDim, setVersionDim] = useState<string>(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateTextbookVersionInput>({ year: String(new Date().getFullYear()), version: '', publisher: '', subject: '', grade: '', chapter: '', file: null });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [quickCreating, setQuickCreating] = useState<string | null>(null);
  const [quickError, setQuickError] = useState('');

  /** 按已选维度逐级过滤版本列表（层级间互相约束即为「级联」）。 */
  const filtered = useMemo(
    () =>
      versions.filter(
        (v) =>
          (grade === ALL || v.grade === grade) &&
          (subject === ALL || v.subject === subject) &&
          (publisher === ALL || v.publisher === publisher) &&
          (versionDim === ALL || v.version === versionDim),
      ),
    [versions, grade, subject, publisher, versionDim],
  );

  /**
   * 上层维度变化后，清空其下方所有更细维度的选择，保证级联语义自洽。
   *
   * @param level 发生变化的层级（0=年级 1=学科 2=出版社）。
   */
  const resetLower = (level: number): void => {
    if (level <= 0) setSubject(ALL);
    if (level <= 1) setPublisher(ALL);
    if (level <= 2) setVersionDim(ALL);
  };

  const selectSx = { minWidth: 116, bgcolor: '#fff' } as const;

  const openCreate = (): void => {
    setFormError('');
    setQuickError('');
    setDialogOpen(true);
  };

  const createPreset = async (preset: CreateTextbookVersionInput): Promise<void> => {
    if (!onCreateVersion || quickCreating) return;
    const key = `${preset.grade}-${preset.subject}-${preset.version}`;
    setQuickCreating(key);
    setQuickError('');
    try {
      const created = await onCreateVersion(preset);
      onSelectVersion(created.id);
      setGrade(created.grade);
      setSubject(created.subject);
      setPublisher(created.publisher);
      setVersionDim(created.version);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : '教材版本创建失败，请改用手动新建');
    } finally {
      setQuickCreating(null);
    }
  };

  const submitCreate = async (): Promise<void> => {
    if (!onCreateVersion) return;
    setFormError('');
    setSaving(true);
    try {
      const created = await onCreateVersion(form);
      onSelectVersion(created.id);
      setGrade(created.grade);
      setSubject(created.subject);
      setPublisher(created.publisher);
      setVersionDim(created.version);
      if (created.chapter) onChapterChange(created.chapter);
      setDialogOpen(false);
      setForm({ year: String(new Date().getFullYear()), version: '', publisher: '', subject: '', grade: '', chapter: '', file: null });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '教材版本创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        borderRadius: 2.5,
        border: '1px dashed',
        borderColor: 'divider',
        bgcolor: 'rgba(27,31,39,0.02)',
        p: 1.75,
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
        <MenuBookIcon sx={{ fontSize: 18, color: 'text.secondary' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>绑定教材（选填）</Typography>
      </Stack>

      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 1, lineHeight: 1.6 }}>
        按 年级 → 学科 → 出版社 → 版本 逐级收窄，选中具体教材后生成时会检索并标注「待核对」。
      </Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <TextField
          select
          size="small"
          label="年级"
          value={grade}
          onChange={(e) => {
            setGrade(e.target.value);
            resetLower(0);
          }}
          sx={selectSx}
        >
          <MenuItem value={ALL}>全部</MenuItem>
          {options.grades.map((g) => (
            <MenuItem key={g} value={g}>
              {g}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="学科"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            resetLower(1);
          }}
          sx={selectSx}
        >
          <MenuItem value={ALL}>全部</MenuItem>
          {options.subjects.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="出版社"
          value={publisher}
          onChange={(e) => {
            setPublisher(e.target.value);
            resetLower(2);
          }}
          sx={selectSx}
        >
          <MenuItem value={ALL}>全部</MenuItem>
          {options.publishers.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="版本"
          value={versionDim}
          onChange={(e) => {
            setVersionDim(e.target.value);
          }}
          sx={selectSx}
        >
          <MenuItem value={ALL}>全部</MenuItem>
          {options.versions.map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {versions.length === 0 ? (
        <Stack spacing={1} sx={{ mt: 1.25 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
            还没有教材版本。可以先选一个常用版本完成绑定，随后再上传电子教材或补写章节；未核对内容不会直接当作教材事实使用。
          </Typography>
          {onCreateVersion ? (
            <>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {COMMON_PRESETS.map((preset) => {
                  const key = `${preset.grade}-${preset.subject}-${preset.version}`;
                  return (
                    <Button
                      key={key}
                      size="small"
                      variant="outlined"
                      startIcon={<MenuBookIcon />}
                      onClick={() => void createPreset(preset)}
                      disabled={loading || quickCreating !== null}
                      sx={{ textTransform: 'none' }}
                    >
                      {quickCreating === key ? '绑定中…' : `${preset.grade}·${preset.subject}·${preset.version}`}
                    </Button>
                  );
                })}
              </Stack>
              <Button size="small" variant="text" startIcon={<AddIcon />} onClick={openCreate} disabled={loading || quickCreating !== null} sx={{ alignSelf: 'flex-start' }}>
                手动新建或上传电子教材
              </Button>
              {quickError ? <Typography sx={{ fontSize: 13, color: 'error.main' }}>{quickError}</Typography> : null}
            </>
          ) : null}
        </Stack>
      ) : filtered.length === 0 ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1.25 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6, flex: 1 }}>
            当前筛选条件下没有匹配的教材版本，可以放宽筛选，或新建这套教材。
          </Typography>
          {onCreateVersion ? <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openCreate}>新建教材版本</Button> : null}
        </Stack>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.25 }}>
          {filtered.map((v) => {
            const selected = v.id === selectedVersionId;
            return (
              <Chip
                key={v.id}
                label={`${v.grade}·${v.subject}·${v.version}${v.chapter ? `（${v.chapter}）` : ''}`}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => onSelectVersion(selected ? null : v.id)}
                aria-pressed={selected}
              />
            );
          })}
        </Box>
      )}

      <TextField
        value={chapter}
        onChange={(e) => onChapterChange(e.target.value)}
        placeholder="如：第三章 第一节 勾股定理（选填，让生成更贴合你的进度）"
        size="small"
        fullWidth
        multiline
        minRows={1}
        sx={{ mt: 1.25, bgcolor: '#fff' }}
      />

      {onCreateVersion ? (
        <Button variant="text" size="small" startIcon={<UploadFileIcon />} onClick={openCreate} sx={{ mt: 0.5, alignSelf: 'flex-start' }}>
          新建教材版本 / 上传电子教材
        </Button>
      ) : null}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建教材版本</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.5, lineHeight: 1.6 }}>
            电子教材会按当前账号保存；文本文件会进入“待核对”知识，确认后才会用于后续生成。
          </Typography>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField label="年份" value={form.year} onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))} />
              <TextField label="年级" required value={form.grade} onChange={(e) => setForm((p) => ({ ...p, grade: e.target.value }))} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField label="学科" required value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} />
              <TextField label="出版社" required value={form.publisher} onChange={(e) => setForm((p) => ({ ...p, publisher: e.target.value }))} />
            </Stack>
            <TextField label="版本" required placeholder="如：2024版 / 新课标版" value={form.version} onChange={(e) => setForm((p) => ({ ...p, version: e.target.value }))} />
            <TextField label="默认章节（选填）" value={form.chapter ?? ''} onChange={(e) => setForm((p) => ({ ...p, chapter: e.target.value }))} />
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ justifyContent: 'flex-start', minHeight: 48 }}>
              {form.file ? form.file.name : '上传电子教材（TXT / MD / PDF / Word / PPT，20MB 内）'}
              <input hidden type="file" accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.ppt,.pptx" onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] ?? null }))} />
            </Button>
            {formError ? <Typography sx={{ color: 'error.main', fontSize: 13 }}>{formError}</Typography> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>取消</Button>
          <Button variant="contained" onClick={() => void submitCreate()} disabled={saving}>{saving ? '保存中…' : '保存并绑定'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default TextbookCascade;
