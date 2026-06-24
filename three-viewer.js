/**
 * Three.js 3D 可视化引擎 v2
 * 优化：单 rAF 循环 / 共享 Geometry+Material / 摄像机预设 / ResizeObserver / 大规模标签精简
 * 依赖: importmap 加载 three 和 OrbitControls
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

// ═══════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════

const MORANDI_COLORS = [
  0xB8A89A, 0x9C8B7D, 0xA8B6B1, 0xD4C5B9, 0xE8DFD5,
  0xC4B5A5, 0x8FA39B, 0xBEAD98, 0xA9AFA9, 0xD9CDBB,
  0xB0AEA3, 0xC7BBB0, 0x99A8A0, 0xCCBFB0, 0xDBD0C2
];

const CONTAINER_COLORS = {
  standard: 0x6B9080,
  openTop: 0x7B9E8F,
  flatRack: 0x8B7D6B
};

const SCALE = 1;
const SPRITE_LABEL_THRESHOLD = 50; // 超过此数量只给特殊件打标签

// 摄像机预设
const CAMERA_PRESETS = {
  isometric: { pos: [1, 0.8, 1], target: [0, 0, 0], label: '等距' },
  top:       { pos: [0, 1, 0.001], target: [0, 0, 0], label: '俯视' },
  front:     { pos: [0, 0, 1], target: [0, 0, 0], label: '正视' },
  side:      { pos: [1, 0, 0], target: [0, 0, 0], label: '侧视' }
};

// ═══════════════════════════════════════════
// 全局状态
// ═══════════════════════════════════════════

let scenes = {};
let renderers = {};
let cameras = {};
let controls = {};
let activeCanvasId = null;
let rAFId = null;
let parentEl = null;         // 3D 容器 DOM
let resizeObserver = null;
let allCanvases = [];
let geoCache = null;         // { key → { boxGeo, edgeGeo, material, edgeMaterial } }
let disposed = false;        // 全局 disposed 标记，防止延迟 rAF 继续调度
let raycaster = null;        // 悬停检测
let mouseNDC = null;         // 鼠标归一化坐标
let tooltipEl = null;        // tooltip DOM 元素
let cargoMeshes = [];        // 所有 cargo mesh 平铺引用（用于 raycasting）
let canvasEls = [];          // 所有 canvas DOM 元素（用于 event listener 清理）

// ═══════════════════════════════════════════
// 资源清理
// ═══════════════════════════════════════════

function disposeAll() {
  disposed = true;
  if (rAFId != null) { cancelAnimationFrame(rAFId); rAFId = null; }

  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }

  for (const renderer of Object.values(renderers)) {
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
  }
  renderers = {};

  for (const ctrl of Object.values(controls)) {
    ctrl.dispose();
  }
  controls = {};

  // 收集缓存中的共享资源，避免 scene.traverse 重复释放
  const cachedGeos = new Set();
  const cachedMats = new Set();
  if (geoCache) {
    for (const entry of Object.values(geoCache)) {
      cachedGeos.add(entry.boxGeo);
      cachedGeos.add(entry.edgeGeo);
      cachedMats.add(entry.material);
      cachedMats.add(entry.edgeMaterial);
    }
  }

  for (const scene of Object.values(scenes)) {
    scene.traverse((obj) => {
      if (obj.geometry && !cachedGeos.has(obj.geometry)) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => { if (!cachedMats.has(m)) m.dispose(); });
        } else if (!cachedMats.has(obj.material)) {
          obj.material.dispose();
        }
      }
    });
  }

  // 最后释放缓存
  if (geoCache) {
    for (const entry of Object.values(geoCache)) {
      entry.boxGeo.dispose();
      entry.edgeGeo.dispose();
      entry.material.dispose();
      entry.edgeMaterial.dispose();
    }
    geoCache = null;
  }
  scenes = {};
  cameras = {};
  activeCanvasId = null;
  allCanvases = [];
  parentEl = null;

  // 清理 tooltip 和悬停事件
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
  raycaster = null;
  mouseNDC = null;
  cargoMeshes = [];
  for (const canvas of canvasEls) {
    canvas.removeEventListener('mousemove', onCanvasMouseMove);
    canvas.removeEventListener('mouseleave', () => {});
  }
  canvasEls = [];
}

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

function init(canvasContainerId) {
  disposeAll();
  disposed = false;
  parentEl = document.getElementById(canvasContainerId);
  if (!parentEl) return;
  parentEl.innerHTML = '';
}

// ═══════════════════════════════════════════
// 集装箱渲染
// ═══════════════════════════════════════════

function validateContainerSpec(spec) {
  if (!spec) return 'containerSpec 为空';
  const { L, W, H } = spec;
  if (!Number.isFinite(L) || L <= 0) return `L 无效: ${L}`;
  if (!Number.isFinite(W) || W <= 0) return `W 无效: ${W}`;
  if (!Number.isFinite(H) || H <= 0) return `H 无效: ${H}`;
  return null;
}

function createContainerScene(index, containerSpec) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f0eb);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 15, 10);
  scene.add(dirLight);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dirLight2.position.set(-5, 5, -5);
  scene.add(dirLight2);

  const containerGroup = new THREE.Group();
  containerGroup.name = 'container';
  scene.add(containerGroup);

  renderContainerBox(containerGroup, containerSpec);
  scenes[index] = scene;
  return scene;
}

function renderContainerBox(group, containerSpec) {
  const err = validateContainerSpec(containerSpec);
  if (err) throw new Error(`集装箱规格验证失败: ${err}`);
  const { L, W, H, type } = containerSpec;
  const color = CONTAINER_COLORS[type] || 0x6B9080;

  const boxGeo = new THREE.BoxGeometry(L * SCALE, H * SCALE, W * SCALE);
  const edges = new THREE.EdgesGeometry(boxGeo);
  const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: true, opacity: 0.6 });
  group.add(new THREE.LineSegments(edges, lineMat));

  const faceMat = new THREE.MeshPhongMaterial({
    color, transparent: true, opacity: 0.08,
    side: THREE.DoubleSide, depthWrite: false
  });

  if (type === 'openTop') {
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(L * SCALE, W * SCALE), faceMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(0, -H * SCALE / 2, 0);
    group.add(bottom);
    addWalls(group, L, W, H, faceMat, false);
  } else if (type === 'flatRack') {
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(L * SCALE, W * SCALE), faceMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(0, -H * SCALE / 2, 0);
    group.add(bottom);
    const pillarGeo = new THREE.BoxGeometry(0.1, H * SCALE, W * SCALE);
    const pillarMat = new THREE.MeshPhongMaterial({ color: 0x8B7355, transparent: true, opacity: 0.4 });
    const p1 = new THREE.Mesh(pillarGeo, pillarMat);
    p1.position.set(-L * SCALE / 2, 0, 0);
    group.add(p1);
    const p2 = new THREE.Mesh(pillarGeo, pillarMat);
    p2.position.set(L * SCALE / 2, 0, 0);
    group.add(p2);
  } else {
    const box = new THREE.Mesh(boxGeo, new THREE.MeshPhongMaterial({
      color, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false
    }));
    group.add(box);
  }

  const gridHelper = new THREE.GridHelper(Math.max(L, W) * 1.5, 20, 0xcccccc, 0xe0e0e0);
  gridHelper.position.y = -H * SCALE / 2 - 0.01;
  group.add(gridHelper);

  const originMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshPhongMaterial({ color: 0xff4444 })
  );
  originMarker.position.set(-L * SCALE / 2, -H * SCALE / 2, -W * SCALE / 2);
  group.add(originMarker);

  // FR 无门约束，跳过门标记；其他箱型标记箱门位置
  if (containerSpec.type !== 'flatRack') {
    const doorH = Math.min(containerSpec.doorH !== Infinity ? containerSpec.doorH : H, H);
    const doorMarker = new THREE.Mesh(
      new THREE.BoxGeometry(L * SCALE * 0.02, doorH * SCALE, (containerSpec.doorW !== Infinity ? containerSpec.doorW : W) * SCALE),
      new THREE.MeshPhongMaterial({ color: 0xffcc00, transparent: true, opacity: 0.3 })
    );
    doorMarker.position.set(L * SCALE / 2, 0, 0);
    group.add(doorMarker);
  }
}

function addWalls(group, L, W, H, mat, includeTop) {
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -H / 2;
  group.add(bottom);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat);
  left.position.set(0, 0, -W / 2);
  group.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat);
  right.position.set(0, 0, W / 2);
  group.add(right);

  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  front.rotation.y = Math.PI / 2;
  front.position.set(-L / 2, 0, 0);
  group.add(front);

  if (includeTop) {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = H / 2;
    group.add(top);
  }
}

// ═══════════════════════════════════════════
// 共享几何体缓存
// ═══════════════════════════════════════════

function getOrCreateGeo(l, w, h, color) {
  if (!geoCache) geoCache = {};

  const key = `${l.toFixed(4)}_${w.toFixed(4)}_${h.toFixed(4)}_${color.toString(16)}`;
  if (geoCache[key]) return geoCache[key];

  const boxGeo = new THREE.BoxGeometry(l * SCALE, h * SCALE, w * SCALE);
  const edgeGeo = new THREE.EdgesGeometry(boxGeo);
  const material = new THREE.MeshPhongMaterial({
    color, transparent: true, opacity: 0.85,
    specular: 0x222222, shininess: 30
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 });

  const entry = { boxGeo, edgeGeo, material, edgeMaterial };
  geoCache[key] = entry;
  return entry;
}

// ═══════════════════════════════════════════
// 标签 Sprite
// ═══════════════════════════════════════════

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createLabelSprite(text, bgColor = 'rgba(255,255,255,0.85)', textColor = '#3C3A36') {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 48;
  ctx.font = `bold ${fontSize}px "SF Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(text);
  const padding = 16;
  const width = metrics.width + padding * 2;
  const height = fontSize + padding;
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = bgColor;
  roundRect(ctx, 0, 0, width, height, 12);
  ctx.fill();

  ctx.fillStyle = textColor;
  ctx.font = `bold ${fontSize}px "SF Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width / 80, height / 80, 1);
  return sprite;
}

// ═══════════════════════════════════════════
// 货物渲染（共享几何体 + 条件标签）
// ═══════════════════════════════════════════

function renderCargo(group, placedItems, containerSpec, containerIndex = 0) {
  console.log(`[3D Diag] renderCargo 入口: 箱${containerIndex + 1}, placedItems.length=${placedItems.length}`);

  const modelColors = {};
  let colorIdx = 0;
  const totalCount = placedItems.length;
  const usePerItemLabel = totalCount <= SPRITE_LABEL_THRESHOLD;
  let renderedCount = 0;
  let skippedCount = 0;

  for (let idx = 0; idx < placedItems.length; idx++) {
    const item = placedItems[idx];

    try {
      // 数据完整性校验
      if (!item || typeof item !== 'object') {
        console.warn(`[3D Diag] ⚠️ 箱${containerIndex + 1} item[${idx}] 无效:`, item);
        skippedCount++;
        continue;
      }

      const l = item.l, w = item.w, h = item.h;
      const x = item.x, y = item.y, z = item.z;
      const stackable = item.stackable;
      const model = item.model;

      // 数值有效性检查
      if (![l, w, h, x, y, z].every(v => Number.isFinite(v))) {
        console.warn(`[3D Diag] ⚠️ 箱${containerIndex + 1} item[${idx}] (${model}) 含无效坐标: l=${l}, w=${w}, h=${h}, x=${x}, y=${y}, z=${z}`);
        skippedCount++;
        continue;
      }

      // 尺寸合理性检查（单件货物超过 100m 视为异常数据）
      if (l > 100 || w > 100 || h > 100) {
        console.error(`[3D Diag] ❌ 箱${containerIndex + 1} item[${idx}] (${model}) 尺寸异常: ${l}×${w}×${h}`);
        skippedCount++;
        continue;
      }

      // 优先使用 packing engine 分配的 colorIndex（手动录入时保持录入顺序颜色），
      // 其次按 model 分组分配
      let color;
      if (Number.isFinite(item.colorIndex)) {
        color = MORANDI_COLORS[item.colorIndex % MORANDI_COLORS.length];
      } else {
        if (!modelColors[model]) {
          modelColors[model] = MORANDI_COLORS[colorIdx % MORANDI_COLORS.length];
          colorIdx++;
        }
        color = modelColors[model];
      }

      // Three.js 坐标转换
      const cx = x * SCALE - containerSpec.L * SCALE / 2 + l * SCALE / 2;
      const cy = z * SCALE - containerSpec.H * SCALE / 2 + h * SCALE / 2;
      const cz = y * SCALE - containerSpec.W * SCALE / 2 + w * SCALE / 2;

      // 共享几何体
      const shared = getOrCreateGeo(l, w, h, color);
      const mesh = new THREE.Mesh(shared.boxGeo, shared.material);
      mesh.position.set(cx, cy, cz);
      mesh.userData = { model, l, w, h, weight: item.weight, x, y, z, stackable, rotated: false, overSize: false };
      cargoMeshes.push(mesh);
      group.add(mesh);

      // 共享线框
      const edgeLine = new THREE.LineSegments(shared.edgeGeo, shared.edgeMaterial);
      edgeLine.position.copy(mesh.position);
      group.add(edgeLine);

      // 不可叠放标记
      if (!stackable) {
        const topGeo = new THREE.PlaneGeometry(l * SCALE, w * SCALE);
        const topMesh = new THREE.Mesh(topGeo,
          new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        topMesh.rotation.x = -Math.PI / 2;
        topMesh.position.set(cx, cy + h * SCALE / 2 + 0.005, cz);
        group.add(topMesh);
      }

      // 异常检测
      const origDims = [item.origL, item.origW, item.origH].filter(Boolean);
      const isRotated = origDims.length === 3 && (
        origDims[0] !== l || origDims[1] !== w || origDims[2] !== h
      );
      const isOverLength = l > containerSpec.L + 0.01;
      const isOverWidth = w > containerSpec.W + 0.01;
      const isOverHeight = h > containerSpec.H + 0.01;
      const isOverSize = isOverLength || isOverWidth || isOverHeight;
      const isAbnormal = isOverSize || isRotated || !stackable;

      if (isAbnormal) {
        // 更新 mesh.userData 供 tooltip 使用
        mesh.userData.rotated = isRotated;
        mesh.userData.overSize = isOverSize;

        const labels = [];
        if (isOverLength) labels.push(`超长${(l - containerSpec.L).toFixed(2)}m`);
        if (isOverWidth) labels.push(`超宽${(w - containerSpec.W).toFixed(2)}m`);
        if (isOverHeight) labels.push(`超高${(h - containerSpec.H).toFixed(2)}m`);
        if (isRotated) labels.push('旋转');
        if (!stackable) labels.push('禁叠');

        const markerColor = isOverSize ? (containerSpec.type === 'flatRack' ? 0xE8A838 : 0xff0000) : 0xff8800;
        const markerOpacity = isOverSize ? (containerSpec.type === 'flatRack' ? 0.75 : 0.6) : 0.6;
        const extBox = new THREE.BoxGeometry(l * SCALE, h * SCALE, w * SCALE);
        const extLine = new THREE.LineSegments(
          new THREE.EdgesGeometry(extBox),
          new THREE.LineBasicMaterial({ color: markerColor, transparent: true, opacity: markerOpacity })
        );
        extLine.position.copy(mesh.position);
        group.add(extLine);

        const labelBg = isOverSize ? (containerSpec.type === 'flatRack' ? '#D4A843' : '#C97B7B') : '#B8885A';
        const markerLabel = createLabelSprite(labels.join(' '), 'rgba(255,255,255,0.9)', labelBg);
        markerLabel.position.set(cx, cy + h * SCALE / 2 + 0.25, cz);
        group.add(markerLabel);
      }

      // 序号标签：小规模全打，大规模只给异常件
      if (usePerItemLabel || isAbnormal) {
        const seq = item.id || item.sequence || model;
        const label = createLabelSprite(String(seq), 'rgba(245,240,235,0.9)', '#3C3A36');
        label.position.set(cx, cy - h * SCALE / 2 - 0.15, cz);
        group.add(label);
      }

      renderedCount++;

    } catch (itemErr) {
      console.error(`[3D Diag] ❌ 箱${containerIndex + 1} item[${idx}] (${item?.model}) 渲染异常:`, itemErr);
      skippedCount++;
    }
  }

  console.log(`[3D Diag] renderCargo 完成: 箱${containerIndex + 1}, 总数=${totalCount}, 渲染=${renderedCount}, 跳过=${skippedCount}`);
}

// ═══════════════════════════════════════════
// 相机 & 渲染器
// ═══════════════════════════════════════════

function setupCameraRenderer(scene, canvasId, containerSpec) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 600;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  renderers[canvasId] = renderer;

  const diagonal = Math.sqrt(
    containerSpec.L * containerSpec.L + containerSpec.W * containerSpec.W + containerSpec.H * containerSpec.H
  );
  const dist = diagonal * 0.9;
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, dist * 4);
  camera.position.set(dist * 0.7, dist * 0.55, dist * 0.7);
  camera.lookAt(0, 0, 0);
  cameras[canvasId] = camera;

  const ctrl = new OrbitControls(camera, renderer.domElement);
  ctrl.enableDamping = true;
  ctrl.dampingFactor = 0.08;
  ctrl.target.set(0, 0, 0);
  ctrl.update();
  controls[canvasId] = ctrl;

  return { renderer, camera };
}

// ═══════════════════════════════════════════
// 单 rAF 循环 — 仅渲染当前活跃场景
// ═══════════════════════════════════════════

function startAnimation() {
  if (rAFId != null) return; // 已在运行

  function animate() {
    if (disposed) return;
    rAFId = requestAnimationFrame(animate);
    if (document.hidden) return;
    if (!activeCanvasId) return;

    const ctrl = controls[activeCanvasId];
    const renderer = renderers[activeCanvasId];
    const camera = cameras[activeCanvasId];
    const scene = scenes[activeCanvasId];
    if (ctrl && renderer && camera && scene) {
      ctrl.update();
      renderer.render(scene, camera);
    }
  }
  rAFId = requestAnimationFrame(animate);
}

function stopAnimation() {
  if (rAFId != null) { cancelAnimationFrame(rAFId); rAFId = null; }
}

/**
 * 切换到指定容器索引的 3D 视图
 */
function showContainer(index) {
  const target = allCanvases[index];
  if (!target) return;

  allCanvases.forEach(c => { c.wrapper.style.display = 'none'; });
  target.wrapper.style.display = 'block';

  // 切换活跃 scene
  activeCanvasId = target.canvasId;

  // resize 到最新尺寸
  const canvas = document.getElementById(target.canvasId);
  if (canvas) {
    const renderer = renderers[target.canvasId];
    const camera = cameras[target.canvasId];
    if (renderer && camera) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  // 确保 rAF 在跑
  startAnimation();
}

// ═══════════════════════════════════════════
// ResizeObserver
// ═══════════════════════════════════════════

function setupResizeObserver() {
  if (!parentEl) return;
  if (resizeObserver) resizeObserver.disconnect();

  resizeObserver = new ResizeObserver(() => {
    if (!activeCanvasId) return;
    const canvas = document.getElementById(activeCanvasId);
    const renderer = renderers[activeCanvasId];
    const camera = cameras[activeCanvasId];
    if (!canvas || !renderer || !camera) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  resizeObserver.observe(parentEl);
}

// ═══════════════════════════════════════════
// 摄像机预设视角（带平滑动画）
// ═══════════════════════════════════════════

function animateCameraTo(camera, ctrl, targetPos, targetLookAt, duration = 600) {
  const startPos = camera.position.clone();
  const startTarget = ctrl.target.clone();
  const endPos = new THREE.Vector3(...targetPos);
  const endTarget = new THREE.Vector3(...targetLookAt);
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1.0);
    // easeInOutCubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(startPos, endPos, ease);
    ctrl.target.lerpVectors(startTarget, endTarget, ease);
    ctrl.update();

    if (t < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function applyCameraPreset(presetName) {
  if (!activeCanvasId) return;
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  const camera = cameras[activeCanvasId];
  const ctrl = controls[activeCanvasId];
  if (!camera || !ctrl) return;

  // 基于集装箱尺寸计算实际位置（对角线为基准）
  const scene = scenes[activeCanvasId];
  if (!scene) return;
  const containerGroup = scene.getObjectByName('container');
  let diagonal = 5; // fallback
  if (containerGroup && containerGroup.userData && containerGroup.userData.diagonal) {
    diagonal = containerGroup.userData.diagonal;
  }

  const dist = diagonal * 0.85;
  const [rx, ry, rz] = preset.pos;
  const targetPos = new THREE.Vector3(rx * dist, ry * dist, rz * dist);
  const targetLookAt = new THREE.Vector3(...preset.target);

  animateCameraTo(camera, ctrl,
    [targetPos.x, targetPos.y, targetPos.z],
    [targetLookAt.x, targetLookAt.y, targetLookAt.z]
  );
}

/**
 * 创建预设视角按钮栏
 */
function createPresetButtons() {
  if (!parentEl) return;

  // 移除旧按钮
  const oldBar = parentEl.querySelector('.three-preset-bar');
  if (oldBar) oldBar.remove();

  const bar = document.createElement('div');
  bar.className = 'three-preset-bar';
  bar.style.cssText = 'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:4px;z-index:10;';

  for (const [name, preset] of Object.entries(CAMERA_PRESETS)) {
    const btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.style.cssText = 'padding:4px 10px;border:1px solid #D4C5B9;border-radius:8px;background:rgba(255,255,255,0.75);backdrop-filter:blur(6px);color:#555;font-size:11px;cursor:pointer;transition:all 0.2s;';
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(143,163,155,0.5)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.75)'; });
    btn.addEventListener('click', () => applyCameraPreset(name));
    bar.appendChild(btn);
  }

  parentEl.appendChild(bar);
}

// ═══════════════════════════════════════════
// 截图
// ═══════════════════════════════════════════

function captureScreenshot(canvasId) {
  const renderer = renderers[canvasId];
  if (!renderer) return null;
  const scene = scenes[canvasId];
  const camera = cameras[canvasId];
  if (scene && camera) {
    try { renderer.render(scene, camera); } catch (err) {
      console.warn(`[captureScreenshot] render fail ${canvasId}:`, err);
      return null;
    }
  }
  return renderer.domElement.toDataURL('image/png');
}

function captureScreenshotFixed(canvasId, targetWidth = 800, targetHeight = 600) {
  const renderer = renderers[canvasId];
  if (!renderer) return null;
  const scene = scenes[canvasId];
  const camera = cameras[canvasId];
  if (!scene || !camera) return null;

  const originalSize = renderer.getSize(new THREE.Vector2());
  const originalAspect = camera.aspect;

  renderer.setSize(targetWidth, targetHeight);
  camera.aspect = targetWidth / targetHeight;
  camera.updateProjectionMatrix();

  let dataUrl = null;
  try {
    renderer.render(scene, camera);
    dataUrl = renderer.domElement.toDataURL('image/png');
  } catch (err) {
    console.warn(`[captureScreenshotFixed] render fail ${canvasId}:`, err);
  }

  renderer.setSize(originalSize.x, originalSize.y);
  camera.aspect = originalAspect;
  camera.updateProjectionMatrix();
  if (scene && camera) {
    try { renderer.render(scene, camera); } catch (err) { /* ignore */ }
  }
  return dataUrl;
}

// ═══════════════════════════════════════════
// 悬停 Tooltip 交互
// ═══════════════════════════════════════════

function onCanvasMouseMove(e) {
  if (!raycaster || !mouseNDC || !tooltipEl || !activeCanvasId) return;

  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  const camera = cameras[activeCanvasId];
  if (!camera) return;

  raycaster.setFromCamera(mouseNDC, camera);
  const intersects = raycaster.intersectObjects(cargoMeshes, false);

  if (intersects.length > 0) {
    const obj = intersects[0].object;
    const data = obj.userData;
    if (data && data.model) {
      const lines = [
        `<strong>${escapeHtml(data.model)}</strong>`,
        `尺寸: ${data.l.toFixed(2)}×${data.w.toFixed(2)}×${data.h.toFixed(2)} m`,
        `重量: ${data.weight.toFixed(1)} kg`,
        `位置: (${data.x.toFixed(2)}, ${data.y.toFixed(2)}, ${data.z.toFixed(2)})`,
        data.rotated ? '⚠️ 已旋转' : '',
        !data.stackable ? '🚫 不可叠放' : '',
        data.overSize ? '⚠️ 超限' : ''
      ].filter(Boolean).join('<br>');

      tooltipEl.innerHTML = lines;
      tooltipEl.style.display = 'block';
      // 定位：canvas 内坐标
      const parentRect = parentEl ? parentEl.getBoundingClientRect() : rect;
      const x = e.clientX - parentRect.left + 12;
      const y = e.clientY - parentRect.top - 12;
      tooltipEl.style.left = x + 'px';
      tooltipEl.style.top = y + 'px';
    } else {
      tooltipEl.style.display = 'none';
    }
  } else {
    tooltipEl.style.display = 'none';
  }
}

function escapeHtml(str) {
  const el = document.createElement('div');
  el.textContent = String(str);
  return el.innerHTML;
}

// ═══════════════════════════════════════════
// 构建完整可视化
// ═══════════════════════════════════════════

function buildVisualization(result, parentId) {
  const parent = document.getElementById(parentId);
  if (!parent) return;

  if (!result || !result.containers || !Array.isArray(result.containers)) {
    console.warn('[buildVisualization] result 无效:', result);
    return;
  }

  // ═══ 诊断日志：输入数据快照 ═══
  console.log('[3D Diag] === buildVisualization 入口 ===');
  console.log('[3D Diag] containers.length:', result.containers.length);
  console.log('[3D Diag] containerCount (result):', result.containerCount);
  console.log('[3D Diag] totalPlaced (result):', result.totalPlaced);
  let totalPlacedInContainers = 0;
  for (let ci = 0; ci < result.containers.length; ci++) {
    const cc = result.containers[ci];
    const itemCount = cc.placedItems ? cc.placedItems.length : 0;
    totalPlacedInContainers += itemCount;
    console.log(`[3D Dig]   箱${ci + 1}: code=${cc.containerCode}, items=${itemCount}, utilization=${cc.utilization}, weight=${cc.totalWeight}`);
  }
  console.log('[3D Diag] containers 内 placedItems 总数:', totalPlacedInContainers);
  if (totalPlacedInContainers !== result.totalPlaced) {
    console.error(`[3D Diag] ⚠️ 数据不一致！result.totalPlaced=${result.totalPlaced} 但 containers 内实际 ${totalPlacedInContainers} 件`);
  }
  // ═══ 诊断日志结束 ═══

  disposeAll();
  disposed = false;
  parentEl = parent;
  parent.innerHTML = '';
  geoCache = {};
  allCanvases = [];

  for (let i = 0; i < result.containers.length; i++) {
    const c = result.containers[i];

    // 安全获取 containerSpec，支持大小写不敏感 + trim + 默认兜底（绝不跳过）
    let containerSpec = null;
    const rawCode = (c.containerCode || '').trim();
    if (window.ContainerDB?.CONTAINER_DB) {
      // 精确匹配
      containerSpec = window.ContainerDB.CONTAINER_DB[rawCode];
      if (!containerSpec) {
        // 大小写不敏感匹配
        const lowerCode = rawCode.toLowerCase();
        const allKeys = Object.keys(window.ContainerDB.CONTAINER_DB);
        const fuzzyKey = allKeys.find(k => k.toLowerCase() === lowerCode);
        if (fuzzyKey) {
          console.warn(`[3D Diag] 🔧 箱${i + 1}: "${rawCode}" 模糊匹配到 "${fuzzyKey}"`);
          containerSpec = window.ContainerDB.CONTAINER_DB[fuzzyKey];
          c.containerCode = fuzzyKey;
        }
      }
    }
    if (!containerSpec) {
      console.error(`[3D Diag] ❌ 箱${i + 1}: containerCode="${c.containerCode}" 在 CONTAINER_DB 中未找到。可用 keys:`,
        Object.keys(window.ContainerDB?.CONTAINER_DB || {}));
      // 不跳过！使用默认规格渲染，确保3D场景不丢失
      containerSpec = { L: 12, W: 2.4, H: 2.6, code: c.containerCode || 'UNKNOWN', nameCN: '未知箱型', type: 'standard', payload: 28000 };
      console.warn(`[3D Diag] 🔧 箱${i + 1}: 使用默认规格 ${containerSpec.L}×${containerSpec.W}×${containerSpec.H}`);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'three-container';
    wrapper.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;';
    wrapper.dataset.containerIndex = i;

    const canvas = document.createElement('canvas');
    canvas.id = `three-canvas-${i}`;
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    wrapper.appendChild(canvas);
    parent.appendChild(wrapper);

    // 信息标签（增加货物计数）
    const info = document.createElement('div');
    info.className = 'three-info';
    const isFR = c.containerCode && c.containerCode.includes('FR');
    const eff = isFR && c.spaceEfficiency != null
      ? `${(c.spaceEfficiency * 100).toFixed(1)}%`
      : `${(c.utilization != null ? (c.utilization * 100).toFixed(1) : 'N/A')}%`;
    info.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(255,255,255,0.85);backdrop-filter:blur(6px);padding:4px 10px;border-radius:6px;font-size:11px;color:#666;pointer-events:none;';
    info.textContent = `箱${i + 1} | ${c.containerCode} | ${eff} | ${(c.totalWeight || 0).toFixed(0)}kg | ${(c.placedItems || []).length}件`;
    wrapper.appendChild(info);

    allCanvases.push({ wrapper, canvasId: canvas.id, index: i });

    // 场景
    const scene = createContainerScene(canvas.id, containerSpec);

    // 存储对角线长度供预设视角使用
    const diagonal = Math.sqrt(
      containerSpec.L * containerSpec.L + containerSpec.W * containerSpec.W + containerSpec.H * containerSpec.H
    );
    const containerGroup = scene.getObjectByName('container');
    if (containerGroup) {
      containerGroup.userData = { diagonal };
      renderCargo(containerGroup, c.placedItems || [], containerSpec, i);
    } else {
      console.error(`[3D Diag] ❌ 箱${i + 1}: containerGroup 未创建！`);
    }

    setupCameraRenderer(scene, canvas.id, containerSpec);
  }

  // 显示第一个
  if (allCanvases.length > 0) {
    activeCanvasId = allCanvases[0].canvasId;
    allCanvases[0].wrapper.style.display = 'block';
  }

  // 创建 tooltip DOM
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'three-tooltip';
    tooltipEl.style.cssText = 'position:absolute;display:none;' +
      'background:rgba(60,58,54,0.92);color:#F5F0EB;padding:8px 12px;' +
      'border-radius:8px;font-size:11px;line-height:1.5;' +
      'pointer-events:none;z-index:9999;white-space:nowrap;' +
      'backdrop-filter:blur(4px);border:1px solid rgba(184,168,154,0.3);';
    parent.appendChild(tooltipEl);
  }

  // 绑定 mouse move 事件到所有 canvas
  raycaster = new THREE.Raycaster();
  mouseNDC = new THREE.Vector2();
  canvasEls = [];

  allCanvases.forEach(ac => {
    const canvas = ac.wrapper.querySelector('canvas');
    if (!canvas) return;
    canvasEls.push(canvas);
    canvas.addEventListener('mousemove', onCanvasMouseMove, { passive: true });
    canvas.addEventListener('mouseleave', () => {
      if (tooltipEl) tooltipEl.style.display = 'none';
    });
  });

  // 启动单 rAF + ResizeObserver
  startAnimation();
  setupResizeObserver();
  createPresetButtons();

  return {
    containerCount: result.containers.length,
    canvases: allCanvases,
    showContainer,
    getScreenshot(index) {
      if (allCanvases[index]) return captureScreenshot(allCanvases[index].canvasId);
      return null;
    },
    getScreenshotFixed(index, width = 800, height = 600) {
      if (allCanvases[index]) return captureScreenshotFixed(allCanvases[index].canvasId, width, height);
      return null;
    }
  };
}

// ═══════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════

window.ThreeViewer = {
  init,
  buildVisualization,
  captureScreenshot,
  disposeAll,
  MORANDI_COLORS,
  CONTAINER_COLORS
};
