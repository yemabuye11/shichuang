/**
 * 组卷（T11）前端数据类型。
 *
 * 与每日一练（T10）的关键差异：
 * - 组卷有「大题（section）」分组与「分值（score）」，含主观题（subjective）；
 * - 学生端通过 `get_exam_paper_for_student` 拿到的题目**不含 answer / explanation**；
 * - 客观题服务端判分，主观题留待教师后台手改（set_exam_subjective_score）。
 *
 * 仅描述前端需要的结构；服务端敏感字段（答案）只在教师预览与服务端判分时出现。
 */

/** 题型：选择 / 填空 / 判断 / 主观（简答/作文/应用/计算）。 */
export type ExamQType = 'choice' | 'fill' | 'judge' | 'subjective';

/** 卷状态：草稿 / 已发布（学生可作答）/ 已关闭。 */
export type ExamPaperStatus = 'draft' | 'published' | 'closed';

/** 卷来源：AI 生成 / 老师上传。 */
export type ExamPaperSource = 'ai' | 'upload' | 'bank';

/** 题目（教师视图，含答案）。 */
export interface ExamQuestion {
  /** 题目 id；仅在已保存的卷 / 题库中存在，草稿期为 undefined。 */
  id?: string;
  /** 大题序号（1,2,3…）。 */
  sectionNo: number;
  /** 大题标题（如「一、选择题」）。 */
  sectionTitle: string;
  /** 大题内题序（1,2,3…）。 */
  seq: number;
  qtype: ExamQType;
  stem: string;
  /** 选择题选项；其它题型为 undefined。 */
  options?: string[];
  /**
   * 标准答案数组。
   * - choice：正确选项字母（如 ['A']）；
   * - fill：多个空用 `|` 合并成**同一个元素**（如 ['又大又红|又香又甜']）；
   * - judge：['对'] 或 ['错']；
   * - subjective：得分要点数组（如 ['要点一','要点二']）。
   */
  answer: string[];
  explanation?: string;
  /** 该题分值（支持 0.5）。 */
  score: number;
  /** 对应知识点（用于题库沉淀与同知识点变式）。 */
  knowledgePoint?: string;
}

/** 大题（含若干题）。 */
export interface ExamSection {
  sectionNo: number;
  sectionTitle: string;
  /** 该大题题型（同一大题内题型一致）。 */
  qtype: ExamQType;
  /** 该大题每题分值。 */
  score: number;
  questions: ExamQuestion[];
}

/** 试卷草稿（创建页编辑态 / 保存入参）。 */
export interface ExamPaper {
  title: string;
  subject: string;
  grade: string;
  /** 单元（组卷的关键定位字段，如「第一单元」）。 */
  unit: string;
  chapter: string;
  sections: ExamSection[];
  /** 知识点清单（原卷解析得到，或老师手填）。 */
  knowledgePoints?: string[];
}

/** 试卷列表项（教师「我的组卷」）。 */
export interface ExamPaperSet {
  id: string;
  title: string;
  subject: string;
  grade: string;
  unit: string;
  chapter: string;
  status: ExamPaperStatus;
  shareSlug: string;
  source: ExamPaperSource;
  /** 题目总数。 */
  questionCount: number;
  /** 卷面总分（各题分值之和）。 */
  totalScore: number;
  createdAt: string;
}

/** 组卷配置（来自 system_config.exam，全部后台可配，前端零硬编码）。 */
export interface ExamConfig {
  /** 各题型单题积分。 */
  questionCost: Record<string, number>;
  /** 题量阶梯折扣（按总题量取最小折扣）。 */
  bulkTiers: { min: number; discount: number }[];
  /** 折扣下限。 */
  minDiscount: number;
  /** 上传原卷 AI 识别的固定积分。 */
  importCostCredits: number;
  /** 默认题量。 */
  defaultQuestionCount: number;
}

/** 学生端题目（去敏，无答案、无解析）。 */
export interface StudentExamQuestion {
  sectionNo: number;
  sectionTitle: string;
  seq: number;
  qtype: ExamQType;
  stem: string;
  options?: string[];
  score: number;
}

/** 学生端试卷概要（去敏）。 */
export interface StudentExamPaper {
  title: string;
  grade: string;
  subject: string;
  unit: string;
  chapter: string;
  status: string;
}

/** 教师看板：一条学生提交。 */
export interface ExamPaperSubmission {
  /** 提交 id（主观题打分用）。 */
  submissionId: string;
  studentName: string;
  /** 客观题得分。 */
  score: number;
  /** 客观题题数。 */
  objectiveTotal: number;
  /** 主观题已批得分合计。 */
  subjectiveTotal: number;
  /** 客观 + 主观总分。 */
  finalScore: number;
  submittedAt: string;
  /** 学生作答原文（下标 = 全部题目的 0 基全局下标）。 */
  answers: string[];
}

/** 教师看板：单题统计。 */
export interface ExamQuestionStat {
  /** 题目 id（主观题打分用）。 */
  questionId: string;
  sectionNo: number;
  seq: number;
  qtype: ExamQType;
  stem: string;
  /** 客观题 = 正确率(0~1)；主观题 = 平均得分。 */
  metricType: 'correctRate' | 'avgScore';
  metricValue: number;
}

/** 教师看板统计。 */
export interface ExamPaperStats {
  submissions: ExamPaperSubmission[];
  perQuestion: ExamQuestionStat[];
}

/** 题库题目。 */
export interface QuestionBankItem {
  id: string;
  ownerId: string;
  subject: string;
  grade: string;
  unit: string;
  qtype: ExamQType;
  stem: string;
  options?: string[];
  answer: string[];
  explanation?: string;
  difficulty?: string;
  /** 知识点文本（knowledge_point_id 为空时的兜底）。 */
  knowledgePoint?: string;
  knowledgePointId?: string;
  /** 沉淀时的分值（组卷时可直接带出）。 */
  score: number;
  isPublic: boolean;
  /** 被组卷引用次数。 */
  usageCount: number;
  createdAt: string;
}

/** 知识点。 */
export interface KnowledgePoint {
  id: string;
  ownerId: string;
  subject: string;
  grade: string;
  unit: string;
  name: string;
  description?: string;
  isPublic: boolean;
  createdAt: string;
}
