import * as THREE from 'three';

const vertex = /* glsl */ `
  attribute float aFlag;
  varying vec2 vUv;
  varying float vY;
  varying float vFlag;
  varying float vFacing;
  void main() {
    vUv = uv;
    vY = position.y;
    vFlag = aFlag;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vFacing = dot(normalize(base), normalize(cameraPosition - base));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  varying float vY;
  varying float vFlag;
  varying float vFacing;
  void main() {
    vec2 e = abs(vUv * 2.0 - 1.0);
    float edge = smoothstep(0.72, 1.0, max(e.x, e.y));
    float grad = 0.18 + 0.95 * pow(vY, 1.6);
    float allocated = step(2.5, vFlag);
    float stripes = mix(1.0, 0.45 + 0.55 * step(0.5, fract(vY * 18.0 - uTime * 0.6)), allocated);
    float cap = step(0.999, vY);
    float a = (0.28 * grad + edge * 0.85 * (0.4 + 0.6 * vY) + cap * 0.9) * stripes;
    a *= smoothstep(-0.25, 0.1, vFacing);
    gl_FragColor = vec4(uColor * (1.0 + edge * 0.6), a * mix(1.0, 0.6, allocated));
  }
`;

const UP = new THREE.Vector3(0, 1, 0);

/** Holographic columns standing on country centroids; heights animate towards their targets. */
export class Spikes {
  readonly mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private readonly current: Float32Array;
  private readonly target: Float32Array;
  private readonly normals: THREE.Vector3[] = [];
  private readonly flagAttr: THREE.InstancedBufferAttribute;
  private readonly width: number;
  private animating = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(centroids: Float32Array, width = 0.0095) {
    const count = centroids.length / 3;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    this.flagAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    geometry.setAttribute('aFlag', this.flagAttr);
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uColor: { value: new THREE.Color('#46f0ff') }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.width = width;
    this.current = new Float32Array(count);
    this.target = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.normals.push(new THREE.Vector3(centroids[i * 3], centroids[i * 3 + 1], centroids[i * 3 + 2]).normalize());
      this.writeMatrix(i, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** heights: per country index, already scaled (globe radii). */
  setTargets(heights: Float32Array, flags: Uint8Array, color: THREE.Color, immediate: boolean): void {
    const n = this.target.length;
    for (let i = 0; i < n; i++) {
      this.target[i] = heights[i] ?? 0;
      this.flagAttr.setX(i, flags[i] ?? 0);
      if (immediate) this.current[i] = this.target[i];
    }
    this.flagAttr.needsUpdate = true;
    (this.mesh.material.uniforms['uColor'].value as THREE.Color).copy(color);
    this.animating = true;
    if (immediate) this.update(0);
  }

  update(dt: number): void {
    this.mesh.material.uniforms['uTime'].value += dt;
    if (!this.animating) return;
    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt * 5);
    let moving = false;
    for (let i = 0; i < this.current.length; i++) {
      const c = this.current[i];
      const t = this.target[i];
      if (c === t) continue;
      let next = c + (t - c) * k;
      if (Math.abs(next - t) < 1e-4) next = t;
      else moving = true;
      this.current[i] = next;
      this.writeMatrix(i, next);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.animating = moving;
  }

  private writeMatrix(i: number, h: number): void {
    const n = this.normals[i];
    this.p.copy(n).multiplyScalar(0.999);
    this.q.setFromUnitVectors(UP, n);
    const w = h > 0 ? this.width : 0;
    this.s.set(w, Math.max(h, 1e-6), w);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
