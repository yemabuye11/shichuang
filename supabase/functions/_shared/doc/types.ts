/**
 * 文档类产物（教案 / PPT / 课件 2D / 课件 3D / 办公文档）的领域模型。
 *
 * 与前端 `src/types/doc.ts` 字段保持一致（一份结构化源 → 三种交付）。
 * 本文件运行在 Edge（Deno）侧，用于生成/校验/渲染 DocModel。
 *
 * 设计原则（ARCHITECTURE.md §C.1 M1）：
 *   DocModel 是「真相源」，Web 渲染（render.ts）、编辑（前端 TipTap）、
 *   导出（exportMap.ts → T08 的 docx/pptxgenjs）三处复用同一结构。
 */

/** 文档大类（对应 `apps.category='doc'` 时的 `doc_type`）。 */
export type DocType =
  | 'lesson_plan' // 教案
  | 'ppt' // 课件 PPT
  | 'courseware_2d' // 课件 2D / 伪 3D
  | 'courseware_3d' // 课件 3D（真 Three.js）
  | 'office_doc'; // 办公文档

/** 文档校验状态（AI 生成内容需教师核对）。 */
export type VerifyStatus = 'pending' | 'verified' | 'partial';

/** 产物大类：应用（单文件 HTML 沙箱） vs 文档（平台渲染壳）。 */
export type Category = 'app' | 'doc';

/** 富文本块类型。 */
export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'image'
  | 'callout';

/** 富文本块（文档类的最小内容单元，可被编辑/导出映射复用）。 */
export interface DocBlock {
  readonly id: string;
  readonly type: BlockType;
  readonly level?: number;
  readonly text?: string;
  readonly ordered?: boolean;
  readonly items?: readonly string[];
  readonly rows?: readonly (readonly string[])[];
  readonly header?: readonly string[];
  readonly src?: string;
  readonly caption?: string;
  readonly align?: 'left' | 'center' | 'right';
}

/** PPT 单页幻灯片。 */
export interface Slide {
  readonly index: number;
  readonly title: string;
  readonly body: readonly DocBlock[];
  readonly notes?: string;
  readonly layout?: 'title' | 'content' | 'two_col' | 'section';
}

/** 3D 场景类型（真 Three.js 可渲染的实体）。 */
export type SceneKind =
  | 'geometry'
  | 'function'
  | 'molecule'
  | 'globe'
  | 'circuit'
  | 'biology'
  | 'physics'
  | 'custom';

/** 3D 场景描述（结构化，平台 ThreeViewer 渲染，亦可由生成物内嵌）。 */
export interface SceneDescriptor {
  readonly type: SceneKind;
  readonly params: Readonly<Record<string, unknown>>;
  readonly explodable: boolean;
  readonly annotations: readonly string[];
  readonly title?: string;
}

/** 文档元信息。 */
export interface DocMeta {
  readonly title: string;
  readonly subject?: string;
  readonly grade?: string;
  readonly textbook?: string;
  readonly author?: string;
  readonly duration?: string;
  readonly difficulty?: string;
}

/**
 * 文档结构化模型（DocModel）—— 一份真相源，三种交付。
 */
export interface DocModel {
  readonly id: string;
  readonly kind: DocType;
  readonly meta: DocMeta;
  readonly blocks: readonly DocBlock[];
  readonly slides?: readonly Slide[];
  readonly scene?: SceneDescriptor;
  readonly verifyHints?: readonly string[];
  readonly version: number;
  readonly createdAt?: string;
}

/** 文档类型中文名。 */
export const DOC_TYPE_LABELS: Readonly<Record<DocType, string>> = {
  lesson_plan: '教案',
  ppt: 'PPT 课件',
  courseware_2d: '课件（2D）',
  courseware_3d: '课件（3D）',
  office_doc: '办公文档',
};

/** 文档类型 → 默认积分成本（与 migration 0012 app_type_profiles 对应）。 */
export const DOC_TYPE_COST: Readonly<Record<DocType, number>> = {
  lesson_plan: 1,
  ppt: 2,
  courseware_2d: 2,
  courseware_3d: 3,
  office_doc: 1,
};

/** 是否为合法的文档类型。 */
export function isDocType(value: unknown): value is DocType {
  return (
    value === 'lesson_plan' ||
    value === 'ppt' ||
    value === 'courseware_2d' ||
    value === 'courseware_3d' ||
    value === 'office_doc'
  );
}
