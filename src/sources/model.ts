import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalizePoints } from './params';

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'ply';
export type ModelInput = string | File | Blob | ArrayBuffer;

const EXTENSION_RE = /\.(glb|gltf|obj|stl|ply)$/i;

export function detectModelFormat(name: string): ModelFormat | null {
    // Drop "?query" and "#hash" first: one regex doing both can take quadratic time on hostile URLs.
    const path = name.split(/[?#]/, 1)[0];
    const match = EXTENSION_RE.exec(path);
    return match ? (match[1].toLowerCase() as ModelFormat) : null;
}

/**
 * Collapse every mesh in a scene graph into one non-indexed geometry
 * with world transforms applied (position attribute only).
 */
export function flattenToGeometry(root: THREE.Object3D): THREE.BufferGeometry {
    root.updateWorldMatrix(true, true);
    const parts: THREE.BufferGeometry[] = [];
    root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', mesh.geometry.attributes.position.clone());
        if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
        geometry.applyMatrix4(mesh.matrixWorld);
        parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
    });
    if (parts.length === 0) throw new Error('[NanoSwarm] The model contains no meshes.');
    const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!merged) throw new Error('[NanoSwarm] Could not merge the model meshes.');
    return merged;
}

/**
 * Sample `count` points uniformly over the surface area of a geometry.
 * Point-only models (PLY scans without faces) are resampled from their vertices.
 */
export function sampleSurface(geometry: THREE.BufferGeometry, count: number): Float32Array {
    const out = new Float32Array(count * 3);
    const position = geometry.attributes.position;
    const hasFaces = (geometry.index?.count ?? position.count) >= 3 && !(geometry.userData.pointsOnly === true);

    if (hasFaces) {
        const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build();
        const p = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
            sampler.sample(p);
            out[i * 3] = p.x;
            out[i * 3 + 1] = p.y;
            out[i * 3 + 2] = p.z;
        }
    } else {
        for (let i = 0; i < count; i++) {
            const src = Math.floor((i * position.count) / count);
            out[i * 3] = position.getX(src);
            out[i * 3 + 1] = position.getY(src);
            out[i * 3 + 2] = position.getZ(src);
        }
    }
    return normalizePoints(out);
}

async function readBuffer(input: ModelInput): Promise<{ buffer: ArrayBuffer; name: string }> {
    if (input instanceof ArrayBuffer) return { buffer: input, name: '' };
    if (typeof input === 'string') {
        const response = await fetch(input);
        if (!response.ok) throw new Error(`[NanoSwarm] Could not load model "${input}" (${response.status}).`);
        return { buffer: await response.arrayBuffer(), name: input };
    }
    return { buffer: await input.arrayBuffer(), name: 'name' in input ? (input as File).name : '' };
}

/** Load a 3D model file and return it as a single geometry ready for sampling. */
export async function loadModelGeometry(input: ModelInput, format?: ModelFormat): Promise<THREE.BufferGeometry> {
    const { buffer, name } = await readBuffer(input);
    const kind = format ?? detectModelFormat(name);
    if (!kind) throw new Error('[NanoSwarm] Unknown model format. Pass { format } or use a .glb/.gltf/.obj/.stl/.ply file.');

    switch (kind) {
    case 'glb':
    case 'gltf': {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().parseAsync(buffer, '');
        return flattenToGeometry(gltf.scene);
    }
    case 'obj': {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        return flattenToGeometry(new OBJLoader().parse(new TextDecoder().decode(buffer)));
    }
    case 'stl': {
        const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
        return new STLLoader().parse(buffer);
    }
    case 'ply': {
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        const geometry = new PLYLoader().parse(buffer);
        if (!geometry.index) geometry.userData.pointsOnly = true;
        return geometry;
    }
    }
}
