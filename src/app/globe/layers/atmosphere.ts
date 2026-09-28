import * as THREE from 'three';

const vertex = /* glsl */ `
  varying vec3 vNormalV;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vNormalV;
  void main() {
    float i = pow(clamp(0.6 - dot(vNormalV, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 4.2);
    gl_FragColor = vec4(uColor, i * uIntensity);
  }
`;

/** Fresnel halo around the globe (back faces of a slightly larger sphere). */
export class Atmosphere {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor() {
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uColor: { value: new THREE.Color('#2fd6ff') }, uIntensity: { value: 0.7 } },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), material);
    this.mesh.scale.setScalar(1.12);
    this.mesh.renderOrder = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
