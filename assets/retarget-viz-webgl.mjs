/**
 * retarget-viz-webgl.mjs — Three.js renderer for pre-baked retargeting scenes.
 * Loads assets/data/softact-baked.json and renders geometry directly.
 * No algorithmic code — all geometry is pre-computed.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Constants ────────────────────────────────────────────────────────────────

const OBJ_COLOR     = new THREE.Color(0x7eb8ff);
const CONTACT_COLOR = new THREE.Color(0xff9933);

// ── Scene setup ──────────────────────────────────────────────────────────────

const host = document.getElementById('retarget-three-host');
if (!host) throw new Error('retarget-three-host not found');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0e1016, 1);
renderer.shadowMap.enabled = false;
host.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(22, 18, 28);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.update();

scene.add(new THREE.AmbientLight(0x606880, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(4, 12, 8);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8899cc, 0.4);
fill.position.set(-6, 2, -4);
scene.add(fill);

// ── Resize ───────────────────────────────────────────────────────────────────

function onResize() {
  const w = host.clientWidth || 800;
  const h = Math.max(420, Math.round(w * 0.55));
  host.style.height = h + 'px';
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ── Render loop ──────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ── Material helpers ─────────────────────────────────────────────────────────

function stdMat(color, opacity) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.7, metalness: 0.05,
    side: THREE.DoubleSide,
    transparent: opacity < 1, opacity: opacity ?? 1,
  });
}

// ── Geometry builders ────────────────────────────────────────────────────────

/** Build a mesh from flat position/index arrays (no per-vertex color). */
function buildFlatMesh(flatVerts, flatFaces, mat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flatVerts), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(flatFaces), 1));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** Build a mesh with per-vertex colors (flat arrays). */
function buildColorMesh(flatVerts, flatFaces, flatColors) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flatVerts), 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(flatColors), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(flatFaces), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function makeSphere(pos, radius, color) {
  const geo = new THREE.SphereGeometry(radius, 8, 6);
  const m   = new THREE.Mesh(geo, stdMat(color));
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

function makeArrow(from, to, color) {
  const f   = new THREE.Vector3(...from);
  const t   = new THREE.Vector3(...to);
  const dir = t.clone().sub(f);
  const len = dir.length();
  if (len < 0.01) return null;
  return new THREE.ArrowHelper(dir.normalize(), f, len, color, len*0.3, len*0.15);
}

function makeDashedLine(from, to, color) {
  const pts  = [new THREE.Vector3(...from), new THREE.Vector3(...to)];
  const geo  = new THREE.BufferGeometry().setFromPoints(pts);
  const mat  = new THREE.LineDashedMaterial({ color, dashSize: 0.5, gapSize: 0.3 });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  return line;
}

// ── Camera fit ───────────────────────────────────────────────────────────────

function fitCamera(group) {
  const box  = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const ctr  = box.getCenter(new THREE.Vector3());
  const r    = Math.max(size.x, size.y, size.z) * 0.65 || 14;
  controls.target.copy(ctr);
  camera.position.set(ctr.x + r*1.3, ctr.y + r*0.9, ctr.z + r*1.3);
  camera.near = Math.max(0.05, r/200);
  camera.far  = r * 80;
  camera.updateProjectionMatrix();
  controls.update();
}

// ── State ────────────────────────────────────────────────────────────────────

let bakedData    = null;
let currentTask  = 'insertion';
let currentStage = 'demo';
const sceneGroup = new THREE.Group();
scene.add(sceneGroup);

// ── Scene builder ─────────────────────────────────────────────────────────────

function clearScene() {
  sceneGroup.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  sceneGroup.clear();
}

function buildScene(task, stage) {
  clearScene();
  if (!bakedData) return;

  const taskData = bakedData.tasks[task];
  if (!taskData) return;

  const stageData = taskData.stages[stage];
  if (!stageData) return;

  // ── Hand mesh ──────────────────────────────────────────────────────────────
  const handMesh = buildColorMesh(
    taskData.hand.verts,
    bakedData.handFaces,
    taskData.hand.colors,
  );
  sceneGroup.add(handMesh);

  // ── Object mesh ────────────────────────────────────────────────────────────
  if (taskData.object) {
    const objMesh = buildFlatMesh(
      taskData.object.verts,
      taskData.object.faces,
      stdMat(OBJ_COLOR, 0.85),
    );
    sceneGroup.add(objMesh);
  }

  // ── Spheres ───────────────────────────────────────────────────────────────
  for (const s of (stageData.spheres || [])) {
    sceneGroup.add(makeSphere(s.pos, s.r, s.color));
  }

  // ── Dashed lines ──────────────────────────────────────────────────────────
  for (const l of (stageData.dashedLines || [])) {
    const line = makeDashedLine(l.a, l.b, l.color);
    if (line) sceneGroup.add(line);
  }

  // ── Arrows ────────────────────────────────────────────────────────────────
  for (const a of (stageData.arrows || [])) {
    const arrow = makeArrow(a.a, a.b, a.color);
    if (arrow) sceneGroup.add(arrow);
  }

  // ── Soft fingers (full stage) ─────────────────────────────────────────────
  for (const fg of (stageData.fingers || [])) {
    const mesh = buildFlatMesh(fg.verts, bakedData.fingerFaces, stdMat(fg.color, 0.92));
    sceneGroup.add(mesh);
  }

  fitCamera(sceneGroup);
}

// ── Description text ─────────────────────────────────────────────────────────

function updateDesc(task, stage) {
  const el = document.getElementById('retarget-desc');
  if (!el || !bakedData) return;
  const taskData  = bakedData.tasks[task];
  const stageData = taskData && taskData.stages[stage];
  el.innerHTML = stageData ? (stageData.desc || '') : '';
}

// ── UI wiring ─────────────────────────────────────────────────────────────────

document.querySelectorAll('.rv-stage-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.rv-stage-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentStage = this.dataset.stage;
    buildScene(currentTask, currentStage);
    updateDesc(currentTask, currentStage);
  });
});

document.querySelectorAll('.rv-task-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.rv-task-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentTask = this.dataset.task;
    buildScene(currentTask, currentStage);
    updateDesc(currentTask, currentStage);
  });
});

// ── Data loading ─────────────────────────────────────────────────────────────

(async function init() {
  try {
    const r = await fetch('assets/data/softact-baked.json');
    if (!r.ok) return;
    bakedData = await r.json();
  } catch(e) { return; }
  buildScene(currentTask, currentStage);
  updateDesc(currentTask, currentStage);
})();
