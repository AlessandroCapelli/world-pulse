import * as THREE from 'three';

const vertex = /* glsl */ `
  varying float vFacing;
  void main() {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vFacing = dot(normalize(wp), normalize(cameraPosition - wp));
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFront;
  uniform float uBack;
  varying float vFacing;
  void main() {
    // Hologram look: lines on the far side stay faintly visible through the globe.
    float a = mix(uBack, uFront, smoothstep(-0.03, 0.18, vFacing));
    gl_FragColor = vec4(uColor, a);
  }
`;

/** Coastlines and country borders as additive line segments that fade on the far hemisphere. */
export class BorderLines {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(coastlines: Float32Array, borders: Float32Array) {
    this.group.add(this.lines(coastlines, '#6ff3ff', 0.85, 0.07));
    this.group.add(this.lines(borders, '#3fb8e0', 0.42, 0.035));
  }

  private lines(positions: Float32Array, color: string, front: number, back: number): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.01);
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uFront: { value: front },
        uBack: { value: back },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(material);
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 3;
    lines.frustumCulled = false;
    return lines;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
  }
}
