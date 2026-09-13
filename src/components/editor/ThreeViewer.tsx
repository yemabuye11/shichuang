import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import LayersIcon from '@mui/icons-material/Layers';
import LabelIcon from '@mui/icons-material/Label';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { SceneDescriptor, SceneKind } from '@/types/doc';
import { checkGeometry, parseShape, resolveDims, GEO_SHAPE_LABEL } from '@/utils/geometryKernel';

/**
 * 3D 课件查看器（courseware_3d）。
 *
 * 硬性约束（ARCHITECTURE.md §C.1 / T06 红线）：
 * - `three` **必须动态 import**，不进入主包（版本锁定 Vite5/React18，懒加载保证首屏体积）；
 * - 移动端降低多边形与像素比；
 * - 支持：旋转（OrbitControls）/ 拆解（explode）/ 标注（annotations 投影到屏幕）。
 *
 * 本组件只负责「渲染一个 SceneDescriptor」，不关心来源（AI 生成 or 预置）。
 */
/**
 * 平台**真正能渲染**的 3D 场景类型。
 *
 * ⚠️ 硬约束（见 docs/QUALITY_BASELINE.md）：只保留 geometry（基础几何体）与
 * molecule（球棍分子）两类真模型。`function` / `globe` / `circuit` / `biology` /
 * `physics` / `custom` 目前**没有真实现**——历史上它们会退化成「蓝方块 + 4 个橙球」
 * 或写死的 sin·cos 曲面，跟教学内容无关。
 *
 * 原则：**宁可少一个功能，不能给一个假的。** 遇到不支持的类型，
 * {@link ThreeViewer} 会渲染诚实的说明卡片，绝不画占位模型糊弄教师。
 */
export const SUPPORTED_SCENE_KINDS: readonly SceneKind[] = ['geometry', 'molecule'] as const;

/**
 * 判断给定场景类型是否被平台真正支持渲染。
 *
 * @param kind 场景类型。
 */
export function isSceneKindSupported(kind: SceneKind | string | undefined | null): boolean {
  return (SUPPORTED_SCENE_KINDS as readonly string[]).includes(String(kind ?? ''));
}

/** 3D 场景类型 → 中文名（用于不支持时的诚实提示）。 */
const SCENE_KIND_LABEL: Record<string, string> = {
  geometry: '几何体',
  molecule: '分子结构',
  function: '函数图像',
  globe: '地球仪',
  circuit: '电路',
  biology: '生物结构',
  physics: '物理装置',
  custom: '自定义模型',
};

export interface ThreeViewerProps {
  /** 结构化 3D 场景描述。 */
  scene: SceneDescriptor;
  /** 画布高度（像素或 CSS 字符串）。 */
  height?: number | string;
  /**
   * 文档正文（用于几何**三重自检**：题干数值 = 推导末步 = 模型标注）。
   * 传空则只做「参数 → 确定性计算 → 覆盖 AI 数值」两层。
   */
  bodyText?: string;
}

/** 可拆解的部件。 */
interface Part {
  /** 物体（Mesh / Group）。 */
  obj: import('three').Object3D;
  /** 原始位置。 */
  base: import('three').Vector3;
  /** 拆解方向（单位向量）。 */
  dir: import('three').Vector3;
  /** 标注文字（可选）。 */
  name?: string;
}

/** 把场景描述构建为 three 部件集合。 */
function buildParts(
  THREE: typeof import('three'),
  desc: SceneDescriptor,
  isMobile: boolean,
): { group: import('three').Group; parts: Part[] } {
  const seg = isMobile ? 18 : 48;
  const group = new THREE.Group();
  const parts: Part[] = [];

  const mat = (color: number): import('three').Material =>
    new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.65 });

  const addPart = (
    obj: import('three').Object3D,
    dir: [number, number, number],
    name?: string,
  ): void => {
    obj.userData.base = obj.position.clone();
    parts.push({ obj, base: obj.position.clone(), dir: new THREE.Vector3(...dir).normalize(), name });
    group.add(obj);
  };

  const params = desc.params as Record<string, unknown>;
  const shape = String(params.shape ?? 'box');

  switch (desc.type) {
    case 'geometry': {
      // ⚠️ 确定性内核：尺寸、几何体、标注全部由 params 算出来，
      //    **不使用 AI 直接给的数值标注**（见 src/utils/geometryKernel.ts）。
      const dims = resolveDims(params, parseShape(params.shape) ?? 'box');
      let geo: import('three').BufferGeometry;
      let maxExtent = 1;
      switch (dims.shape) {
        case 'sphere':
          geo = new THREE.SphereGeometry(dims.r, seg, seg);
          maxExtent = dims.r * 2;
          break;
        case 'cylinder':
          geo = new THREE.CylinderGeometry(dims.r, dims.r, dims.h, seg);
          maxExtent = Math.max(dims.r * 2, dims.h);
          break;
        case 'cone':
          geo = new THREE.ConeGeometry(dims.r, dims.h, seg);
          maxExtent = Math.max(dims.r * 2, dims.h);
          break;
        case 'pyramid':
          // 正四棱锥：ConeGeometry 的 radius 是底面正方形的外接圆半径
          geo = new THREE.ConeGeometry(dims.r, dims.h, 4);
          maxExtent = Math.max(dims.r * 2, dims.h);
          break;
        case 'box':
        default:
          geo = new THREE.BoxGeometry(dims.a, dims.b, dims.c);
          maxExtent = Math.max(dims.a, dims.b, dims.c);
          break;
      }
      const solid = new THREE.Mesh(geo, mat(0x4f7cff));
      addPart(solid, [0, 0, 0]);

      // 可拆解：叠加一个半透明「截面」部件，向上分离以观察内部
      if (desc.explodable) {
        const slabW = maxExtent * 1.06;
        const slabH = Math.max(maxExtent * 0.075, 0.02);
        const section = new THREE.Mesh(
          new THREE.BoxGeometry(slabW, slabH, slabW),
          new THREE.MeshStandardMaterial({ color: 0xff7a59, transparent: true, opacity: 0.85 }),
        );
        section.position.set(0, 0, 0);
        addPart(section, [0, 1, 0]);
      }

      // 统一缩放：保证「标注的数字」与「画出来的比例」一致（不同尺寸视觉大小恒定）
      group.scale.setScalar(3 / (maxExtent || 1));
      break;
    }

    case 'molecule': {
      // 原子配色
      const palette: Record<string, number> = {
        O: 0xff4d4f,
        H: 0xf5f5f5,
        C: 0x333333,
        N: 0x5b8def,
        default: 0x9c6ade,
      };
      const atoms = Array.isArray(params.atoms) ? (params.atoms as Array<Record<string, unknown>>) : [];
      const list =
        atoms.length > 0
          ? atoms
          : // 默认水：O + 2H
            [
              { element: 'O', position: [0, 0, 0] },
              { element: 'H', position: [0.6, 0.5, 0] },
              { element: 'H', position: [-0.6, 0.5, 0] },
            ];
      for (const a of list) {
        const element = String(a.element ?? 'default');
        const [x, y, z] = (a.position as number[]) ?? [0, 0, 0];
        const radius = element === 'H' ? 0.32 : element === 'O' ? 0.5 : 0.45;
        const atom = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, seg), mat(palette[element] ?? palette.default));
        atom.position.set(x, y, z);
        addPart(atom, [x, y, z], element);
      }
      break;
    }

    case 'globe': {
      const earth = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, seg, seg),
        new THREE.MeshStandardMaterial({ color: 0x2b6cb0, metalness: 0.1, roughness: 0.8 }),
      );
      addPart(earth, [0, 0, 0], '地球');

      // 经纬网：用线框环作为可拆解部件
      const rings = 4;
      for (let i = 1; i <= rings; i++) {
        const r = 1.25;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r, 0.012, 8, seg),
          new THREE.MeshBasicMaterial({ color: 0xf6c453 }),
        );
        ring.rotation.x = (Math.PI / (rings + 1)) * i;
        addPart(ring, [0, (i - rings / 2) * 0.4, 0]);
      }
      break;
    }

    case 'function': {
      // y = sin(x)*cos(z) 参数曲面
      const size = 3;
      const g = new THREE.PlaneGeometry(size, size, isMobile ? 24 : 64, isMobile ? 24 : 64);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position as import('three').BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = Math.sin(x * 1.3) * Math.cos(z * 1.3) * 0.6;
        pos.setY(i, y);
      }
      g.computeVertexNormals();
      const surface = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x16a34a, side: 2, flatShading: false }));
      addPart(surface, [0, 0, 0], 'y=sin(x)cos(z)');
      break;
    }

    default: {
      // 通用装配体：中心块 + 数个环绕部件（custom / biology / physics / circuit / 其它）
      const core = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat(0x4f7cff));
      addPart(core, [0, 0, 0], '主体');
      const satellites = Array.isArray(params.satellites)
        ? (params.satellites as number[])
        : [1, 2, 3, 4];
      satellites.slice(0, 6).forEach((_, idx) => {
        const angle = (idx / Math.max(1, satellites.length)) * Math.PI * 2;
        const sat = new THREE.Mesh(new THREE.SphereGeometry(0.4, seg, seg), mat(0xff7a59));
        sat.position.set(Math.cos(angle) * 1.8, 0, Math.sin(angle) * 1.8);
        addPart(sat, [Math.cos(angle), 0, Math.sin(angle)], `部件${idx + 1}`);
      });
      break;
    }
  }

  group.userData.parts = parts;
  return { group, parts };
}

export function ThreeViewer({ scene, height = 420, bodyText = '' }: ThreeViewerProps): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [exploded, setExploded] = useState(false);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 动画循环里读取最新开关值（避免重建场景）
  const explodedRef = useRef(exploded);
  const annotationsRef = useRef(annotationsVisible);
  explodedRef.current = exploded;
  annotationsRef.current = annotationsVisible;

  const heightNum = useMemo(() => (typeof height === 'number' ? height : 420), [height]);

  /** 该场景类型是否**超出平台当前渲染能力**（几何体 / 分子 之外）。 */
  const unsupported = !isSceneKindSupported(scene?.type);
  /** 不支持类型的中文名（用于诚实提示，不让教师以为是自己的操作问题）。 */
  const kindLabel = SCENE_KIND_LABEL[String(scene?.type ?? '')] ?? String(scene?.type ?? '未知类型');

  /**
   * 几何确定性自检（仅 geometry）：标注值一律按 params 重算，
   * 与 AI 原标注 / 正文冲突时剔除该标注——宁缺毋错。
   */
  const geoCheck = useMemo(
    () => (scene?.type === 'geometry' ? checkGeometry(scene, bodyText) : null),
    [scene, bodyText],
  );
  /** 最终展示的标注（geometry 走计算值，molecule 沿用 AI 的部件名）。 */
  const displayAnnotations: readonly string[] = geoCheck
    ? geoCheck.annotations
    : (scene?.annotations ?? []);

  useEffect(() => {
    let disposed = false;
    let cleanup = (): void => {};

    // 不支持的类型：直接跳过 three（747KB）加载，绝不画占位模型糊弄教师。
    if (unsupported) {
      setReady(false);
      return () => {
        disposed = true;
        cleanup();
      };
    }

    void (async () => {
      try {
        const THREE = await import('three');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        if (disposed) return;

        const mount = mountRef.current;
        if (!mount) return;
        const width = mount.clientWidth || 480;
        const isMobile = width < 640;
        const pixelRatio = Math.min(isMobile ? 1 : 2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

        const sceneObj = new THREE.Scene();
        sceneObj.background = new THREE.Color('#f7f9fc');

        const camera = new THREE.PerspectiveCamera(45, width / heightNum, 0.1, 1000);
        camera.position.set(0, 1.8, 6);

        const { group, parts } = buildParts(THREE, scene, isMobile);
        sceneObj.add(group);

        sceneObj.add(new THREE.AmbientLight(0xffffff, 0.9));
        const dir = new THREE.DirectionalLight(0xffffff, 0.7);
        dir.position.set(4, 6, 5);
        sceneObj.add(dir);

        const renderer = new THREE.WebGLRenderer({ antialias: !isMobile });
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, heightNum);
        mount.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.2;
        controls.target.set(0, 0, 0);

        // ---- 标注层（投影到屏幕）----
        const labelsLayer = document.createElement('div');
        labelsLayer.style.position = 'absolute';
        labelsLayer.style.inset = '0';
        labelsLayer.style.pointerEvents = 'none';
        labelsLayer.style.overflow = 'hidden';
        mount.appendChild(labelsLayer);

        const labels: { span: HTMLSpanElement; anchor: import('three').Vector3 }[] = [];
        for (const p of parts) {
          if (!p.name) continue;
          const span = document.createElement('span');
          span.textContent = p.name;
          span.style.position = 'absolute';
          span.style.transform = 'translate(-50%, -50%)';
          span.style.padding = '1px 7px';
          span.style.borderRadius = '999px';
          span.style.fontSize = '12px';
          span.style.fontWeight = '700';
          span.style.color = '#1b1f27';
          span.style.background = 'rgba(255,255,255,0.85)';
          span.style.border = '1px solid rgba(27,31,39,0.12)';
          span.style.whiteSpace = 'nowrap';
          labelsLayer.appendChild(span);
          labels.push({ span, anchor: p.base.clone() });
        }

        const tmp = new THREE.Vector3();
        const updateLabels = (): void => {
          const visible = annotationsRef.current;
          labelsLayer.style.display = visible ? 'block' : 'none';
          if (!visible) return;
          for (const { span, anchor } of labels) {
            tmp.copy(anchor).project(camera);
            const behind = tmp.z > 1;
            if (behind) {
              span.style.display = 'none';
              continue;
            }
            span.style.display = 'block';
            const x = (tmp.x * 0.5 + 0.5) * width;
            const y = (-tmp.y * 0.5 + 0.5) * heightNum;
            span.style.left = `${x}px`;
            span.style.top = `${y}px`;
          }
        };

        const applyExplode = (factor: number): void => {
          for (const p of parts) {
            p.obj.position.copy(p.base).addScaledVector(p.dir, factor);
          }
        };

        let raf = 0;
        const animate = (): void => {
          raf = requestAnimationFrame(animate);
          controls.update();
          applyExplode(explodedRef.current ? 1.1 : 0);
          updateLabels();
          renderer.render(sceneObj, camera);
        };
        animate();
        setReady(true);

        const onResize = (): void => {
          const w = mount.clientWidth || 480;
          camera.aspect = w / heightNum;
          camera.updateProjectionMatrix();
          renderer.setSize(w, heightNum);
        };
        window.addEventListener('resize', onResize);

        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
          controls.dispose();
          renderer.dispose();
          if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
          if (labelsLayer.parentNode === mount) mount.removeChild(labelsLayer);
        };
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : '3D 渲染初始化失败');
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
    // 仅在场景描述或尺寸变化时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, heightNum, unsupported]);

  // ---- 不支持的 3D 类型：诚实说明，不渲染假模型 ----
  if (unsupported) {
    return (
      <Box
        sx={{
          border: '1px dashed',
          borderColor: 'warning.main',
          bgcolor: '#FFF8E6',
          borderRadius: 3,
          px: 2.5,
          py: 2,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
          <InfoOutlinedIcon sx={{ fontSize: 18, color: '#9A6B00' }} aria-hidden="true" />
          <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#9A6B00' }}>
            本节 3D（{kindLabel}）暂未支持，已为你保留完整文字讲解
          </Typography>
        </Stack>
        <Typography sx={{ fontSize: 13.5, color: '#6B4E00', lineHeight: 1.75 }}>
          平台的 3D 课件目前只支持<b>「几何体」</b>与<b>「分子结构」</b>两类真模型。
          为了避免给一个跟课堂内容无关的空壳模型，这里不显示 3D。
          <br />
          上方可照常使用文字讲解备课；如需 3D，可换成立体图形或分子相关课题重新生成。
        </Typography>
        {scene?.annotations && scene.annotations.length > 0 ? (
          <Box sx={{ mt: 1.25 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#6B4E00', mb: 0.5 }}>
              本节 3D 想说明的要点（供你口述或画在黑板上）：
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {scene.annotations.map((a, i) => (
                <li key={`anno-${i}`}>
                  <Typography sx={{ fontSize: 13, color: '#6B4E00' }}>{a}</Typography>
                </li>
              ))}
            </Box>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box>
      {/* ---- 几何确定性保障：让老师知道有这层校正，而不是被静默改掉 ---- */}
      {geoCheck?.degradedReason ? (
        <Box
          sx={{
            mb: 1,
            px: 1.5,
            py: 1,
            borderRadius: 2,
            border: '1px dashed',
            borderColor: 'warning.main',
            bgcolor: '#FFF8E6',
          }}
        >
          <Typography sx={{ fontSize: 13, color: '#6B4E00' }}>⚠ {geoCheck.degradedReason}</Typography>
        </Box>
      ) : null}
      {geoCheck?.corrected ? (
        <Box
          sx={{
            mb: 1,
            px: 1.5,
            py: 1,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'info.main',
            bgcolor: 'rgba(47,107,255,0.06)',
          }}
        >
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'primary.main' }}>
            标注已按几何关系自动校正
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25, lineHeight: 1.7 }}>
            模型上的数值由平台按几何公式重新计算，不采用 AI 直接给出的数值。
            {geoCheck.droppedAiAnnotations.length > 0
              ? `已剔除 ${geoCheck.droppedAiAnnotations.length} 条与计算结果不一致的原标注。`
              : ''}
            {geoCheck.droppedByBody.length > 0
              ? `另有 ${geoCheck.droppedByBody.length} 个量与正文数值不一致，已不予展示。`
              : ''}
          </Typography>
        </Box>
      ) : null}
      <Box
        ref={mountRef}
        sx={{
          position: 'relative',
          width: '100%',
          height: heightNum,
          borderRadius: 3,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#f7f9fc',
        }}
      >
        {!ready && !error ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
              fontSize: 14,
            }}
          >
            正在加载 3D 模型…
          </Box>
        ) : null}
        {error ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'error.main',
              fontSize: 13,
              px: 2,
              textAlign: 'center',
            }}
          >
            {error}（可改用「课件 2D」或「教案」形式）
          </Box>
        ) : null}
      </Box>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
        <FormControlLabel
          control={<Switch size="small" checked={exploded} onChange={(e) => setExploded(e.target.checked)} />}
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LayersIcon sx={{ fontSize: 16 }} aria-hidden="true" />
              <Typography sx={{ fontSize: 13 }}>拆解</Typography>
            </Box>
          }
        />
        <FormControlLabel
          control={
            <Switch size="small" checked={annotationsVisible} onChange={(e) => setAnnotationsVisible(e.target.checked)} />
          }
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LabelIcon sx={{ fontSize: 16 }} aria-hidden="true" />
              <Typography sx={{ fontSize: 13 }}>标注</Typography>
            </Box>
          }
        />
        <Typography sx={{ fontSize: 12, color: 'text.disabled', ml: 'auto' }}>
          拖拽旋转 · 滚轮缩放
        </Typography>
      </Stack>

      {/* ---- 数值标注列表（geometry 时全部来自确定性计算）---- */}
      {displayAnnotations.length > 0 ? (
        <Box sx={{ mt: 1.25 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
            {geoCheck
              ? `${GEO_SHAPE_LABEL[geoCheck.shape]}·数值标注（按几何公式计算）`
              : '部件标注'}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {displayAnnotations.map((a, i) => (
              <li key={`geo-anno-${i}`}>
                <Typography
                  sx={{
                    fontSize: 13.5,
                    lineHeight: 1.8,
                    color: 'text.primary',
                    fontFamily: geoCheck ? 'ui-monospace, Menlo, Consolas, monospace' : 'inherit',
                  }}
                >
                  {a}
                </Typography>
              </li>
            ))}
          </Box>
          {geoCheck && !geoCheck.dims.fromParams ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              （AI 未给出尺寸参数，以上按单位尺寸计算；如需具体数值，请在生成需求里写明，如「底面半径 3、高 5 的圆柱」）
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export default ThreeViewer;
