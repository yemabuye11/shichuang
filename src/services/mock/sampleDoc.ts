import type { DocModel, DocType } from '@/types/doc';

/**
 * MOCK 文档样例构造（T06 离线演示用，不调用真实模型）。
 *
 * 为 5 类文档各提供一份**合法可解析**的示例 DocModel，确保「输入 → 流式生成 →
 * DocRunPage 渲染」在 Mock 模式下也能端到端跑通。
 */

/** 安全截断标题。 */
function titleOf(topic: string, suffix: string): string {
  const core = topic.replace(/\s+/g, ' ').trim().slice(0, 24) || '示例教学内容';
  return `${core}（${suffix}示例）`;
}

/** 构造一个教案样例。 */
function lessonPlan(topic: string): DocModel {
  return {
    id: 'mock-doc',
    kind: 'lesson_plan',
    meta: { title: titleOf(topic, '教案'), subject: '语文', grade: '六年级', textbook: '部编版', difficulty: '中等' },
    blocks: [
      { id: 'b1', type: 'heading', level: 1, text: titleOf(topic, '教案') },
      { id: 'b2', type: 'paragraph', text: '本示例由本地 Mock 生成，未调用真实模型、不产生任何费用，请替换为真实教学内容。' },
      { id: 'b3', type: 'heading', level: 2, text: '一、教学基本信息' },
      { id: 'b4', type: 'list', ordered: false, items: ['学科：语文', '年级：六年级', '课时：1 课时', '教材版本：部编版'] },
      { id: 'b5', type: 'heading', level: 2, text: '二、教学目标' },
      { id: 'b6', type: 'list', ordered: false, items: ['知识与技能：理解本节核心概念', '过程与方法：通过实例归纳规律', '情感态度价值观：体会学科价值'] },
      { id: 'b7', type: 'heading', level: 2, text: '三、教学重难点' },
      { id: 'b8', type: 'list', ordered: false, items: ['重点：核心概念的应用', '难点：抽象规律的建立'] },
      { id: 'b9', type: 'heading', level: 2, text: '四、教学过程' },
      { id: 'b10', type: 'list', ordered: true, items: ['导入（5 分钟）：情境激趣', '新授（20 分钟）：讲解与示范', '练习（10 分钟）：随堂检测', '小结（5 分钟）：回顾要点'] },
      { id: 'b11', type: 'callout', text: '提示：请教师结合实际学情调整例题与活动。' },
    ],
    verifyHints: ['示例内容，请教师核对并替换为真实教材内容'],
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/** 构造一个 PPT 样例。 */
function ppt(topic: string): DocModel {
  return {
    id: 'mock-doc',
    kind: 'ppt',
    meta: { title: titleOf(topic, 'PPT'), subject: '数学', grade: '初二', textbook: '人教版', difficulty: '中等' },
    blocks: [],
    slides: [
      { index: 0, title: '封面', body: [{ id: 's0', type: 'heading', level: 1, text: titleOf(topic, 'PPT') }], layout: 'title' },
      { index: 1, title: '学习目标', body: [{ id: 's1', type: 'list', ordered: false, items: ['目标一：理解概念', '目标二：掌握方法'] }], layout: 'content', notes: '开场说明本节课目标' },
      { index: 2, title: '核心讲解', body: [{ id: 's2', type: 'paragraph', text: '这里放核心知识点讲解。' }, { id: 's3', type: 'image', caption: '建议配图：概念示意图' }], layout: 'two_col' },
      { index: 3, title: '课堂小结', body: [{ id: 's4', type: 'list', ordered: false, items: ['要点一', '要点二'] }], layout: 'section' },
    ],
    verifyHints: ['示例内容，请教师替换为真实教材内容'],
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/** 构造一个 2D 课件样例。 */
function courseware2d(topic: string): DocModel {
  return {
    id: 'mock-doc',
    kind: 'courseware_2d',
    meta: { title: titleOf(topic, '课件2D'), subject: '生物', grade: '初一', textbook: '人教版', difficulty: '简单' },
    blocks: [
      { id: 'b1', type: 'heading', level: 1, text: titleOf(topic, '课件2D') },
      { id: 'b2', type: 'paragraph', text: '本节以图文为主，边看边学。' },
      { id: 'b3', type: 'image', caption: '建议配图/动画：核心结构示意' },
      { id: 'b4', type: 'callout', text: '想一想：这个结构与功能有什么关系？' },
      { id: 'b5', type: 'heading', level: 2, text: '小结' },
      { id: 'b6', type: 'list', ordered: false, items: ['要点一', '要点二'] },
    ],
    verifyHints: ['示例内容，请教师核对'],
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/** 构造一个 3D 课件样例。 */
function courseware3d(topic: string): DocModel {
  return {
    id: 'mock-doc',
    kind: 'courseware_3d',
    meta: { title: titleOf(topic, '课件3D'), subject: '物理', grade: '高一', textbook: '人教版', difficulty: '较难' },
    blocks: [
      { id: 'b1', type: 'heading', level: 1, text: titleOf(topic, '课件3D') },
      { id: 'b2', type: 'paragraph', text: '下方 3D 模型可旋转、缩放与拆解，便于观察内部结构。' },
      { id: 'b3', type: 'callout', text: '操作：拖动旋转，双指缩放，点击部件查看标注。' },
    ],
    scene: {
      type: 'geometry',
      params: { shape: 'cube', size: 1 },
      explodable: true,
      annotations: ['六个面', '顶点与棱长'],
      title: '几何体演示',
    },
    verifyHints: ['示例 3D 参数，请教师确认'],
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/** 构造一个办公文档样例。 */
function officeDoc(topic: string): DocModel {
  return {
    id: 'mock-doc',
    kind: 'office_doc',
    meta: { title: titleOf(topic, '办公文档'), subject: '通用', grade: '通用', textbook: '通用', difficulty: '中等' },
    blocks: [
      { id: 'b1', type: 'heading', level: 1, text: titleOf(topic, '办公文档') },
      { id: 'b2', type: 'paragraph', text: '本示例为办公文档模板，可直接复制到 Word/WPS 使用。' },
      { id: 'b3', type: 'heading', level: 2, text: '一、背景' },
      { id: 'b4', type: 'paragraph', text: '说明背景与目的。' },
      { id: 'b5', type: 'heading', level: 2, text: '二、安排' },
      { id: 'b6', type: 'table', header: ['事项', '负责人', '时间'], rows: [['事项一', '王老师', '周一'], ['事项二', '李老师', '周三']] },
      { id: 'b7', type: 'callout', text: '落款与日期请按需补填，不要编造真实机构名。' },
    ],
    verifyHints: ['示例内容，请教师替换为真实信息'],
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 构造一个示例 DocModel（按文档类型）。
 *
 * @param docType 文档类型。
 * @param topic 教师输入的主题。
 */
export function buildSampleDocModel(docType: DocType, topic: string): DocModel {
  switch (docType) {
    case 'ppt':
      return ppt(topic);
    case 'courseware_2d':
      return courseware2d(topic);
    case 'courseware_3d':
      return courseware3d(topic);
    case 'office_doc':
      return officeDoc(topic);
    case 'lesson_plan':
    default:
      return lessonPlan(topic);
  }
}

/**
 * 生成一份用于本地缓存的预览 HTML（DocRunPage 主要消费 docJson，这里仅作回退）。
 *
 * @param model 文档模型。
 */
export function buildDocPreviewHtml(model: DocModel): string {
  const title = (model.meta?.title ?? '文档').replace(/[<>&"]/g, '');
  const blocks = (model.blocks ?? [])
    .map((b) => `<p>${String(b.text ?? '').replace(/[<>&]/g, '')}</p>`)
    .join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${blocks}<p>本内容为 AI 生成示例，请在平台内核对后使用。</p></body></html>`;
}
