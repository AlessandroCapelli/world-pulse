import * as THREE from 'three';

const ringVertex = /* glsl */ `
  attribute vec3 aPos;
  attribute float aStart;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uLife;
  uniform float uSize;
  varying vec2 vUv;
  varying float vAge;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    float age = (uTime - aStart) / uLife;
    if (age < 0.0 || age > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vec3 N = normalize(aPos);
    vFacing = dot(N, normalize(cameraPosition - N));
    vec3 up = abs(N.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);
    float r = uSize * (0.2 + 0.8 * sqrt(age));
    vec3 wp = N * 1.004 + (T * position.x + B * position.y) * r;
    vUv = position.xy;
    vAge = age;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform float uFlash;
  varying vec2 vUv;
  varying float vAge;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float ring = smoothstep(0.7, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
    float core = (1.0 - smoothstep(0.0, 0.32, d)) * exp(-vAge * 6.0) * uFlash;
    float fade = (1.0 - vAge) * (1.0 - vAge);
    float a = (ring * fade * 0.6 + core * 0.85) * smoothstep(0.02, 0.25, vFacing);
    gl_FragColor = vec4(vColor, a);
  }
`;

const beamVertex = /* glsl */ `
  attribute vec3 aPos;
  attribute float aStart;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uLife;
  uniform float uHeight;
  uniform float uWidth;
  varying vec2 vUv;
  varying float vAge;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    float age = (uTime - aStart) / uLife;
    if (age < 0.0 || age > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    vec3 N = normalize(aPos);
    vec3 base = N * 1.002;
    vec3 toCam = normalize(cameraPosition - base);
    vFacing = dot(N, toCam);
    vec3 side = normalize(cross(N, toCam));
    float h = uHeight * (0.55 + 0.45 * fract(aStart * 13.37));
    float y = position.y * 0.5 + 0.5;
    vec3 wp = base + side * position.x * uWidth + N * y * h;
    vUv = vec2(position.x, y);
    vAge = age;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const beamFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vAge;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    float across = 1.0 - abs(vUv.x);
    // Beams seen edge-on at the limb look like streaks into space: fade them out there.
    float a = exp(-vAge * 4.0) * (1.0 - vUv.y) * across * across * smoothstep(0.35, 0.7, vFacing);
    gl_FragColor = vec4(vColor, a);
  }
`;

/**
 * GPU-driven pulse system: a ring buffer of instances, each with spawn time/position/color.
 * Animation (expanding ring + vertical flash) happens entirely in shaders; CPU only writes new spawns.
 */
export class Particles {
  readonly group = new THREE.Group();
  readonly capacity: number;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly start: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly ringMaterial: THREE.ShaderMaterial;
  private readonly beamMaterial: THREE.ShaderMaterial;
  private readonly geometries: THREE.InstancedBufferGeometry[] = [];
  private cursor = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;
  readonly life = 2.4;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.start = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(-1e6), 1);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.pos, this.start, this.color]) a.setUsage(THREE.DynamicDrawUsage);

    const common = {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    };
    this.ringMaterial = new THREE.ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: { uTime: { value: 0 }, uLife: { value: this.life }, uSize: { value: 0.028 }, uFlash: { value: 1 } },
      ...common,
    });
    this.beamMaterial = new THREE.ShaderMaterial({
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      uniforms: { uTime: { value: 0 }, uLife: { value: this.life * 0.45 }, uHeight: { value: 0.07 }, uWidth: { value: 0.0022 } },
      ...common,
    });
    this.group.add(this.mesh(this.ringMaterial), this.mesh(this.beamMaterial));
  }

  private mesh(material: THREE.ShaderMaterial): THREE.Mesh {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('aPos', this.pos);
    g.setAttribute('aStart', this.start);
    g.setAttribute('aColor', this.color);
    g.instanceCount = this.capacity;
    this.geometries.push(g);
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    m.renderOrder = 4;
    return m;
  }

  spawn(x: number, y: number, z: number, time: number, r: number, g: number, b: number): void {
    const i = this.cursor;
    this.pos.setXYZ(i, x, y, z);
    this.start.setX(i, time);
    this.color.setXYZ(i, r, g, b);
    if (this.dirtyFrom < 0) this.dirtyFrom = i;
    this.dirtyTo = i;
    this.cursor = (i + 1) % this.capacity;
    if (this.cursor === 0) this.wrapped = true;
  }

  /** Uploads only the ranges written since the last frame. */
  flush(time: number, reducedMotion: boolean): void {
    this.ringMaterial.uniforms['uTime'].value = time;
    this.beamMaterial.uniforms['uTime'].value = time;
    this.ringMaterial.uniforms['uFlash'].value = reducedMotion ? 0.4 : 1;
    this.group.children[1].visible = !reducedMotion;
    if (this.dirtyFrom < 0) return;
    for (const a of [this.pos, this.start, this.color]) {
      a.clearUpdateRanges();
      if (this.wrapped || this.dirtyTo < this.dirtyFrom) {
        a.addUpdateRange(0, this.capacity * a.itemSize);
      } else {
        a.addUpdateRange(this.dirtyFrom * a.itemSize, (this.dirtyTo - this.dirtyFrom + 1) * a.itemSize);
      }
      a.needsUpdate = true;
    }
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
    this.wrapped = false;
  }

  clear(): void {
    (this.start.array as Float32Array).fill(-1e6);
    this.start.clearUpdateRanges();
    this.start.needsUpdate = true;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.ringMaterial.dispose();
    this.beamMaterial.dispose();
  }
}
