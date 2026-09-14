import { useRef } from 'react';
import { Box, Button, Chip, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';

/**
 * 参考模板上传器（野马「一句话做课件」增强，选填）。
 *
 * 读取教师上传的 .txt/.md 文本模板，截断后通过 {@link TemplateFile.content}
 * 注入提示词；非文本/读取失败时仅保留文件名作为结构提示。无第三方依赖。
 */
export interface TemplateFile {
  /** 文件名。 */
  name: string;
  /** 已读取的文本内容（截断到上限）。 */
  content: string;
}

export interface TemplateUploaderProps {
  /** 当前选中的模板文件。 */
  value: TemplateFile | null;
  /** 变化回调。 */
  onChange: (v: TemplateFile | null) => void;
}

/** 注入提示词前对模板正文的最大字符数。 */
const MAX_TEMPLATE_CHARS = 16000;

export function TemplateUploader({ value, onChange }: TemplateUploaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = (file: File | undefined): void => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      // NUL 字节是判断二进制文件的最强信号；空文本也视为非文本。
      const looksBinary = text.length === 0 || text.includes('\u0000');
      if (looksBinary) {
        onChange({ name: file.name, content: '' });
      } else {
        onChange({ name: file.name, content: text.slice(0, MAX_TEMPLATE_CHARS) });
      }
    };
    reader.onerror = () => {
      // 读取失败：仅保留文件名作为结构提示。
      onChange({ name: file.name, content: '' });
    };
    reader.readAsText(file);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<UploadFileIcon />}
          onClick={() => inputRef.current?.click()}
        >
          上传参考模板
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {value ? (
          <Chip
            label={`${value.name} · 已读取 ${value.content.length} 字`}
            onDelete={() => onChange(null)}
            deleteIcon={<CloseIcon />}
            color="primary"
            variant="outlined"
          />
        ) : null}
      </Box>
      {value && value.content.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          （非文本文件，将仅参考其文件名与结构提示）
        </Typography>
      ) : null}
    </Box>
  );
}

export default TemplateUploader;
