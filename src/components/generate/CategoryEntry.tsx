import { Box, Stack, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ExtensionIcon from '@mui/icons-material/Extension';
import type { Category } from '@/types/doc';

/**
 * 产物大类切换器（UI-2 顶部）。
 *
 * 两个主路径：
 * - `doc`：写教案 / 课件 / 办公文档（平台渲染壳，结构化 DocModel 一份源三交付）；
 * - `app`：做互动小应用（单文件 HTML 沙箱）。
 */
export interface CategoryEntryProps {
  /** 当前选中的大类。 */
  value: Category;
  /** 切换回调。 */
  onChange: (c: Category) => void;
}

interface Option {
  key: Category;
  icon: JSX.Element;
  title: string;
  desc: string;
}

const OPTIONS: readonly Option[] = [
  {
    key: 'doc',
    icon: <MenuBookIcon sx={{ fontSize: 22 }} />,
    title: '写教案 / 课件 / 文档',
    desc: '教案、PPT、3D 课件、办公文档，生成即可打印或分享',
  },
  {
    key: 'app',
    icon: <ExtensionIcon sx={{ fontSize: 22 }} />,
    title: '做互动小应用',
    desc: '课堂游戏、动画、练习器，一个链接发给学生',
  },
];

export function CategoryEntry({ value, onChange }: CategoryEntryProps): JSX.Element {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(2, minmax(0, 1fr))' },
        gap: 1.25,
      }}
    >
      {OPTIONS.map((opt) => {
        const selected = opt.key === value;
        return (
          <Box
            key={opt.key}
            component="button"
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.key)}
            sx={{
              textAlign: 'left',
              p: { xs: 1.5, sm: 2 },
              borderRadius: 3,
              border: '1.5px solid',
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'rgba(47,107,255,0.06)' : '#fff',
              cursor: 'pointer',
              display: 'flex',
              gap: 1.25,
              alignItems: 'flex-start',
              transition: 'border-color .15s, background .15s',
            }}
          >
            <Box
              sx={{
                color: selected ? 'primary.main' : 'text.secondary',
                mt: 0.25,
              }}
              aria-hidden="true"
            >
              {opt.icon}
            </Box>
            <Stack spacing={0.25}>
              <Typography sx={{ fontSize: { xs: 14.5, sm: 16 }, fontWeight: 800, color: 'text.primary' }}>
                {opt.title}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.5 }}>
                {opt.desc}
              </Typography>
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

export default CategoryEntry;
