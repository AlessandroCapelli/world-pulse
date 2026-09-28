import * as THREE from 'three';
import { MAX_CLASSES } from '../choropleth';

export const DATA_TEX_WIDTH = 256;

const vertex = /* glsl */ `
  out vec3 vNormalW;
  out vec3 vPosW;
  void main() {
    vNormalW = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uIdMap;
  uniform vec2 uIdSize;
  uniform sampler2D uData;
  uniform sampler2D uDataPrev;
  uniform float uMix;
  uniform vec3 uRamp[${MAX_CLASSES}];
  uniform vec3 uRampPrev[${MAX_CLASSES}];
  uniform vec3 uLand;
  uniform vec3 uRim;
  uniform vec3 uSunDir;
  uniform float uHover;
  uniform float uSelected;
  uniform float uChoropleth;
  uniform float uTime;
  uniform float uMotion;
  in vec3 vNormalW;
  in vec3 vPosW;
  out vec4 fragColor;

  const float PI = 3.141592653589793;

  float idAt(vec2 uv) {
    vec2 rg = texture(uIdMap, uv).rg;
    return floor(rg.r * 255.0 + 0.5) + floor(rg.g * 255.0 + 0.5) * 256.0;
  }

  vec4 dataAt(sampler2D tex, float id) {
    ivec2 p = ivec2(int(mod(id, ${DATA_TEX_WIDTH}.0)), int(floor(id / ${DATA_TEX_WIDTH}.0)));
    return texelFetch(tex, p, 0);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lng = atan(n.x, n.z);
    // Row 0 of the ID map is north (uploaded without flip), so v grows southwards.
    vec2 uv = vec2(lng / (2.0 * PI) + 0.5, 0.5 - lat / PI);
    float id = idAt(uv);
    float land = step(0.5, id);

    float latDeg = degrees(lat);
    float lngDeg = degrees(lng);

    // Seam-safe derivatives of longitude.
    float lngAlt = mod(lngDeg + 360.0, 360.0);
    float fwLng = min(fwidth(lngDeg), fwidth(lngAlt));
    float fwLat = fwidth(latDeg);

    // Graticule every 15°, equator and tropics a bit brighter.
    vec2 g = vec2(lngDeg, latDeg) / 15.0;
    vec2 gd = abs(fract(g - 0.5) - 0.5) * 15.0 / vec2(max(fwLng, 1e-4), max(fwLat, 1e-4));
    float grid = 1.0 - min(min(gd.x, gd.y), 1.0);
    float equator = 1.0 - min(abs(latDeg) / max(fwLat, 1e-4), 1.0);

    // Dot matrix for land with roughly constant ground spacing.
    float sp = 0.62;
    float row = floor((latDeg + 90.0) / sp);
    float rowLat = -90.0 + (row + 0.5) * sp;
    float circ = max(cos(radians(rowLat)), 0.02);
    float cols = max(floor(360.0 * circ / sp), 1.0);
    float colW = 360.0 / cols;
    float col = floor((lngDeg + 180.0) / colW);
    float cx = -180.0 + (col + 0.5) * colW;
    vec2 dd = vec2((lngDeg - cx) * cos(lat), latDeg - rowLat) / sp;
    float dist = length(dd);
    float aa = max(fwidth(dist), 1e-3);
    float dotMask = 1.0 - smoothstep(0.24 - aa, 0.24 + aa, dist);

    // Metric data (cross-faded between previous and current dataset).
    vec4 dNow = dataAt(uData, id);
    vec4 dPrev = dataAt(uDataPrev, id);
    float value = mix(dPrev.b, dNow.b, uMix);
    float flag = floor(mix(dPrev.g, dNow.g, step(0.5, uMix)) * 255.0 + 0.5);
    int clsNow = int(dNow.r * 255.0 + 0.5) - 1;
    int clsPrev = int(dPrev.r * 255.0 + 0.5) - 1;
    vec3 fillNow = clsNow >= 0 ? uRamp[min(clsNow, ${MAX_CLASSES - 1})] : vec3(0.0);
    vec3 fillPrev = clsPrev >= 0 ? uRampPrev[min(clsPrev, ${MAX_CLASSES - 1})] : vec3(0.0);
    vec3 fill = mix(fillPrev, fillNow, uMix);
    float has = step(0.5, flag) * land * uChoropleth;
    float allocated = step(2.5, flag);
    float hatch = step(0.55, fract((gl_FragCoord.x + gl_FragCoord.y) / 6.0));

    vec3 ocean = vec3(0.0012, 0.0055, 0.0125);
    vec3 color = ocean;
    color += uLand * 0.05 * grid + uLand * 0.12 * equator;

    // Land: faint fill + dots.
    color += land * uLand * 0.018;
    color += land * dotMask * uLand * 0.26;

    // Choropleth: quantile class colour as a translucent fill plus brighter dots (hatched when allocated).
    // Faded towards the limb, where dots merge into a solid (and over-bloomed) band.
    float limb = smoothstep(0.02, 0.4, dot(n, V));
    float fillAlpha = (0.46 + 0.2 * value) * mix(1.0, 0.2 + 0.6 * hatch, allocated) * limb;
    color = mix(color, fill * 0.42, has * fillAlpha);
    color += has * dotMask * fill * (0.22 + 0.3 * value) * mix(1.0, 0.5, allocated) * mix(0.35, 1.0, limb);

    // Hover / selection.
    float hovered = land * (1.0 - step(0.5, abs(id - uHover)));
    float selected = land * (1.0 - step(0.5, abs(id - uSelected)));
    color += hovered * uRim * 0.12 + hovered * dotMask * uRim * 0.35;
    if (selected > 0.5) {
      vec2 px = 1.5 / uIdSize;
      float e = 0.0;
      e += step(0.5, abs(idAt(uv + vec2(px.x, 0.0)) - id));
      e += step(0.5, abs(idAt(uv - vec2(px.x, 0.0)) - id));
      e += step(0.5, abs(idAt(uv + vec2(0.0, px.y)) - id));
      e += step(0.5, abs(idAt(uv - vec2(0.0, px.y)) - id));
      color = color * 0.85 + uRim * 0.06 + min(e, 1.0) * vec3(1.0) * 1.1;
    }

    // Day / night.
    float s = dot(n, uSunDir);
    float night = smoothstep(0.12, -0.28, s);
    color *= mix(1.0, 0.42, night);

    // Fresnel rim.
    float fr = pow(1.0 - max(dot(n, V), 0.0), 2.6);
    color += uRim * fr * 0.42;

    // Slow sweeping scan band.
    float band = exp(-pow((latDeg - (mod(uTime * 9.0, 240.0) - 120.0)) / 3.0, 2.0)) * uMotion;
    color += uRim * band * 0.05;

    fragColor = vec4(color, 1.0);
  }
`;

export class HoloSphere {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;
  private idTexture: THREE.DataTexture | null = null;

  constructor(detail: number) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uIdMap: { value: blankTexture(1, 1, THREE.RGFormat) },
        uIdSize: { value: new THREE.Vector2(1, 1) },
        uData: { value: null },
        uDataPrev: { value: null },
        uMix: { value: 1 },
        uRamp: { value: Array.from({ length: MAX_CLASSES }, () => new THREE.Color()) },
        uRampPrev: { value: Array.from({ length: MAX_CLASSES }, () => new THREE.Color()) },
        uLand: { value: new THREE.Color('#3fd8ff') },
        uRim: { value: new THREE.Color('#5fe8ff') },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uHover: { value: -1 },
        uSelected: { value: -1 },
        uChoropleth: { value: 1 },
        uTime: { value: 0 },
        uMotion: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, detail * 2, detail), this.material);
    this.mesh.renderOrder = 1;
  }

  setIdMap(ids: Uint16Array, width: number, height: number): void {
    this.idTexture?.dispose();
    // Uint16 little-endian = [low byte, high byte] = RG8.
    const tex = new THREE.DataTexture(new Uint8Array(ids.buffer, ids.byteOffset, ids.byteLength), width, height, THREE.RGFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.unpackAlignment = 2;
    tex.needsUpdate = true;
    this.idTexture = tex;
    this.material.uniforms['uIdMap'].value = tex;
    (this.material.uniforms['uIdSize'].value as THREE.Vector2).set(width, height);
  }

  dispose(): void {
    this.idTexture?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export function blankTexture(w: number, h: number, format: THREE.PixelFormat = THREE.RGBAFormat): THREE.DataTexture {
  const channels = format === THREE.RGFormat ? 2 : 4;
  const t = new THREE.DataTexture(new Uint8Array(w * h * channels), w, h, format, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
