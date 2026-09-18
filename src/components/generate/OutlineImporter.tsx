import { useRef, useState } from 'react';
import { Box, Button, Chip, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
  importOutlineFile,
  MAX_OUTLINE_CHARS,
  normalizeOutlineText,
  type OutlineSourceKind,
} from '@/utils/outlineImport';

export interface OutlineDraft {
  content: string;
  name?: string;
  sourceKind?: OutlineSourceKind;
  pageCount?: number;
  truncated?: boolean;
}

export interface OutlineImporterProps {
  value: OutlineDraft | null;
  onChange: (value: OutlineDraft | null) => void;
  disabled?: boolean;
}

export function OutlineImporter({ value, onChange, disabled = false }: OutlineImporterProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const parsed = await importOutlineFile(file);
      onChange({
        content: parsed.content,
        name: parsed.name,
        sourceKind: parsed.sourceKind,
        pageCount: parsed.pageCount,
        truncated: parsed.truncated,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件读取失败');
    } finally {
      setLoading(false);
    }
  };

  const content = value?.content ?? '';

  return (
    <Stack spacing={1}>
      <TextField
        value={content}
        onChange={(event) => {
          const next = normalizeOutlineText(event.target.value).slice(0, MAX_OUTLINE_CHARS);
          setError('');
          onChange(next ? { ...value, content: next } : null);
        }}
        multiline
        minRows={7}
        maxRows={16}
        disabled={disabled || loading}
        placeholder={'按页或按章节粘贴大纲\n例如：\n第 1 页 我是什么\n- 猜谜导入\n- 读准字音'}
        inputProps={{ 'aria-label': '导入大纲内容', maxLength: MAX_OUTLINE_CHARS }}
        sx={{
          '& .MuiOutlinedInput-root': {
            alignItems: 'flex-start',
            borderRadius: 3,
            bgcolor: '#fff',
            fontSize: 16,
            lineHeight: 1.7,
          },
          '& textarea': { fontSize: 16, lineHeight: 1.7 },
        }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={loading ? <CircularProgress size={16} /> : <UploadFileIcon />}
            onClick={() => inputRef.current?.click()}
            disabled={disabled || loading}
          >
            导入文件
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pptx,.docx,.txt,.md,.markdown,text/plain,text/markdown"
            style={{ display: 'none' }}
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {value?.name ? (
            <Chip
              label={`${value.name}${value.pageCount ? ` · ${value.pageCount} 页` : ''}`}
              onDelete={() => onChange(null)}
              deleteIcon={<CloseIcon />}
              color="primary"
              variant="outlined"
              disabled={disabled || loading}
            />
          ) : null}
        </Box>
        <Typography sx={{ fontSize: 12.5, color: error ? 'error.main' : 'text.secondary' }}>
          {error || `${content.length} / ${MAX_OUTLINE_CHARS}`}
        </Typography>
      </Box>
      {value?.truncated ? (
        <Typography sx={{ fontSize: 12.5, color: 'warning.main' }}>
          内容较长，已保留前 {MAX_OUTLINE_CHARS} 字用于生成
        </Typography>
      ) : null}
    </Stack>
  );
}

export default OutlineImporter;
