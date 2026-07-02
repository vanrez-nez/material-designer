import * as THREE from "three";
import { MaterialGraphController } from "./material/graph/controller";
import { TexturedSurface } from "@/runtime";
import { bakeService } from "@/runtime";

const SHADOW_MAP_SIZE = 2048;

function addFullVertexAo(geometry: THREE.BufferGeometry): void {
  geometry.setAttribute(
    "vertexAo",
    new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count).fill(1), 1),
  );
}

function copyUv(geometry: THREE.BufferGeometry): Float32Array {
  return (geometry.getAttribute("uv").array as Float32Array).slice();
}

function applyUvTiling(geometry: THREE.BufferGeometry, baseUv: Float32Array, tiles: number): void {
  const uv = geometry.getAttribute("uv");
  const arr = uv.array as Float32Array;
  for (let i = 0; i < arr.length; i++) arr[i] = baseUv[i] * tiles;
  uv.needsUpdate = true;
}

export class MainScene {
  readonly scene = new THREE.Scene();
  readonly materialController = new MaterialGraphController();
  readonly materialSurface = new TexturedSurface(this.materialController, bakeService, "material");
  readonly directionalLight = new THREE.DirectionalLight(0xffffff, 3);
  readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
  readonly demoStats = { textureMs: 0 };

  private readonly sphere: THREE.Mesh<THREE.SphereGeometry, THREE.Material>;
  private readonly plane: THREE.Mesh<THREE.PlaneGeometry, THREE.Material>;
  private readonly sphereBaseUv: Float32Array;
  private readonly planeBaseUv: Float32Array;

  constructor() {
    this.scene.background = new THREE.Color(0x181818);

    const sphereGeometry = new THREE.SphereGeometry(1, 96, 48);
    const planeGeometry = new THREE.PlaneGeometry(8, 8);
    planeGeometry.rotateX(-Math.PI / 2);
    addFullVertexAo(sphereGeometry);
    addFullVertexAo(planeGeometry);
    this.sphereBaseUv = copyUv(sphereGeometry);
    this.planeBaseUv = copyUv(planeGeometry);

    this.sphere = new THREE.Mesh(sphereGeometry, this.materialSurface.material);
    this.sphere.name = "material-preview-sphere";
    this.sphere.position.set(-1.15, 0.95, 0);
    this.sphere.castShadow = true;
    this.sphere.receiveShadow = true;

    this.plane = new THREE.Mesh(planeGeometry, this.materialSurface.material);
    this.plane.name = "material-preview-plane";
    this.plane.position.y = -0.12;
    this.plane.receiveShadow = true;

    this.materialSurface.onRebuilt(() => {
      this.sphere.material = this.materialSurface.material;
      this.plane.material = this.materialSurface.material;
    });

    this.directionalLight.position.set(3, 4, 5);
    this.configureShadow();
    this.scene.add(this.sphere, this.plane, this.directionalLight, this.directionalLight.target, this.ambientLight);
    this.setDemoTiling(1);
  }

  setDemoTiling(tiles: number): void {
    applyUvTiling(this.sphere.geometry, this.sphereBaseUv, tiles);
    applyUvTiling(this.plane.geometry, this.planeBaseUv, tiles);
  }

  update(): void {
    this.demoStats.textureMs = this.materialSurface.getLastBakeMs();
  }

  requestShadowBake(): void {
    this.directionalLight.shadow.needsUpdate = true;
  }

  dispose(): void {
    this.sphere.geometry.dispose();
    this.plane.geometry.dispose();
    this.materialSurface.dispose();
    this.materialController.dispose();
  }

  private configureShadow(): void {
    const light = this.directionalLight;
    light.castShadow = true;
    light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

    const cam = light.shadow.camera;
    cam.near = 0.5;
    cam.far = 20;
    cam.left = -4;
    cam.right = 4;
    cam.top = 4;
    cam.bottom = -4;
    cam.updateProjectionMatrix();

    light.shadow.bias = -0.0008;
    light.shadow.normalBias = 0.02;
    light.shadow.radius = 4;
  }
}
