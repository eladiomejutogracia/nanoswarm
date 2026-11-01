import * as THREE from 'three';
import type { PointerState } from '../backends/physics';

/**
 * Tracks the pointer as a 3D point on the plane through the origin that
 * faces the camera — so it "touches" the middle of the swarm. Inactive
 * while a button is held (the user is orbiting) or when disabled.
 * Reuses its vectors: pointermove fires a lot.
 */
export class PointerTracker {
    readonly state: PointerState = { active: false, x: 0, y: 0, z: 0 };

    private readonly raycaster = new THREE.Raycaster();
    private readonly ndc = new THREE.Vector2();
    private readonly normal = new THREE.Vector3();
    private readonly plane = new THREE.Plane();
    private readonly hit = new THREE.Vector3();
    private pressed = false;

    constructor(
        private readonly element: HTMLElement,
        private readonly camera: THREE.Camera,
        private enabled = true,
    ) {
        element.addEventListener('pointermove', this.onMove);
        element.addEventListener('pointerdown', this.onDown);
        element.addEventListener('pointerleave', this.onLeave);
        window.addEventListener('pointerup', this.onUp);
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) this.state.active = false;
    }

    dispose(): void {
        this.element.removeEventListener('pointermove', this.onMove);
        this.element.removeEventListener('pointerdown', this.onDown);
        this.element.removeEventListener('pointerleave', this.onLeave);
        window.removeEventListener('pointerup', this.onUp);
    }

    private readonly onMove = (event: PointerEvent): void => {
        if (!this.enabled || this.pressed) {
            this.state.active = false;
            return;
        }
        const rect = this.element.getBoundingClientRect();
        this.ndc.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.ndc, this.camera);
        this.plane.set(this.camera.getWorldDirection(this.normal), 0);
        const hit = this.raycaster.ray.intersectPlane(this.plane, this.hit);
        this.state.active = hit !== null;
        if (hit) {
            this.state.x = hit.x;
            this.state.y = hit.y;
            this.state.z = hit.z;
        }
    };

    private readonly onDown = (): void => {
        this.pressed = true;
        this.state.active = false;
    };

    private readonly onUp = (): void => {
        this.pressed = false;
    };

    private readonly onLeave = (): void => {
        this.state.active = false;
    };
}
