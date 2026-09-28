import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { latLngToXyz, xyzToLatLng } from './coords';

export interface CameraPose {
  lat: number;
  lng: number;
  /** Distance above the surface, in globe radii. */
  alt: number;
}

const MIN_ALT = 0.28;
const MAX_ALT = 9;
const IDLE_MS = 7000;

/** Orbit controls + keyboard + idle auto-rotation + smooth fly-to (great-circle slerp). */
export class CameraRig {
  readonly controls: OrbitControls;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromDist: number; toDist: number; t: number; duration: number } | null = null;
  private lastInteraction = performance.now();
  /** True once the user (or a fly-to) moved the camera: only then is the pose worth sharing. */
  userDriven = false;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    private reducedMotion: boolean,
    private readonly onChange: () => void,
  ) {
    this.controls = new OrbitControls(camera, element);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 1 + MIN_ALT;
    this.controls.maxDistance = 1 + MAX_ALT;
    this.controls.zoomSpeed = 0.7;
    this.controls.rotateSpeed = 0.45;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => this.interacted());
    this.controls.addEventListener('change', () => this.onChange());
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  interacted(): void {
    this.userDriven = true;
    this.lastInteraction = performance.now();
    this.flight = null;
    this.controls.autoRotate = false;
  }

  pose(): CameraPose {
    const p = this.camera.position;
    const { lat, lng } = xyzToLatLng(p.x, p.y, p.z);
    return { lat, lng, alt: p.length() - 1 };
  }

  setPose(pose: CameraPose, animate: boolean): void {
    const dist = 1 + clamp(pose.alt, MIN_ALT, MAX_ALT);
    const xyz = latLngToXyz(clamp(pose.lat, -85, 85), pose.lng, 1);
    const to = new THREE.Vector3(xyz[0], xyz[1], xyz[2]);
    if (!animate || this.reducedMotion) {
      this.camera.position.copy(to.multiplyScalar(dist));
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
      this.onChange();
      return;
    }
    const from = this.camera.position.clone().normalize();
    const angle = from.angleTo(to);
    this.flight = { from, to, fromDist: this.camera.position.length(), toDist: dist, t: 0, duration: 0.8 + angle * 0.5 };
    this.lastInteraction = performance.now();
    this.controls.autoRotate = false;
  }

  /** Programmatic flight that is not a user action (intro). */
  glideTo(pose: CameraPose, duration: number): void {
    const dist = 1 + clamp(pose.alt, MIN_ALT, MAX_ALT);
    const xyz = latLngToXyz(clamp(pose.lat, -85, 85), pose.lng, 1);
    this.flight = { from: this.camera.position.clone().normalize(), to: new THREE.Vector3(xyz[0], xyz[1], xyz[2]), fromDist: this.camera.position.length(), toDist: dist, t: 0, duration };
    this.lastInteraction = performance.now();
  }

  /** Backs off to at least `alt` (also retargets a flight in progress, e.g. the intro). */
  ensureAltAtLeast(alt: number, duration: number): void {
    const dist = 1 + clamp(alt, MIN_ALT, MAX_ALT);
    if (this.flight) {
      this.flight.toDist = Math.max(this.flight.toDist, dist);
      return;
    }
    const p = this.pose();
    if (p.alt < alt) this.glideTo({ ...p, alt }, duration);
  }

  flyTo(lat: number, lng: number, alt?: number): void {
    this.userDriven = true;
    // Zoom in a little towards the country, but never closer than the screen shape allows
    // (portrait phones see far less horizontally).
    const nearest = this.camera.aspect < 1 ? 2.6 / Math.max(0.35, this.camera.aspect) : 2.6;
    this.setPose({ lat, lng, alt: alt ?? Math.min(this.pose().alt, nearest) }, true);
  }

  rotateBy(dLat: number, dLng: number): void {
    const p = this.pose();
    this.interacted();
    this.setPose({ lat: p.lat + dLat, lng: p.lng + dLng, alt: p.alt }, false);
  }

  zoomBy(factor: number): void {
    const p = this.pose();
    this.interacted();
    this.setPose({ ...p, alt: p.alt * factor }, false);
  }

  update(dt: number): void {
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      slerp(f.from, f.to, e, this.tmp);
      const dist = f.fromDist + (f.toDist - f.fromDist) * e;
      this.camera.position.copy(this.tmp.multiplyScalar(dist));
      this.camera.lookAt(0, 0, 0);
      this.onChange();
      if (f.t >= 1) this.flight = null;
    } else if (!this.reducedMotion && performance.now() - this.lastInteraction > IDLE_MS) {
      this.controls.autoRotate = true;
    }
    // Slower rotation when zoomed in.
    const alt = this.camera.position.length() - 1;
    this.controls.rotateSpeed = 0.12 + 0.32 * Math.min(1, alt / 2.2);
    this.controls.update(dt);
  }

  dispose(): void {
    this.controls.dispose();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const dot = clamp(a.dot(b), -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-5) return out.copy(b);
  const so = Math.sin(omega);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * omega) / so)
    .addScaledVector(b, Math.sin(t * omega) / so)
    .normalize();
}
