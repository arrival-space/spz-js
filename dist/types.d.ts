export type Vec3f = [number, number, number];
export type Quat4f = [number, number, number, number];
export type Half = number;
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
