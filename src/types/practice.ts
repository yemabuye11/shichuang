/**
 * 每日一练（T10）前端数据类型。
 *
 * 仅描述前端需要的「去敏 / 展示」结构；答案（answer / explanation）只在教师预览与
 * 服务端判分时存在，学生端通过 get_practice_for_student RPC 拿到的题目不含答案。
 */

/** 题型：选择题 / 填空题 / 判断题（P0 只做客观题）。 */
export type PracticeQType = 'choice' | 'fill' | 'judge';

/** 题目（含答案，仅教师预览 / 本地解析使用）。 */
export interface PracticeQuestion {
  dayNo: number;
  seq: number;
  qtype: PracticeQType;
  stem: string;
  options?: string[];
  /** 标准答案数组 = 若干个空；填空多个空用 `|` 分隔存在**单个元素**里（见 0038 注释）。 */
  answer: string[];
  explanation?: string;
}

/** 练习集（教师「我的练习」列表项）。 */
export interface PracticeSet {
  id: string;
  title: string;
  subject: string;
  grade: string;
  chapter: string;
  dayCount: number;
  status: 'draft' | 'published' | 'closed';
  shareSlug: string;
  source: 'ai' | 'upload';
  questionCount: number;
  createdAt: string;
}

/** 每日一练配置（来自 system_config.practice，全部后台可配）。 */
export interface PracticeConfig {
  dayTiers: number[];
  discountByDays: Record<string, number>;
  minDiscount: number;
  importCostCredits: number;
  questionPerDayDefault: number;
}

/** 学生端题目（去敏，无答案）。 */
export interface StudentQuestion {
  dayNo: number;
  seq: number;
  qtype: PracticeQType;
  stem: string;
  options?: string[];
}

/** 学生端练习概要（去敏，无答案）。 */
export interface StudentPractice {
  title: string;
  grade: string;
  subject: string;
  chapter: string;
  dayCount: number;
  status: string;
}

/** 教师看板统计。 */
export interface PracticeStats {
  submissions: Array<{ studentName: string; dayNo: number; score: number; total: number; submittedAt: string }>;
  perQuestion: Array<{ dayNo: number; seq: number; stem: string; correctRate: number }>;
}
