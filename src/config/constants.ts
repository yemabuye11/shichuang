import type { AppType } from '@/types/enums';
import type { DocType } from '@/types/doc';

// ---------------------------------------------------------------------------
// 8 类应用类型 + 自动判断（唯一真相源，ARCHITECTURE.md §8.1）
// ---------------------------------------------------------------------------

export interface AppTypeMeta {
  /** 枚举值，与 Postgres `app_type_enum` 一致。 */
  readonly key: AppType | DocType;
  /** 中文显示名。 */
  readonly label: string;
  /** 一句话说明，用于类型选择器的辅助文案。 */
  readonly hint: string;
  /** 单次生成消耗积分数。 */
  readonly creditCost: number;
  /** 子提示词模板 key（`prompt_templates.key`）。 */
  readonly promptKey: string;
  /** 排序权重（越小越靠前）。 */
  readonly sortOrder: number;
}

/**
 * 9 个应用类型（8 类 + 自动判断）的完整元数据。
 *
 * ⚠️ `creditCost` 只是**网络异常 / mock 模式下的兜底展示值**，必须与迁移
 * 0029（`app_type_profiles.credit_cost`）保持一致：
 * 自动判断 2 / 教学动画 6 / 教育应用 4 / 教学游戏 6 / 互动课件 4 /
 * 数据回收 4 / AI命题 2 / AI组题 2 / AI教案·大单元 2。
 * 真实计费与正常展示一律以服务端配置表（`estimate_cost` RPC）为准。
 */
export const APP_TYPES: readonly AppTypeMeta[] = [
  {
    key: 'auto',
    label: '自动判断',
    hint: '交给 AI 判断最适合的形式',
    creditCost: 2,
    promptKey: '',
    sortOrder: 0,
  },
  {
    key: 'teaching_animation',
    label: '教学动画',
    hint: '动画演示知识点，可播放/暂停/重播',
    creditCost: 6,
    promptKey: 'app_type:teaching_animation',
    sortOrder: 1,
  },
  {
    key: 'edu_tool',
    label: '教育应用',
    hint: '口算练习、单词卡、随机点名等小工具',
    creditCost: 4,
    promptKey: 'app_type:edu_tool',
    sortOrder: 2,
  },
  {
    key: 'teaching_game',
    label: '教学游戏',
    hint: '闯关、积分、排行榜，5 关以上',
    creditCost: 6,
    promptKey: 'app_type:teaching_game',
    sortOrder: 3,
  },
  {
    key: 'interactive_courseware',
    label: '互动课件',
    hint: '分段讲解 + 每节小检测 + 目录跳转',
    creditCost: 4,
    promptKey: 'app_type:interactive_courseware',
    sortOrder: 4,
  },
  {
    key: 'data_collection',
    label: '数据回收',
    hint: '表单/问卷，提交后本机展示结果',
    creditCost: 4,
    promptKey: 'app_type:data_collection',
    sortOrder: 5,
  },
  {
    key: 'ai_item_generation',
    label: 'AI命题',
    hint: '一套 10 题，含答案与解析，可打印',
    creditCost: 2,
    promptKey: 'app_type:ai_item_generation',
    sortOrder: 6,
  },
  {
    key: 'ai_paper_composition',
    label: 'AI组题',
    hint: '按知识点/难度/题型组卷，A4 打印友好',
    creditCost: 2,
    promptKey: 'app_type:ai_paper_composition',
    sortOrder: 7,
  },
  {
    key: 'ai_lesson_plan',
    label: 'AI教案·大单元',
    hint: '目标/重难点/过程/作业/板书，可打印',
    creditCost: 2,
    promptKey: 'app_type:ai_lesson_plan',
    sortOrder: 8,
  },
] as const;

// ---------------------------------------------------------------------------
// T06 文档类（教案 / PPT / 课件2D / 课件3D / 办公文档）
// ---------------------------------------------------------------------------

/**
 * 5 个文档类型的完整元数据。
 *
 * ⚠️ `creditCost` 只是**网络异常 / mock 模式下的兜底展示值**，必须与迁移
 * 0029（`app_type_profiles.credit_cost`）保持一致：
 * 教案 4 / PPT 6 / 课件2D 6 / 课件3D 8 / 办公文档 4。
 * 真实计费与正常展示一律以服务端配置表（`estimate_cost` RPC）为准。
 */
export const DOC_TYPES: readonly AppTypeMeta[] = [
  {
    key: 'lesson_plan',
    label: '教案',
    hint: '教学目标/重难点/过程/作业，可打印',
    creditCost: 4,
    promptKey: 'doc_type:lesson_plan',
    sortOrder: 20,
  },
  {
    key: 'ppt',
    label: 'PPT 课件',
    hint: '分页幻灯片 + 演讲者备注，可直接放映',
    creditCost: 6,
    promptKey: 'doc_type:ppt',
    sortOrder: 21,
  },
  {
    key: 'courseware_2d',
    label: '课件（2D）',
    hint: '图文互动课件，边看边学',
    creditCost: 6,
    promptKey: 'doc_type:courseware_2d',
    sortOrder: 22,
  },
  {
    key: 'courseware_3d',
    label: '课件（3D）',
    hint: '可旋转/拆解的几何体与分子模型',
    creditCost: 8,
    promptKey: 'doc_type:courseware_3d',
    sortOrder: 23,
  },
  {
    key: 'office_doc',
    label: '办公文档',
    hint: '通知/计划/总结/发言稿等办公文案',
    creditCost: 4,
    promptKey: 'doc_type:office_doc',
    sortOrder: 24,
  },
] as const;

/** 全部类型（应用 + 文档）的联合 Map。 */
const TYPE_MAP: ReadonlyMap<string, AppTypeMeta> = new Map(
  [...APP_TYPES, ...DOC_TYPES].map((item) => [item.key as string, item]),
);

/**
 * 获取类型元数据（应用类或文档类通用）。
 *
 * @param type 类型枚举值。
 * @returns 对应的元数据；未知类型回落到「自动判断」。
 */
export function getAppTypeMeta(type: AppType | DocType | string | null | undefined): AppTypeMeta {
  if (!type) return APP_TYPES[0];
  return TYPE_MAP.get(type as string) ?? APP_TYPES[0];
}

/**
 * 获取类型的中文名（应用类或文档类通用）。
 *
 * @param type 类型枚举值。
 */
export function getAppTypeLabel(type: AppType | DocType | string | null | undefined): string {
  return getAppTypeMeta(type).label;
}

/**
 * 获取类型的积分成本（展示用兜底值；真实计费以服务端为准）。
 *
 * @param type 类型枚举值。
 */
export function getAppTypeCost(type: AppType | DocType | string | null | undefined): number {
  return getAppTypeMeta(type).creditCost;
}

/**
 * 获取文档类型的元数据。
 *
 * @param type 文档类型枚举值。
 */
export function getDocTypeMeta(type: DocType | string | null | undefined): AppTypeMeta {
  if (!type) return DOC_TYPES[0];
  return TYPE_MAP.get(type as string) ?? DOC_TYPES[0];
}

/**
 * 获取文档类型的中文名。
 *
 * @param type 文档类型枚举值。
 */
export function getDocTypeLabel(type: DocType | string | null | undefined): string {
  return getDocTypeMeta(type).label;
}

/**
 * 获取文档类型的积分成本（展示用兜底值）。
 *
 * @param type 文档类型枚举值。
 */
export function getDocTypeCost(type: DocType | string | null | undefined): number {
  return getDocTypeMeta(type).creditCost;
}

/** 判断给定字符串是否为合法的文档类型。 */
export function isDocTypeKey(value: unknown): value is DocType {
  return (
    value === 'lesson_plan' ||
    value === 'ppt' ||
    value === 'courseware_2d' ||
    value === 'courseware_3d' ||
    value === 'office_doc'
  );
}

/** 所有可选类型（不含「自动判断」），用于筛选器。 */
export const SELECTABLE_APP_TYPES: readonly AppTypeMeta[] = APP_TYPES.filter(
  (item) => item.key !== 'auto',
);

// ---------------------------------------------------------------------------
// 学科 / 年级 / 教材 / 时长 / 难度
// ---------------------------------------------------------------------------

/** 学科选项（含「不限」）。 */
export const SUBJECTS: readonly string[] = [
  '语文',
  '数学',
  '英语',
  '道德与法治',
  '科学',
  '物理',
  '化学',
  '生物',
  '历史',
  '地理',
  '音乐',
  '体育',
  '美术',
  '信息技术',
  '综合',
];

/** 年级选项：小学一年级 → 高三（含「不限」）。 */
export const GRADES: readonly string[] = [
  '一年级',
  '二年级',
  '三年级',
  '四年级',
  '五年级',
  '六年级',
  '初一',
  '初二',
  '初三',
  '高一',
  '高二',
  '高三',
];

/** 教材版本选项。 */
export const TEXTBOOKS: readonly string[] = [
  '人教版',
  '部编版',
  '北师大版',
  '苏教版',
  '沪教版',
  '外研版',
  '浙教版',
  '其他',
];

/** 课堂时长选项。 */
export const DURATIONS: readonly string[] = ['5分钟', '10分钟', '20分钟', '一节课', '不限'];

/** 难度选项。 */
export const DIFFICULTY: readonly string[] = ['简单', '中等', '较难', '挑战'];

// ---------------------------------------------------------------------------
// 首页示例 chips（6 个，点击直接填入提示词）
// ---------------------------------------------------------------------------

export interface ExampleChip {
  /** 按钮文案。 */
  readonly label: string;
  /** 点击后填入输入框的完整提示词。 */
  readonly prompt: string;
  /** 建议的应用类型（可为空 → 自动判断）。 */
  readonly appType: AppType;
}

/** 首页与生成页共用的示例提示词。 */
export const EXAMPLES: readonly ExampleChip[] = [
  {
    label: '古诗词闯关游戏',
    prompt:
      '以《西游记》取经之路为故事线，生成六年级课内古诗词闯关游戏，共 5 关，每关 4 题，答错可重做并有鼓励文案，最后有总结页。',
    appType: 'teaching_game',
  },
  {
    label: '勾股定理探究动画',
    prompt:
      '用动画演示勾股定理的推导过程，带旁白讲解与播放/暂停/重播/进度控制，配 3 道随堂小测。',
    appType: 'teaching_animation',
  },
  {
    label: '口算练习器',
    prompt:
      '生成小学三年级口算练习器，可选择题型（加减乘除）与题量，即时判分并显示错题解析，有进度条与得分。',
    appType: 'edu_tool',
  },
  {
    label: '英语单词卡',
    prompt:
      '生成初一英语单词记忆卡，支持翻转看释义、标记「已掌握」、随机打乱顺序，并统计本次正确率。',
    appType: 'edu_tool',
  },
  {
    label: '单元测验卷',
    prompt:
      '生成一份九年级语文下册第二单元测验卷，包含基础积累、阅读理解、写作三个板块，附答案与解析，A4 打印友好。',
    appType: 'ai_paper_composition',
  },
  {
    label: '随机点名器',
    prompt: '生成课堂随机点名器，可录入名单、支持单人/多人抽取与「不重复」模式，界面适合投屏。',
    appType: 'edu_tool',
  },
] as const;

// ---------------------------------------------------------------------------
// 其他常量
// ---------------------------------------------------------------------------

/** 提示词最大长度（前端输入框限制，服务端另行校验）。 */
export const MAX_PROMPT_LENGTH = 500;

/** 提示词最小长度（太短无法生成有意义的应用）。 */
export const MIN_PROMPT_LENGTH = 5;

/** 生成中「预计剩余时间」的粗略估算：每 1000 字符约 3 秒。 */
export const MS_PER_1K_CHARS = 3000;
