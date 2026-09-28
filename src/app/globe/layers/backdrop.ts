import * as THREE from 'three';

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTwinkle;
  void main() {
    vTwinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aPhase) + aPhase * 40.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const starFragment = /* glsl */ `
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.0, 0.5, d)) * vTwinkle * 0.55;
    gl_FragColor = vec4(vec3(0.6, 0.85, 1.0), a);
  }
`;

const ringVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTicks;
  varying vec2 vPos;
  void main() {
    float ang = atan(vPos.y, vPos.x);
    float t = fract(ang / 6.2831853 * uTicks);
    float tick = step(0.82, t);
    float gap = step(0.08, fract(ang / 6.2831853 * 3.0 + 0.02));
    gl_FragColor = vec4(uColor, uAlpha * (0.35 + 0.65 * tick) * gap);
  }
`;

/** Star field and slowly rotating HUD rings. */
export class Backdrop {
  readonly group = new THREE.Group();
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly rings: THREE.Mesh[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(starCount: number) {
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < starCount; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const r = 40 + rand() * 30;
      const s = Math.sqrt(1 - u * u);
      positions.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      sizes[i] = 0.6 + Math.pow(rand(), 3) * 2.4;
      phases[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(g, this.starMaterial);
    stars.frustumCulled = false;
    this.group.add(stars);
    this.disposables.push(g, this.starMaterial);

    this.addRing(1.34, 0.0022, 120, 0.22, 23.4, 0.02);
    this.addRing(1.52, 0.0014, 36, 0.12, -11, -0.012);
  }

  private addRing(radius: number, thickness: number, ticks: number, alpha: number, tiltDeg: number, speed: number): void {
    const geometry = new THREE.RingGeometry(radius, radius + thickness, 360, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: { uColor: { value: new THREE.Color('#58e6ff') }, uAlpha: { value: alpha }, uTicks: { value: ticks } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2 + (tiltDeg * Math.PI) / 180;
    mesh.userData['speed'] = speed;
    mesh.renderOrder = 2;
    this.rings.push(mesh);
    this.group.add(mesh);
    this.disposables.push(geometry, material);
  }

  update(time: number, dt: number, pixelRatio: number, motion: boolean): void {
    this.starMaterial.uniforms['uTime'].value = motion ? time : 0;
    this.starMaterial.uniforms['uPixelRatio'].value = pixelRatio;
    if (!motion) return;
    for (const r of this.rings) r.rotation.z += (r.userData['speed'] as number) * dt;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
