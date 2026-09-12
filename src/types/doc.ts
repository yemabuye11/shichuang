/**
 * 文档类产物（教案 / PPT / 课件 2D / 课件 3D / 办公文档）的领域模型。
 *
 * 设计原则（ARCHITECTURE.md §C.1 M1）：文档类做到「一份结构化源（DocModel），
 * 三种交付（网页 / 编辑 / 导出）」。本文件是**前后端共用**的类型真相源，
 * `supabase/functions/_shared/doc/types.ts` 与之保持字段一致。
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

/** 富文本块（文档类的最小内容单元，可被 TipTap / 导出映射复用）。 */
export interface DocBlock {
  /** 稳定 id（编辑/版本用）。 */
  readonly id: string;
  /** 块类型。 */
  readonly type: BlockType;
  /** 标题层级（仅 heading）。 */
  readonly level?: number;
  /** 纯文本 / 富文本内容（可含受控的轻量行内标记）。 */
  readonly text?: string;
  /** 列表是否有序（仅 list）。 */
  readonly ordered?: boolean;
  /** 列表项（仅 list）。 */
  readonly items?: readonly string[];
  /** 表格行（仅 table，每行为单元格数组）。 */
  readonly rows?: readonly (readonly string[])[];
  /** 表头（仅 table）。 */
  readonly header?: readonly string[];
  /** 图片地址 / 说明（仅 image / callout）。 */
  readonly src?: string;
  /** 说明文字（image / callout）。 */
  readonly caption?: string;
  /** 对齐方式。 */
  readonly align?: 'left' | 'center' | 'right';
}

/** PPT 单页幻灯片。 */
export interface Slide {
  /** 页序号，从 0 起。 */
  readonly index: number;
  /** 标题。 */
  readonly title: string;
  /** 正文块。 */
  readonly body: readonly DocBlock[];
  /** 演讲者备注。 */
  readonly notes?: string;
  /** 版式提示。 */
  readonly layout?: 'title' | 'content' | 'two_col' | 'section';
}

/** 3D 场景类型（真 Three.js 可渲染的实体）。 */
export type SceneKind =
  | 'geometry' // 几何体：正方体/圆柱/圆锥/球/棱锥 的展开与截面
  | 'function' // 函数图：y=f(x) 曲面 / 参数曲线
  | 'molecule' // 分子：水 / 甲烷 / DNA 双螺旋
  | 'globe' // 地球仪：经纬网 / 自转公转
  | 'circuit' // 电路：串并联 / 元件连接
  | 'biology' // 生物：细胞器 / 人体器官剖面
  | 'physics' // 物理：杠杆 / 滑轮 / 透镜成像
  | 'custom'; // 自定义：由 params 完全描述

/** 3D 场景描述（结构化，平台 ThreeViewer 渲染，亦可由生成物内嵌）。 */
export interface SceneDescriptor {
  /** 场景类型。 */
  readonly type: SceneKind;
  /** 结构化参数（几何尺寸 / 分子式 / 函数表达式等，按 type 约定）。 */
  readonly params: Readonly<Record<string, unknown>>;
  /** 是否可拆解（点击部件分离以观察内部）。 */
  readonly explodable: boolean;
  /** 标注文字列表（部件名称 / 知识点）。 */
  readonly annotations: readonly string[];
  /** 场景标题。 */
  readonly title?: string;
}

/** 文档元信息。 */
export interface DocMeta {
  /** 标题。 */
  readonly title: string;
  /** 学科。 */
  readonly subject?: string;
  /** 年级。 */
  readonly grade?: string;
  /** 教材版本。 */
  readonly textbook?: string;
  /** 作者。 */
  readonly author?: string;
  /** 时长。 */
  readonly duration?: string;
  /** 难度。 */
  readonly difficulty?: string;
}

/**
 * 文档结构化模型（DocModel）—— 一份真相源，三种交付。
 */
export interface DocModel {
  /** 文档实例 id（与 apps.id 一致）。 */
  readonly id: string;
  /** 文档大类。 */
  readonly kind: DocType;
  /** 元信息。 */
  readonly meta: DocMeta;
  /** 富文本块（教案 / 办公文档使用）。 */
  readonly blocks: readonly DocBlock[];
  /** 幻灯片（仅 ppt）。 */
  readonly slides?: readonly Slide[];
  /** 3D 场景（仅 courseware_3d）。 */
  readonly scene?: SceneDescriptor;
  /** 「待教师核对」标注处（AI 不确定点）。 */
  readonly verifyHints?: readonly string[];
  /** 版本号（从 1 起）。 */
  readonly version: number;
  /** 创建时间（ISO）。 */
  readonly createdAt?: string;
}

/** 教材版本（级联 5 维 + 上传 + 状态）。对应 T07 的 `textbook_versions` 表。 */
export interface TextbookVersion {
  readonly id: string;
  readonly authorId: string;
  readonly year: string;
  readonly version: string;
  readonly publisher: string;
  readonly subject: string;
  readonly grade: string;
  readonly uploadUrl: string | null;
  readonly status: 'draft' | 'verified';
  readonly createdAt: string;
}
