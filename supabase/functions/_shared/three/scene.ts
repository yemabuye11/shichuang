/**
 * 3D 场景描述与构造助手（Edge 侧）。
 *
 * ⚠️ 真实 three.js 渲染**只在平台前端**完成（ThreeViewer 组件 `await import('three')`
 * 懒加载），Edge 侧不引入 three（避免增大函数体积、也避免服务端渲染无法离线）。
 *
 * 本模块只负责：
 * - 定义/复用 `SceneDescriptor`（与 `doc/types.ts` 同源）；
 * - 提供构造工厂、默认值、结构校验；
 * - 输出「前端查看器」可消费的 payload（含版本/标注/拆解开关）。
 */

import type { SceneDescriptor, SceneKind } from '../doc/types.ts';

/** 各场景类型的默认标题。 */
export const SCENE_KIND_TITLE: Readonly<Record<SceneKind, string>> = {
  geometry: '几何体演示',
  function: '函数图像',
  molecule: '分子模型',
  globe: '地球仪',
  circuit: '电路连接',
  biology: '生物结构',
  physics: '物理装置',
  custom: '自定义场景',
};

/** 各场景类型的默认参数骨架（供生成时兜底）。 */
export const SCENE_KIND_DEFAULT_PARAMS: Readonly<Record<SceneKind, Record<string, unknown>>> = {
  geometry: { shape: 'cube', size: 1 },
  function: { expr: 'sin(x)', xMin: -6.28, xMax: 6.28 },
  molecule: { formula: 'H2O', atoms: [] },
  globe: { tilt: 23.5, showGraticule: true },
  circuit: { topology: 'series', components: [] },
  biology: { organelle: 'cell', parts: [] },
  physics: { device: 'lever', params: {} },
  custom: {},
};

/**
 * 构造一个 SceneDescriptor（带默认值）。
 *
 * @param type 场景类型。
 * @param params 覆盖参数（合并默认骨架）。
 * @param options 标题/标注/可拆解。
 */
export function createScene(
  type: SceneKind,
  params: Record<string, unknown> = {},
  options: { title?: string; annotations?: string[]; explodable?: boolean } = {},
): SceneDescriptor {
  return {
    type,
    params: { ...SCENE_KIND_DEFAULT_PARAMS[type], ...params },
    explodable: options.explodable ?? true,
    annotations: options.annotations ?? [],
    title: options.title ?? SCENE_KIND_TITLE[type],
  };
}

/**
 * 校验 SceneDescriptor 结构是否可用于前端渲染。
 *
 * @param scene 场景描述（可能为任意值）。
 * @returns 校验结果。
 */
export function validateSceneDescriptor(scene: unknown): { ok: boolean; errors: string[]; scene: SceneDescriptor | null } {
  const errors: string[] = [];
  if (!scene || typeof scene !== 'object') {
    return { ok: false, errors: ['scene 必须是对象'], scene: null };
  }
  const s = scene as Partial<SceneDescriptor>;
  const kinds: SceneKind[] = ['geometry', 'function', 'molecule', 'globe', 'circuit', 'biology', 'physics', 'custom'];
  if (!kinds.includes(s.type as SceneKind)) {
    errors.push('scene.type 不是合法的场景类型');
  }
  if (!s.params || typeof s.params !== 'object') {
    errors.push('scene.params 必须是对象');
  }
  if (typeof s.explodable !== 'boolean') {
    errors.push('scene.explodable 必须是布尔值');
  }
  if (!Array.isArray(s.annotations)) {
    errors.push('scene.annotations 必须是数组');
  }
  return {
    ok: errors.length === 0,
    errors,
    scene: errors.length === 0 ? (s as SceneDescriptor) : null,
  };
}

/**
 * 输出前端 ThreeViewer 消费的标准 payload（含版本，便于未来增量兼容）。
 *
 * @param scene 场景描述。
 */
export function sceneToViewerPayload(scene: SceneDescriptor): Record<string, unknown> {
  return {
    version: 1,
    descriptor: scene,
  };
}
