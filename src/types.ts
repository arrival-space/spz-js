// Core types and interfaces
export type Vec3f = [number, number, number];
export type Quat4f = [number, number, number, number]; // w, x, y, z
export type Half = number; // uint16 in TypeScript

export interface SpzFloatBuffer {
    count: number;
    data: Float32Array;
}

export interface GaussianCloudData {
    numPoints: number;
    shDegree: number;
    antialiased: boolean;
    positions: SpzFloatBuffer;
    scales: SpzFloatBuffer;
    rotations: SpzFloatBuffer;
    alphas: SpzFloatBuffer;
    colors: SpzFloatBuffer;
    sh: SpzFloatBuffer;
}

export interface UnpackedGaussian {
    position: Vec3f;
    rotation: Quat4f;
    scale: Vec3f;
    color: Vec3f;
    alpha: number;
    shR: number[];
    shG: number[];
    shB: number[];
}

export interface PackedGaussian {
    position: Uint8Array;
    rotation: Uint8Array;
    scale: Uint8Array;
    color: Uint8Array;
    alpha: number;
    shR: Uint8Array;
    shG: Uint8Array;
    shB: Uint8Array;
}

export interface PackedGaussians {
    numPoints: number;
    shDegree: number;
    fractionalBits: number;
    antialiased: boolean;
    positions: Uint8Array;
    scales: Uint8Array;
    rotations: Uint8Array;
    alphas: Uint8Array;
    colors: Uint8Array;
    sh: Uint8Array;
}

export interface GaussianCloud {
    numPoints: number;
    shDegree: number;
    antialiased: boolean;
    positions: Float32Array;
    scales: Float32Array;
    rotations: Float32Array;
    alphas: Float32Array;
    colors: Float32Array;
    sh: Float32Array;
}