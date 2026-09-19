/**
 * PPT 课程施工图。
 *
 * 设计参考 OpenMAIC（THU-MAIC, MIT）的 Plan → Scene 两阶段生成：
 * 先把教师大纲冻结成有明确教学功能的页面计划，再让后续分段只负责完成
 * 对应页面。这里没有直接搬迁 OpenMAIC 的 Next.js/LangGraph 运行时代码，
 * 而是按师创现有 DocModel / PPTX 导出链路做了独立实现。
 */

export type PptPlanPageKind =
  | 'cover'
  | 'objectives'
  | 'hook'
  | 'concept'
  | 'example'
  | 'activity'
  | 'practice'
  | 'discussion'
  | 'summary'
  | 'homework'
  | 'review';

export type PptPlanLayout = 'title' | 'content' | 'two_col' | 'section';

export interface PptPlanPage {
  /** 从 1 开始的页码。 */
  readonly page: number;
  readonly title: string;
  readonly kind: PptPlanPageKind;
  readonly layout: PptPlanLayout;
  /** 本页必须覆盖的大纲知识点。 */
  readonly keyPoints: readonly string[];
  /** 本页适合的视觉表达。 */
  readonly visual: string;
  /** 学生需要实际完成的课堂动作。 */
  readonly teacherAction: string;
}

export interface PptPlan {
  readonly title: string;
  /** 是否由教师导入的大纲构建。 */
  readonly outlineBased: boolean;
  readonly pages: readonly PptPlanPage[];
}

export interface BuildPptPlanInput {
  readonly prompt: string;
  readonly outlineContent?: string;
  readonly totalPages: number;
  readonly subject?: string;
  readonly grade?: string;
}

interface OutlineNode {
  readonly title: string;
  readonly details: readonly string[];
}

const DEFAULT_ROADMAP: readonly OutlineNode[] = [
  { title: '封面', details: [] },
  { title: '学习目标', details: ['知道本课要学什么', '能完成什么任务', '怎样判断自己学会了'] },
  { title: '情境导入', details: ['用问题、故事或生活情境引出课题'] },
  { title: '初读与感知', details: ['整体感知学习对象', '提出初步观察和问题'] },
  { title: '核心概念理解', details: ['先举例，再概括', '用自己的话说出关键含义'] },
  { title: '知识讲解 1', details: ['围绕一个核心知识点讲清来龙去脉'] },
  { title: '知识讲解 2', details: ['补充第二个关键知识点并建立联系'] },
  { title: '例题示范', details: ['完整示范思考、步骤、答案和检查'] },
  { title: '跟着做', details: ['学生按步骤模仿完成', '教师即时巡视和点拨'] },
  { title: '易错提醒', details: ['指出最常见错误', '给出辨析方法和提醒'] },
  { title: '基础练习', details: ['覆盖核心知识的最低达标任务'] },
  { title: '提高练习', details: ['在基础任务上增加变化和迁移'] },
  { title: '迁移应用', details: ['把知识用于新的情境或真实任务'] },
  { title: '课堂讨论', details: ['围绕一个有争议或需要解释的问题交流'] },
  { title: '方法归纳', details: ['整理步骤、关键词和判断依据'] },
  { title: '课堂小结', details: ['学生复述本节课的知识结构'] },
  { title: '分层作业', details: ['基础任务与拓展任务分层'] },
  { title: '教师核对与课上机动', details: ['核对教材、事实和课堂节奏', '记录下节课需要补强的内容'] },
];

const EXTRA_FILL_PAGES: readonly OutlineNode[] = [
  { title: '观察与比较', details: ['比较相同点和不同点', '用证据说明判断'] },
  { title: '合作任务', details: ['明确分工、时间和产出', '完成后进行同伴互评'] },
  { title: '表达与展示', details: ['用自己的话讲清思路', '倾听并补充他人观点'] },
  { title: '联系生活', details: ['找出生活中的相似现象或应用'] },
  { title: '自我检查', details: ['对照目标检查掌握情况', '标记仍不确定的问题'] },
  { title: '拓展思考', details: ['提出一个可以继续探究的问题'] },
];

const PAGE_KIND_LABEL: Readonly<Record<PptPlanPageKind, string>> = {
  cover: '封面',
  objectives: '学习目标',
  hook: '情境导入',
  concept: '概念讲解',
  example: '例题示范',
  activity: '课堂活动',
  practice: '练习检测',
  discussion: '讨论交流',
  summary: '总结归纳',
  homework: '分层作业',
  review: '教师核对',
};

const COVER_RE = /封面|课题|标题|课程名|首页|欢迎/;
const OBJECTIVE_RE = /学习目标|教学目标|学习任务|学习导航|本节课|要学什么|学会/;
const HOOK_RE = /导入|情境|激趣|猜谜|问题引入|生活|故事|观察|初读|感知/;
const EXAMPLE_RE = /例题|示范|例\d|精讲|讲解|演示|方法/;
const ACTIVITY_RE = /活动|实验|操作|动手|游戏|演一演|说一说|读一读|实践|合作|探究|任务/;
const PRACTICE_RE = /练习|检测|测验|巩固|应用|达标|随堂/;
const DISCUSSION_RE = /讨论|交流|辩论|分享|追问|思考/;
const SUMMARY_RE = /小结|总结|归纳|回顾|梳理|知识树|思维导图/;
const HOMEWORK_RE = /作业|课后|分层任务|拓展任务/;
const REVIEW_RE = /核对|复盘|教学反思|机动/;

function cleanLine(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+•]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNumberMarker(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s+)/, '')
    .replace(/^\s*(?:\d{1,3}|[一二三四五六七八九十]+)[、.．)）]\s*/, '')
    .trim();
}

function shortTitle(value: string, fallback = '课堂内容'): string {
  const cleaned = stripNumberMarker(
    cleanLine(value)
      .replace(/^第\s*\d{1,3}\s*(?:页|张|幻灯片)\s*[｜|:：\-—.)、]?\s*/i, '')
      .replace(/^["“”'‘’]+|["“”'‘’]+$/g, ''),
  )
    .replace(/[。！？!?；;：:，,、\s]+$/g, '')
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 22) return cleaned;
  const firstClause = cleaned.split(/[。！？!?；;：:，,]/).find((part) => part.trim().length >= 4);
  const selected = (firstClause || cleaned).trim();
  return selected.length <= 22 ? selected : `${selected.slice(0, 21)}…`;
}

function shortDetail(value: string): string {
  const cleaned = cleanLine(value)
    .replace(/^第\s*\d{1,3}\s*(?:页|张|幻灯片)\s*[｜|:：\-—.)、]?\s*/i, '')
    .trim();
  if (cleaned.length <= 90) return cleaned;
  return `${cleaned.slice(0, 89)}…`;
}

function uniqueStrings(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function parseExplicitPages(text: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  let current: { title: string; details: string[] } | null = null;
  const lines = text.split('\n');
  const pagePattern =
    /^\s*(?:第\s*)?(\d{1,3})\s*(?:页|张|幻灯片|slide)\s*(?:[｜|:：\-—.)、]\s*)?(.*)$/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(pagePattern);
    if (match) {
      if (current) nodes.push(current);
      const pageNumber = Number.parseInt(match[1] ?? '', 10);
      const title = shortTitle(match[2] ?? '', `第 ${pageNumber || nodes.length + 1} 页`);
      current = { title, details: [] };
      continue;
    }
    if (!current) continue;
    const detail = shortDetail(line);
    if (detail && detail !== current.title) current.details.push(detail);
  }
  if (current) nodes.push(current);
  return nodes;
}

function headingText(raw: string): string | null {
  const line = raw.trim();
  if (!line) return null;
  const markdown = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
  if (markdown) return cleanLine(markdown[1] ?? '');
  const numbered = line.match(
    /^(?:[一二三四五六七八九十]+[、.．]|[（(][一二三四五六七八九十]+[）)]|\d{1,2}[、.．])\s*(.+)$/,
  );
  if (numbered && line.length <= 42) return cleanLine(numbered[1] ?? '');
  return null;
}

function parseHeadings(text: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  let current: { title: string; details: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = headingText(raw);
    if (heading) {
      if (current) nodes.push(current);
      current = { title: shortTitle(heading), details: [] };
      continue;
    }
    if (!current) {
      current = { title: shortTitle(line), details: [] };
      continue;
    }
    const detail = shortDetail(line);
    if (detail && detail !== current.title) current.details.push(detail);
  }
  if (current) nodes.push(current);
  return nodes;
}

function parseTopLevelBullets(text: string): OutlineNode[] {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const topBullet = /^(?:[-*+•]|(?:\d{1,2}|[一二三四五六七八九十]+)[、.．)）])\s+/;
  const bulletCount = lines.filter((line) => topBullet.test(line.trim())).length;
  if (bulletCount < 3) return [];

  const nodes: OutlineNode[] = [];
  let rootTitle = '';
  let current: { title: string; details: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (topBullet.test(line)) {
      if (current) nodes.push(current);
      current = { title: shortTitle(line), details: [] };
      continue;
    }
    if (!current) {
      rootTitle ||= shortTitle(line);
      continue;
    }
    const detail = shortDetail(line);
    if (detail && detail !== current.title) current.details.push(detail);
  }
  if (current) nodes.push(current);
  if (nodes.length === 0) return [];
  if (rootTitle && !nodes.some((node) => node.title === rootTitle)) {
    nodes.unshift({ title: rootTitle, details: [] });
  }
  return nodes;
}

function parseParagraphs(text: string): OutlineNode[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    const lines = text.split('\n').map(cleanLine).filter(Boolean);
    if (lines.length === 0) return [];
    return [{ title: shortTitle(lines[0] ?? ''), details: uniqueStrings(lines.slice(1).map(shortDetail), 8) }];
  }
  return paragraphs.slice(0, 80).map((paragraph) => {
    const lines = paragraph.split('\n').map(cleanLine).filter(Boolean);
    return {
      title: shortTitle(lines[0] ?? ''),
      details: uniqueStrings(lines.slice(1).map(shortDetail), 8),
    };
  });
}

function parseOutlineNodes(content: string | undefined): OutlineNode[] {
  const text = (content ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const explicitPages = parseExplicitPages(text).filter((node) => node.title.trim().length > 0);
  if (explicitPages.length > 0) return explicitPages.slice(0, 120);

  // 单标题 + 多条项目符号是教师粘贴大纲最常见的格式。若先按标题解析，
  // 所有项目会被当成同一页的细节，后续就无法扩成完整课件。
  const headings = parseHeadings(text).filter((node) => node.title.trim().length > 0);
  if (headings.length >= 2) return headings.slice(0, 120);

  const bullets = parseTopLevelBullets(text).filter((node) => node.title.trim().length > 0);
  if (bullets.length >= 3) return bullets.slice(0, 120);

  const paragraphs = parseParagraphs(text).filter((node) => node.title.trim().length > 0);
  return paragraphs.slice(0, 120);
}

function mergeNodes(nodes: readonly OutlineNode[], count: number): OutlineNode[] {
  if (nodes.length <= count) return [...nodes];
  const groups = Array.from({ length: count }, () => [] as OutlineNode[]);
  nodes.forEach((node, index) => {
    const groupIndex = Math.min(count - 1, Math.floor((index * count) / nodes.length));
    groups[groupIndex].push(node);
  });

  return groups.map((group, groupIndex) => {
    if (group.length === 1) return group[0];
    const title = group[0].title;
    const details = uniqueStrings(
      group.flatMap((node, index) => [
        ...(index > 0 ? [`${node.title}：${node.details[0] ?? '完成本环节'}`] : []),
        ...node.details,
      ]).map(shortDetail),
      10,
    );
    return {
      title: title || `课堂内容 ${groupIndex + 1}`,
      details,
    };
  });
}

function matches(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  return regex.test(value);
}

function looksLikeCover(node: OutlineNode | undefined): boolean {
  if (!node) return false;
  return matches(COVER_RE, node.title) || (node.details.length === 0 && node.title.length <= 18);
}

function classifyKind(index: number, title: string): PptPlanPageKind {
  if (index === 0) return 'cover';
  if (matches(OBJECTIVE_RE, title)) return 'objectives';
  if (matches(SUMMARY_RE, title)) return 'summary';
  if (matches(HOMEWORK_RE, title)) return 'homework';
  if (matches(REVIEW_RE, title)) return 'review';
  if (matches(EXAMPLE_RE, title)) return 'example';
  if (matches(PRACTICE_RE, title)) return 'practice';
  if (matches(DISCUSSION_RE, title)) return 'discussion';
  if (matches(ACTIVITY_RE, title)) return 'activity';
  if (matches(HOOK_RE, title)) return 'hook';
  return 'concept';
}

function chooseLayout(index: number, title: string, keyPoints: readonly string[]): PptPlanLayout {
  if (index === 0) return 'title';
  if (/对比|比较|异同|区别|分类|左边|右边|相同|不同/.test(title)) return 'two_col';
  if (
    keyPoints.length >= 4 &&
    keyPoints.some((point) => /对比|比较|异同|区别|分类|相同|不同/.test(point))
  ) {
    return 'two_col';
  }
  if (/单元|章节|课时|模块|第一部分|第二部分|第三部分/.test(title)) return 'section';
  return 'content';
}

function visualRule(earlyChildhood: boolean, subject: string, kind: PptPlanPageKind): string {
  if (earlyChildhood) {
    return '童趣图标卡或观察图：2~4 个中文字词、动作、角色或画面，禁止柱形图、折线图、坐标轴和数量对比';
  }
  if (/数学|物理|化学|生物|科学|地理|信息科技/.test(subject)) {
    return kind === 'practice' || kind === 'example'
      ? '短数据表格或示意图；需要数据关系时用不超过 5 项的 chart'
      : '关系图、流程图或短数据 chart；不堆装饰图';
  }
  if (/语文|英语|道德与法治|历史/.test(subject)) {
    return '词语卡、情节顺序图、人物关系图或对比表';
  }
  return '流程图、关系图、对比表或图标卡，选择最能解释本页重点的一种';
}

function teacherAction(kind: PptPlanPageKind, earlyChildhood: boolean): string {
  if (earlyChildhood) {
    switch (kind) {
      case 'cover':
        return '请学生看课题、猜内容，说一句自己最想知道的问题';
      case 'objectives':
        return '教师用儿童化语言读目标，请学生跟着说一个本节课要完成的动作';
      case 'hook':
        return '观察画面或听情境，请学生说看到了什么、想到了什么';
      case 'activity':
        return '做一做、演一演或同桌说一说，教师给出一个清楚口令';
      case 'practice':
        return '先独立做，再同桌互查；教师追问“你是怎么知道的”';
      default:
        return '看一看、说一说、读一读或指一指，至少让一名学生完整表达';
    }
  }
  switch (kind) {
    case 'cover':
      return '用真实问题或生活情境引出课题，不直接报结论';
    case 'objectives':
      return '让学生用自己的话说出本节课要解决的问题和达成标准';
    case 'hook':
      return '先让学生观察、预测或提出疑问，再进入知识讲解';
    case 'example':
      return '教师完整示范后，请学生复述关键步骤并独立完成同类题';
    case 'activity':
      return '写明任务、时间、分工和产出，活动后必须展示并评价';
    case 'practice':
      return '设置基础与提高两层任务，至少暴露并纠正一个常见错误';
    case 'discussion':
      return '先独立思考，再同桌或小组交流，最后请代表说明理由';
    case 'summary':
      return '让学生先复述知识结构，教师只补充遗漏和易错点';
    case 'homework':
      return '说明分层要求、完成标准和提交方式，避免只写“完成练习”';
    case 'review':
      return '教师核对教材事实、页码、例子和课堂节奏，标记需要调整处';
    default:
      return '围绕一个核心问题讲解，讲解中至少安排一次学生口头或书面回应';
  }
}

function ensureExactPageCount(
  nodes: readonly OutlineNode[],
  totalPages: number,
  courseTitle: string,
  outlineBased: boolean,
): OutlineNode[] {
  let sequence = [...nodes];
  if (!outlineBased || sequence.length === 0) {
    sequence = [...DEFAULT_ROADMAP];
    sequence[0] = { title: courseTitle, details: [] };
  } else if (!looksLikeCover(sequence[0])) {
    sequence.unshift({ title: courseTitle, details: [] });
  }

  if (
    sequence.length < totalPages &&
    !sequence.some((node, index) => index > 0 && matches(OBJECTIVE_RE, node.title))
  ) {
    const objectives = DEFAULT_ROADMAP.find((node) => matches(OBJECTIVE_RE, node.title));
    if (objectives) sequence.splice(Math.min(1, sequence.length), 0, objectives);
  }
  if (sequence.length < totalPages && !sequence.some((node) => matches(SUMMARY_RE, node.title))) {
    const summary = DEFAULT_ROADMAP.find((node) => matches(SUMMARY_RE, node.title));
    if (summary) sequence.push(summary);
  }
  if (sequence.length < totalPages && !sequence.some((node) => matches(HOMEWORK_RE, node.title))) {
    const homework = DEFAULT_ROADMAP.find((node) => matches(HOMEWORK_RE, node.title));
    if (homework) sequence.push(homework);
  }

  let fillIndex = 0;
  while (sequence.length < totalPages) {
    const base = EXTRA_FILL_PAGES[fillIndex % EXTRA_FILL_PAGES.length];
    const round = Math.floor(fillIndex / EXTRA_FILL_PAGES.length);
    sequence.push({
      title: round === 0 ? base.title : `${base.title} ${round + 1}`,
      details: base.details,
    });
    fillIndex += 1;
  }

  if (sequence.length > totalPages) {
    sequence = mergeNodes(sequence, totalPages);
  }
  return sequence;
}

function uniquePageTitles(nodes: readonly OutlineNode[]): OutlineNode[] {
  const used = new Map<string, number>();
  return nodes.map((node) => {
    const count = (used.get(node.title) ?? 0) + 1;
    used.set(node.title, count);
    return count === 1 ? node : { ...node, title: `${node.title}（${count}）` };
  });
}

/**
 * 根据教师需求或导入大纲构建稳定、可跨请求复用的课程施工图。
 */
export function buildPptPlan(input: BuildPptPlanInput): PptPlan {
  const outlineNodes = parseOutlineNodes(input.outlineContent);
  const outlineBased = outlineNodes.length > 0;
  const courseTitle = shortTitle(
    input.prompt || outlineNodes[0]?.title || '课堂课件',
    '课堂课件',
  );
  const totalPages = Math.max(3, Math.min(45, Math.floor(input.totalPages) || 18));
  const normalizedNodes = uniquePageTitles(
    ensureExactPageCount(outlineNodes, totalPages, courseTitle, outlineBased),
  );
  const earlyChildhood = /幼儿园|学前|(?:一|二|三|1|2|3)年级/.test(
    (input.grade ?? '').replace(/\s+/g, ''),
  );
  const subject = input.subject ?? '';

  const pages = normalizedNodes.map((node, index): PptPlanPage => {
    const kind = classifyKind(index, node.title);
    const keyPoints = uniqueStrings(
      node.details.length > 0
        ? node.details
        : index === 0
          ? [`课题：${node.title}`]
          : [`围绕“${node.title}”补全关键知识、示范和检查标准`],
      7,
    );
    return {
      page: index + 1,
      title: node.title,
      kind,
      layout: chooseLayout(index, node.title, keyPoints),
      keyPoints,
      visual: visualRule(earlyChildhood, subject, kind),
      teacherAction: teacherAction(kind, earlyChildhood),
    };
  });

  return {
    title: courseTitle,
    outlineBased,
    pages,
  };
}

/** 全课总览：放进 system 后的 user 前缀，稳定缓存并锁定顺序。 */
export function formatPptPlanOverview(plan: PptPlan): string {
  const rows = plan.pages.map(
    (page) => `${page.page}. ${page.title}｜${PAGE_KIND_LABEL[page.kind]}｜${page.layout}`,
  );
  return [
    `课程名称：${plan.title}`,
    `总页数：${plan.pages.length}`,
    plan.outlineBased
      ? '说明：页面顺序和标题来自教师大纲，已冻结。不得增删、重排或另起一套栏目。'
      : '说明：页面顺序和标题已冻结。每页只完成对应教学功能，不重复其他页面。',
    '全课施工图：',
    ...rows,
  ].join('\n');
}

/**
 * 单个分段的施工图。只发送本段三页的详细目标，避免每段都携带整份大纲。
 */
export function formatPptPlanPart(
  plan: PptPlan,
  part: number,
  pagesPerPart = 3,
): string {
  const startIndex = Math.max(0, (Math.max(1, part) - 1) * pagesPerPart);
  const selected = plan.pages.slice(startIndex, startIndex + pagesPerPart);
  if (selected.length === 0) return '';

  const rows = selected.flatMap((page) => [
    `第 ${page.page} 页｜${page.title}`,
    `教学功能：${PAGE_KIND_LABEL[page.kind]}`,
    `版式：${page.layout}`,
    `必须覆盖：${page.keyPoints.join('；') || '围绕标题补全真实教学内容'}`,
    `视觉：${page.visual}`,
    `课堂动作：${page.teacherAction}`,
  ]);

  return [
    `本段只生成全课第 ${selected[0].page}~${selected[selected.length - 1].page} 页。`,
    '标题、教学功能和顺序均已冻结；页面标题必须使用下方标题，不得自行增删页面。',
    ...rows,
  ].join('\n');
}
