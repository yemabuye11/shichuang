import { putHtml } from '@/utils/idb';
import { buildSampleAppHtml, kindForAppType, type SampleAppKind } from './sampleApp';
import { getAppTypeCost } from '@/config/constants';
import type { App } from '@/types/models';
import type { AppType } from '@/types/enums';

/**
 * 演示模式的种子数据。
 *
 * 目的：客户在没有 Supabase、没有大模型 Key 的情况下打开页面，
 * 首页「大家都在用」与应用广场**不是空白**，应用运行页也能真实打开一个可玩的应用。
 *
 * 设计约束：
 * - 只依赖 `@/utils/idb`（不 import service 层），避免与 `mockStore` 形成循环引用；
 * - 应用 ID 固定（`demo-app-1` …），保证刷新页面后链接依然有效；
 * - 封面走 `utils/cover.ts` 程序生成，零存储零流量。
 */

interface DemoAppSeed {
  /** 固定 ID。 */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly appType: AppType;
  readonly subject: string;
  readonly grade: string;
  readonly kind: SampleAppKind;
  readonly authorId: string;
  readonly authorName: string;
  readonly viewCount: number;
  readonly likeCount: number;
  /** 发布于多少天前（用于「最新」排序与相对时间展示）。 */
  readonly daysAgo: number;
  readonly prompt: string;
}

/** 8 个演示应用（覆盖 8 类应用类型）。 */
export const DEMO_APP_SEEDS: readonly DemoAppSeed[] = [
  {
    id: 'demo-app-1',
    title: '古诗词闯关大冒险',
    summary: '以《西游记》取经之路为故事线，5 关 20 题，答错可重做并有鼓励文案。',
    appType: 'teaching_game',
    subject: '语文',
    grade: '六年级',
    kind: 'quiz',
    authorId: 'demo-author-1',
    authorName: '王老师',
    viewCount: 1240,
    likeCount: 128,
    daysAgo: 2,
    prompt: '以《西游记》取经之路为故事线，生成六年级课内古诗词闯关游戏，共 5 关，每关 4 题。',
  },
  {
    id: 'demo-app-2',
    title: '勾股定理探究动画',
    summary: '五步动画演示勾股定理的推导，支持播放 / 暂停 / 上一步 / 重播。',
    appType: 'teaching_animation',
    subject: '数学',
    grade: '八年级',
    kind: 'animation',
    authorId: 'demo-author-2',
    authorName: '李老师',
    viewCount: 986,
    likeCount: 94,
    daysAgo: 5,
    prompt: '用动画演示勾股定理的推导过程，带旁白讲解与播放/暂停/重播/进度控制。',
  },
  {
    id: 'demo-app-3',
    title: '课堂随机点名器',
    summary: '可录入名单、支持单人 / 多人抽取与「不重复」模式，大字号适合投屏。',
    appType: 'edu_tool',
    subject: '综合',
    grade: '七年级',
    kind: 'picker',
    authorId: 'demo-author-3',
    authorName: '张老师',
    viewCount: 762,
    likeCount: 66,
    daysAgo: 1,
    prompt: '生成课堂随机点名器，可录入名单、支持单人/多人抽取与「不重复」模式，界面适合投屏。',
  },
  {
    id: 'demo-app-4',
    title: '英语单词记忆卡',
    summary: '翻转看释义、标记「已掌握」、随机打乱顺序，并统计本次正确率。',
    appType: 'interactive_courseware',
    subject: '英语',
    grade: '初一',
    kind: 'flashcard',
    authorId: 'demo-author-1',
    authorName: '王老师',
    viewCount: 654,
    likeCount: 58,
    daysAgo: 8,
    prompt: '生成初一英语单词记忆卡，支持翻转看释义、标记「已掌握」、随机打乱顺序。',
  },
  {
    id: 'demo-app-5',
    title: '九年级语文单元测验卷',
    summary: '基础积累 / 阅读理解 / 写作三大板块，附参考答案，A4 打印友好。',
    appType: 'ai_paper_composition',
    subject: '语文',
    grade: '九年级',
    kind: 'worksheet',
    authorId: 'demo-author-4',
    authorName: '陈老师',
    viewCount: 512,
    likeCount: 47,
    daysAgo: 12,
    prompt: '生成一份九年级语文下册第二单元测验卷，包含基础积累、阅读理解、写作三个板块，附答案与解析。',
  },
  {
    id: 'demo-app-6',
    title: '课内古诗文命题 10 题',
    summary: '一套 10 题，含答案与解析，一键打印，适合随堂小测。',
    appType: 'ai_item_generation',
    subject: '语文',
    grade: '八年级',
    kind: 'worksheet',
    authorId: 'demo-author-2',
    authorName: '李老师',
    viewCount: 431,
    likeCount: 39,
    daysAgo: 15,
    prompt: '围绕八年级课内古诗文生成一套 10 题的随堂小测，含答案与解析，可打印。',
  },
  {
    id: 'demo-app-7',
    title: '《背影》大单元教案',
    summary: '目标 / 重难点 / 教学过程 / 作业 / 板书，可直接打印用于教研。',
    appType: 'ai_lesson_plan',
    subject: '语文',
    grade: '八年级',
    kind: 'worksheet',
    authorId: 'demo-author-5',
    authorName: '刘老师',
    viewCount: 368,
    likeCount: 33,
    daysAgo: 20,
    prompt: '生成《背影》大单元教学设计，包含目标、重难点、教学过程、作业与板书设计，可打印。',
  },
  {
    id: 'demo-app-8',
    title: '课堂小调查',
    summary: '提交后本机展示结果汇总，不收集姓名等个人信息。',
    appType: 'data_collection',
    subject: '综合',
    grade: '五年级',
    kind: 'flashcard',
    authorId: 'demo-author-3',
    authorName: '张老师',
    viewCount: 287,
    likeCount: 21,
    daysAgo: 25,
    prompt: '生成一份课堂小调查，提交后本机展示结果汇总，不收集学生个人信息。',
  },
] as const;

/** 由时间戳构造 ISO 字符串（相对当前时间往前推 N 天）。 */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 构造全部演示应用（纯函数，供 `mockStore.load()` 播种）。
 *
 * @returns 演示应用列表（按发布时间倒序）。
 */
export function buildDemoApps(): App[] {
  return DEMO_APP_SEEDS.map((seed) => {
    const createdAt = isoDaysAgo(seed.daysAgo);
    return {
      id: seed.id,
      authorId: seed.authorId,
      category: 'app' as const,
      title: seed.title,
      summary: seed.summary,
      appType: seed.appType,
      subject: seed.subject,
      grade: seed.grade,
      textbook: '人教版',
      duration: '一节课',
      difficulty: '中等',
      promptRaw: seed.prompt,
      promptEnhanced: '',
      model: 'demo-model',
      promptVersion: 'system_core@1',
      htmlUrl: '',
      htmlStatus: 'ready' as const,
      htmlSizeBytes: 0,
      htmlSha256: `demo-${seed.id}`,
      htmlVersion: 1,
      coverKind: 'auto',
      coverSeed: seed.id,
      coverUrl: '',
      status: 'published' as const,
      publishedAt: createdAt,
      viewCount: seed.viewCount,
      likeCount: seed.likeCount,
      remixCount: 0,
      creditsCost: getAppTypeCost(seed.appType),
      tokensIn: 2100,
      tokensOut: 4300,
      generationMs: 42000,
      parentAppId: null,
      createdAt,
      updatedAt: createdAt,
      author: {
        id: seed.authorId,
        nickname: seed.authorName,
        avatarSeed: seed.authorId,
      },
      likedByMe: false,
    } satisfies App;
  });
}

/**
 * 把演示应用的 HTML 写入 IndexedDB（等效于「已发布到 CDN」的本地副本）。
 *
 * 幂等：重复写入只是覆盖，不会产生副作用；写入失败静默（仅影响演示预览）。
 */
export async function ensureDemoHtml(): Promise<void> {
  for (const seed of DEMO_APP_SEEDS) {
    try {
      const html = buildSampleAppHtml({
        title: seed.title,
        goal: seed.summary,
        subject: seed.subject,
        grade: seed.grade,
        kind: seed.kind,
      });
      await putHtml({
        appId: seed.id,
        html,
        sha256: `demo-${seed.id}`,
        version: 1,
        savedAt: Date.now(),
      });
    } catch {
      /* 忽略：IndexedDB 不可用时演示应用仍能展示卡片，仅无法预览 */
    }
  }
}

/**
 * 按应用类型生成一个「演示用」HTML（供本地生成链路复用）。
 *
 * @param appType 应用类型。
 * @param opts 标题 / 学习目标 / 学科 / 年级。
 */
export function buildHtmlForType(
  appType: AppType,
  opts: { title: string; goal: string; subject: string; grade: string },
): string {
  return buildSampleAppHtml({ ...opts, kind: kindForAppType(appType) });
}
