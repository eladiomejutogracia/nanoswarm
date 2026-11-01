import * as THREE from 'three';

/** Suggested framing for a shape: how high the camera sits and how far away. */
export interface View {
    /** Degrees above the horizon (0 = side view, 90 = top-down). */
    elevation: number;
    distance: number;
}

export const DEFAULT_VIEW: View = { elevation: 11, distance: 13 };

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * Glides the camera to a View, keeping its current azimuth (the user's
 * left-right orbit) so the change feels like a tilt, not a jump.
 */
export class ViewTween {
    private readonly from = new THREE.Spherical();
    private readonly to = new THREE.Spherical();
    private readonly current = new THREE.Spherical(); // scratch, reused every frame
    private progress = 1;

    constructor(private readonly camera: THREE.Camera, private readonly seconds = 1.2) {}

    get active(): boolean {
        return this.progress < 1;
    }

    start(view: View): void {
        this.from.setFromVector3(this.camera.position);
        this.to.set(view.distance, THREE.MathUtils.degToRad(90 - view.elevation), this.from.theta);
        this.progress = 0;
    }

    cancel(): void {
        this.progress = 1;
    }

    /** Advance; call before OrbitControls.update(). */
    update(dt: number): void {
        if (this.progress >= 1) return;
        this.progress = Math.min(1, this.progress + dt / this.seconds);
        const k = easeInOut(this.progress);
        // Azimuth is read live, so auto-rotate keeps turning during the glide.
        const theta = Math.atan2(this.camera.position.x, this.camera.position.z);
        this.current.set(
            THREE.MathUtils.lerp(this.from.radius, this.to.radius, k),
            THREE.MathUtils.lerp(this.from.phi, this.to.phi, k),
            theta,
        );
        this.camera.position.setFromSpherical(this.current);
    }
}
