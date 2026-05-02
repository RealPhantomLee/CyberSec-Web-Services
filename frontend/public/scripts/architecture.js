import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js";

const container = document.getElementById("architecture-container");

/* -------------------------
SCENE
------------------------- */

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

camera.position.set(120, 120, 120);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

/* -------------------------
LIGHT
------------------------- */

scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const light = new THREE.PointLight(0x40E0D0, 2);
light.position.set(50, 100, 50);
scene.add(light);

/* -------------------------
GRID / CITY
------------------------- */

const grid = new THREE.GridHelper(600, 100, 0x00CED1, 0x002a2a);
scene.add(grid);

const city = new THREE.Group();
scene.add(city);

function createBuilding(x, z) {
  const height = Math.random() * 40 + 10;

  const geo = new THREE.BoxGeometry(6, height, 6);
  const edges = new THREE.EdgesGeometry(geo);

  const wire = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x40E0D0 })
  );

  wire.position.set(x, height / 2, z);
  city.add(wire);
}

/* slightly reduced density */
for (let x = -150; x <= 150; x += 18) {
  for (let z = -150; z <= 150; z += 18) {
    if (Math.random() > 0.42) {
      createBuilding(x, z);
    }
  }
}

/* -------------------------
PROJECT NODES
------------------------- */

const nodes = {};

async function loadNodes() {
  const res = await fetch("data/portfolio.json?v=" + Date.now());
  const projects = await res.json();

  projects.forEach((p) => {
    /* lower sphere complexity */
    const geo = new THREE.SphereGeometry(2, 16, 16);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xff1493,
      emissive: 0xff1493,
      emissiveIntensity: 0.6
    });

    const node = new THREE.Mesh(geo, mat);

    node.position.set(
      (Math.random() - 0.5) * 120,
      10,
      (Math.random() - 0.5) * 120
    );

    scene.add(node);
    nodes[p.slug] = node;
  });
}

loadNodes();

/* -------------------------
CAMERA TARGET
------------------------- */

let target = new THREE.Vector3(120, 120, 120);

function zoomToNode(node) {
  target.set(
    node.position.x + 40,
    node.position.y + 40,
    node.position.z + 40
  );
}

/* -------------------------
OVERLAY
------------------------- */

const overlay = document.createElement("div");
overlay.className = "ui-overlay";
document.body.appendChild(overlay);

/* -------------------------
EXPAND PANEL
------------------------- */

let activePanel = null;

function getPanelTargetSize() {
  return {
    width: Math.min(window.innerWidth * 0.9, 900),
    maxHeight: Math.floor(window.innerHeight * 0.8)
  };
}

async function expandCard(card, slug) {
  if (activePanel) return;

  const res = await fetch("data/portfolio.json?v=" + Date.now());
  const data = await res.json();
  const p = data.find((x) => x.slug === slug);

  if (!p) return;

  overlay.style.opacity = 1;
  overlay.style.pointerEvents = "auto";

  const rect = card.getBoundingClientRect();
  const { width, maxHeight } = getPanelTargetSize();

  const panel = document.createElement("div");
  panel.className = "project-panel";

  panel.style.left = rect.left + "px";
  panel.style.top = rect.top + "px";
  panel.style.width = rect.width + "px";
  panel.style.maxHeight = maxHeight + "px";
  panel.style.transition = "all .5s ease";

  document.body.appendChild(panel);
  activePanel = panel;

  requestAnimationFrame(() => {
    panel.style.left = "50%";
    panel.style.top = "50%";
    panel.style.transform = "translate(-50%,-50%)";
    panel.style.width = width + "px";
  });

  setTimeout(() => {
    panel.innerHTML = `
      <h1>${p.title}</h1>

      <h2>Project Summary</h2>
      <p>${p.summary || "Summary not found in portfolio.json"}</p>

      <h2>Skills Used</h2>
      <ul>
        ${(p.skills || []).map(s => `<li>${s}</li>`).join("")}
      </ul>

      <h2>Tools Used</h2>
      <ul>
        ${(p.tools || []).map(t => `<li>${t}</li>`).join("")}
      </ul>

      <h2>Results Achieved</h2>
      <ul>
        ${(p.results || []).map(r => `<li>${r}</li>`).join("")}
      </ul>

      <button id="closePanel" class="close-btn">Close</button>
    `;

    document.getElementById("closePanel").onclick = closePanel;
  }, 400);
}

function closePanel() {
  if (!activePanel) return;

  activePanel.style.opacity = 0;

  setTimeout(() => {
    activePanel.remove();
    activePanel = null;

    overlay.style.opacity = 0;
    overlay.style.pointerEvents = "none";
  }, 300);
}

/* -------------------------
CARD INTERACTION
------------------------- */

function bindCards() {
  const cards = document.querySelectorAll(".project-card");

  cards.forEach((card) => {
    const slug = card.dataset.slug;

    card.addEventListener("mouseenter", () => {
      const node = nodes[slug];
      if (node) node.material.emissiveIntensity = 3;
    });

    card.addEventListener("mouseleave", () => {
      const node = nodes[slug];
      if (node) node.material.emissiveIntensity = 0.6;
    });

    card.addEventListener("click", () => {
      const node = nodes[slug];
      if (node) zoomToNode(node);

      expandCard(card, slug);
    });
  });
}

if (document.querySelector(".project-card")) {
  bindCards();
} else {
  window.addEventListener("cards-loaded", bindCards, { once: true });
}

/* -------------------------
ANIMATION
------------------------- */

function animate() {
  requestAnimationFrame(animate);

  camera.position.lerp(target, 0.02);
  city.rotation.y += 0.00035;

  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

animate();

/* -------------------------
RESIZE
------------------------- */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (activePanel) {
    const { width, maxHeight } = getPanelTargetSize();
    activePanel.style.width = width + "px";
    activePanel.style.maxHeight = maxHeight + "px";
  }
});
