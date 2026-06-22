/**
 * Three.js 3D 可视化引擎
 * 集装箱渲染 + 货物渲染 + 交互控制
 * 依赖: importmap 加载 three 和 OrbitControls
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

// Morandi 色板（用于货物着色）
const MORANDI_COLORS = [
  0xB8A89A, 0x9C8B7D, 0xA8B6B1, 0xD4C5B9, 0xE8DFD5,
  0xC4B5A5, 0x8FA39B, 0xBEAD98, 0xA9AFA9, 0xD9CDBB,
  0xB0AEA3, 0xC7BBB0, 0x99A8A0, 0xCCBFB0, 0xDBD0C2
];

// 集装箱颜色
const CONTAINER_COLORS = {
  standard: 0x6B9080,
  openTop: 0x7B9E8F,
  flatRack: 0x8B7D6B
};

const SCALE = 1; // Three.js units = meters

let scenes = {};       // 每个集装箱一个scene
let renderers = {};
let cameras = {};
let controls = {};
let containers = [];   // 所有集装箱的3D对象
let currentContainer = 0;
let animationIds = {}; // 记录每个 canvas 的 rAF ID，用于取消

// ── 初始化 ──

function init(canvasContainerId) {
  const el = document.getElementById(canvasContainerId);
  if (!el) return;

  // 清空旧资源
  disposeAll();

  // 清空
  el.innerHTML = '';
  scenes = {};
  renderers = {};
  cameras = {};
  controls = {};
  containers = [];
  currentContainer = 0;
  animationIds = {};
}

// ── 资源清理 ──

function disposeAll() {
  // 取消所有动画循环（防御性遍历，防止 null/undefined ID）
  for (const id of Object.values(animationIds)) {
    if (id != null) cancelAnimationFrame(id);
  }
  animationIds = {};

  // 释放所有渲染器（包含 WebGL 上下文）
  for (const renderer of Object.values(renderers)) {
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
  }
  renderers = {};

  // 清理 OrbitControls
  for (const ctrl of Object.values(controls)) {
    ctrl.dispose();
  }
  controls = {};

  // 清理 Three.js 场景中的几何体和材质
  for (const scene of Object.values(scenes)) {
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
  scenes = {};
  cameras = {};
}

// ── 创建集装箱场景 ──

function createContainerScene(index, containerSpec) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f0eb);

  // 光照
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 15, 10);
  scene.add(dirLight);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dirLight2.position.set(-5, 5, -5);
  scene.add(dirLight2);

  // 集装箱容器组
  const containerGroup = new THREE.Group();
  containerGroup.name = 'container';
  scene.add(containerGroup);

  renderContainerBox(containerGroup, containerSpec);

  scenes[index] = scene;
  return scene;
}

/**
 * 验证集装箱规格字段
 */
function validateContainerSpec(spec) {
  if (!spec) return 'containerSpec 为空';
  const { L, W, H } = spec;
  if (!Number.isFinite(L) || L <= 0) return `L 无效: ${L}`;
  if (!Number.isFinite(W) || W <= 0) return `W 无效: ${W}`;
  if (!Number.isFinite(H) || H <= 0) return `H 无效: ${H}`;
  return null;
}

/**
 * 渲染集装箱箱体
 */
function renderContainerBox(group, containerSpec) {
  const validationError = validateContainerSpec(containerSpec);
  if (validationError) {
    throw new Error(`集装箱规格验证失败: ${validationError}`);
  }
  const { L, W, H, type } = containerSpec;
  const color = CONTAINER_COLORS[type] || 0x6B9080;

  // 线框
  const boxGeo = new THREE.BoxGeometry(L * SCALE, H * SCALE, W * SCALE); // Three.js: Y=up
  const edges = new THREE.EdgesGeometry(boxGeo);
  const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: true, opacity: 0.6 });
  const wireframe = new THREE.LineSegments(edges, lineMat);
  group.add(wireframe);

  // 半透明面
  const faceMat = new THREE.MeshPhongMaterial({
    color, transparent: true, opacity: 0.08,
    side: THREE.DoubleSide, depthWrite: false
  });

  if (type === 'openTop') {
    // 开顶柜：不渲染顶面
    const bottomGeo = new THREE.PlaneGeometry(L * SCALE, W * SCALE);
    const bottom = new THREE.Mesh(bottomGeo, faceMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(0, -H * SCALE / 2, 0);
    group.add(bottom);
    // 四面墙
    addWalls(group, L, W, H, faceMat, false);
  } else if (type === 'flatRack') {
    // 框架柜：只有底板 + 两端框架
    const bottomGeo = new THREE.PlaneGeometry(L * SCALE, W * SCALE);
    const bottom = new THREE.Mesh(bottomGeo, faceMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(0, -H * SCALE / 2, 0);
    group.add(bottom);
    // 两端立柱
    const pillarGeo = new THREE.BoxGeometry(0.1, H * SCALE, W * SCALE);
    const pillarMat = new THREE.MeshPhongMaterial({ color: 0x8B7355, transparent: true, opacity: 0.4 });
    const pillar1 = new THREE.Mesh(pillarGeo, pillarMat);
    pillar1.position.set(-L * SCALE / 2, 0, 0);
    group.add(pillar1);
    const pillar2 = new THREE.Mesh(pillarGeo, pillarMat);
    pillar2.position.set(L * SCALE / 2, 0, 0);
    group.add(pillar2);
  } else {
    // 标准柜：完整半透明面
    const boxMat = new THREE.MeshPhongMaterial({
      color, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
      wireframe: false
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    group.add(box);
  }

  // 地面网格参考
  const gridHelper = new THREE.GridHelper(Math.max(L, W) * 1.5, 20, 0xcccccc, 0xe0e0e0);
  gridHelper.position.y = -H * SCALE / 2 - 0.01;
  group.add(gridHelper);

  // 坐标系指示
  const originMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshPhongMaterial({ color: 0xff4444 })
  );
  originMarker.position.set(-L * SCALE / 2, -H * SCALE / 2, -W * SCALE / 2);
  group.add(originMarker);

  // 门标记 (在 +Z 端，即 THREE 的 Z 正方向 = 箱门)
  const doorHeight = Math.min(containerSpec.doorH, containerSpec.H);
  const doorMarkerGeo = new THREE.BoxGeometry(L * SCALE * 0.02, doorHeight * SCALE, containerSpec.doorW * SCALE);
  const doorMarker = new THREE.Mesh(doorMarkerGeo, new THREE.MeshPhongMaterial({ color: 0xffcc00, transparent: true, opacity: 0.3 }));
  doorMarker.position.set(L * SCALE / 2, 0, 0);
  group.add(doorMarker);
}

function addWalls(group, L, W, H, mat, includeTop) {
  // 底面
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -H / 2;
  group.add(bottom);

  // 左墙
  const left = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat);
  left.position.set(0, 0, -W / 2);
  group.add(left);

  // 右墙
  const right = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat);
  right.position.set(0, 0, W / 2);
  group.add(right);

  // 前墙
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  front.rotation.y = Math.PI / 2;
  front.position.set(-L / 2, 0, 0);
  group.add(front);

  // 后墙（门面）= 不渲染

  if (includeTop) {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = H / 2;
    group.add(top);
  }
}

// ── 货物渲染 ──

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

  // 背景
  ctx.fillStyle = bgColor;
  roundRect(ctx, 0, 0, width, height, 12);
  ctx.fill();

  // 文字
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

function renderCargo(group, placedItems, containerSpec) {
  const modelColors = {};
  let colorIdx = 0;

  for (const item of placedItems) {
    if (!modelColors[item.model]) {
      modelColors[item.model] = MORANDI_COLORS[colorIdx % MORANDI_COLORS.length];
      colorIdx++;
    }

    const { l, w, h, x, y, z, stackable, model } = item;

    // Three.js 坐标系: Y轴向上
    const cx = x * SCALE - containerSpec.L * SCALE / 2 + l * SCALE / 2;
    const cy = z * SCALE - containerSpec.H * SCALE / 2 + h * SCALE / 2;
    const cz = y * SCALE - containerSpec.W * SCALE / 2 + w * SCALE / 2;

    const color = modelColors[model];

    // 货物方块
    const geo = new THREE.BoxGeometry(l * SCALE, h * SCALE, w * SCALE);
    const mat = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      specular: 0x222222,
      shininess: 30
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.userData = { model, l, w, h, stackable, position: `(${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)})` };
    group.add(mesh);

    // 黑色线框边框
    const edges = new THREE.EdgesGeometry(geo);
    const edgeLine = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 }));
    edgeLine.position.copy(mesh.position);
    group.add(edgeLine);

    // 不可叠放标记：顶部红色半透明面
    if (!stackable) {
      const topGeo = new THREE.PlaneGeometry(l * SCALE, w * SCALE);
      const topMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      const topMesh = new THREE.Mesh(topGeo, topMat);
      topMesh.rotation.x = -Math.PI / 2;
      topMesh.position.set(cx, cy + h * SCALE / 2 + 0.005, cz);
      group.add(topMesh);
    }

    // 判断是否为旋转放置（放置方向与原始尺寸不一致）
    const origDims = [item.origL, item.origW, item.origH].filter(Boolean);
    const placedDims = [l, w, h];
    const isRotated = origDims.length === 3 && (
      origDims[0] !== placedDims[0] || origDims[1] !== placedDims[1] || origDims[2] !== placedDims[2]
    );

    // 超长/超宽/超高检测
    const isOverLength = l > containerSpec.L + 0.01;
    const isOverWidth = w > containerSpec.W + 0.01;
    const isOverHeight = h > containerSpec.H + 0.01;
    const isOverSize = isOverLength || isOverWidth || isOverHeight;

    if (isOverSize || isRotated) {
      const labels = [];
      if (isOverLength) labels.push(`超长${(l - containerSpec.L).toFixed(2)}m`);
      if (isOverWidth) labels.push(`超宽${(w - containerSpec.W).toFixed(2)}m`);
      if (isOverHeight) labels.push(`超高${(h - containerSpec.H).toFixed(2)}m`);
      if (isRotated) labels.push('旋转');

      // 红色/橙色虚线框标记
      const markerColor = isOverSize ? 0xff0000 : 0xff8800;
      const extGeo = new THREE.BoxGeometry(l * SCALE, h * SCALE, w * SCALE);
      const extEdges = new THREE.EdgesGeometry(extGeo);
      const extLine = new THREE.LineSegments(extEdges, new THREE.LineBasicMaterial({ color: markerColor, transparent: true, opacity: 0.6 }));
      extLine.position.copy(mesh.position);
      group.add(extLine);

      // 标记文字标签
      const markerLabel = createLabelSprite(labels.join(' '), 'rgba(255,255,255,0.9)', isOverSize ? '#C97B7B' : '#B8885A');
      markerLabel.position.set(cx, cy + h * SCALE / 2 + 0.25, cz);
      group.add(markerLabel);
    }

    // 装箱单序号标签
    const seq = item.id || item.sequence || model;
    const label = createLabelSprite(String(seq), 'rgba(245,240,235,0.9)', '#3C3A36');
    label.position.set(cx, cy - h * SCALE / 2 - 0.15, cz);
    group.add(label);
  }
}

// ── 相机 & 渲染 ──

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

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  const maxDim = Math.max(
    isFinite(containerSpec.L) ? containerSpec.L : 0,
    isFinite(containerSpec.W) ? containerSpec.W : 0,
    isFinite(containerSpec.H) ? containerSpec.H : 0
  );
  camera.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.5);
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

// ── 动画循环 ──

function startAnimation(canvasId) {
  function animate() {
    animationIds[canvasId] = requestAnimationFrame(animate);
    // L4: 页面不可见时跳过渲染，节省 GPU 资源
    if (document.hidden) return;
    const ctrl = controls[canvasId];
    const renderer = renderers[canvasId];
    const camera = cameras[canvasId];
    const scene = scenes[canvasId];
    if (ctrl && renderer && camera && scene) {
      ctrl.update();
      renderer.render(scene, camera);
    }
  }
  animationIds[canvasId] = requestAnimationFrame(animate);
}

// ── 截图 ──

function captureScreenshot(canvasId) {
  const renderer = renderers[canvasId];
  if (!renderer) return null;
  const scene = scenes[canvasId];
  const camera = cameras[canvasId];
  if (scene && camera) {
    try {
      renderer.render(scene, camera);
    } catch (err) {
      console.warn(`[captureScreenshot] 渲染失败 canvasId=${canvasId}:`, err);
      return null;
    }
  }
  return renderer.domElement.toDataURL('image/png');
}

// ── 构建完整可视化 ──

/**
 * 为装箱结果创建可视化
 * @param {object} result - PackingEngine.calculate 的返回结果
 * @param {string} parentId - 父容器 DOM ID
 * @returns {object} { containerCount, canvases }
 */
function buildVisualization(result, parentId) {
  const parent = document.getElementById(parentId);
  if (!parent) return;

  if (!result || !result.containers || !Array.isArray(result.containers)) {
    console.warn('[buildVisualization] result 或 result.containers 无效:', result);
    return;
  }

  // 释放上一次可视化的所有 WebGL 资源
  disposeAll();

  parent.innerHTML = '';

  const allCanvases = [];

  for (let i = 0; i < result.containers.length; i++) {
    const c = result.containers[i];
    const containerSpec = window.ContainerDB.CONTAINER_DB[c.containerCode];

    const wrapper = document.createElement('div');
    wrapper.className = 'three-container';
    wrapper.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;';
    wrapper.dataset.containerIndex = i;

    const canvas = document.createElement('canvas');
    canvas.id = `three-canvas-${i}`;
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    wrapper.appendChild(canvas);
    parent.appendChild(wrapper);

    // 信息标签
    const info = document.createElement('div');
    info.className = 'three-info';
    info.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(255,255,255,0.85);padding:4px 10px;border-radius:6px;font-size:11px;color:#666;pointer-events:none;';
    info.textContent = `箱${i + 1} | ${c.containerCode} | ${(c.utilization * 100).toFixed(1)}% | ${c.totalWeight.toFixed(0)}kg`;
    wrapper.appendChild(info);

    allCanvases.push({ wrapper, canvasId: canvas.id, index: i });

    // 创建场景
    const container = window.ContainerDB.CONTAINER_DB[c.containerCode];
    // L3: 空值防护
    if (!container) {
      console.warn(`ThreeViewer: 未知集装箱代码 "${c.containerCode}"，跳过`);
      continue;
    }
    const scene = createContainerScene(canvas.id, container);

    // 渲染货物
    const containerGroup = scene.getObjectByName('container');
    if (containerGroup) {
      renderCargo(containerGroup, c.placedItems, container);
    }

    // 设置相机和渲染器
    setupCameraRenderer(scene, canvas.id, container);

    // 启动动画
    startAnimation(canvas.id);
  }

  // 显示第一个
  if (allCanvases.length > 0) {
    allCanvases[0].wrapper.style.display = 'block';
  }

  return {
    containerCount: result.containers.length,
    canvases: allCanvases,
    showContainer(index) {
      allCanvases.forEach(c => {
        c.wrapper.style.display = 'none';
      });
      if (allCanvases[index]) {
        allCanvases[index].wrapper.style.display = 'block';
        // 触发resize
        const canvas = document.getElementById(allCanvases[index].canvasId);
        if (canvas) {
          const renderer = renderers[allCanvases[index].canvasId];
          if (renderer) {
            renderer.setSize(canvas.clientWidth, canvas.clientHeight);
          }
        }
      }
    },
    getScreenshot(index) {
      if (allCanvases[index]) {
        return captureScreenshot(allCanvases[index].canvasId);
      }
      return null;
    }
  };
}

window.ThreeViewer = {
  init,
  buildVisualization,
  captureScreenshot,
  MORANDI_COLORS,
  CONTAINER_COLORS
};