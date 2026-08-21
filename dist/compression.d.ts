export declare function decompressGzipped(data: Uint8Array): Promise<Uint8Array>;
export declare function decompressGzipStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array>;
export declare function compressGzipped(data: Uint8Array): Promise<Uint8Array>;
/**
 * Decompress a single ZSTD frame (SPZ v4 stores every attribute stream as one).
 *
 * There is no web-standard 'zstd' DecompressionStream, so this uses fzstd - a
 * pure-JS decoder that runs unchanged in the browser and in Node, with no wasm
 * to host alongside the library.
 *
 * @param data - The compressed frame.
 * @param uncompressedSize - Expected size, taken from the stream's table of
 *   contents entry; a mismatch means the file is corrupt.
 */
export declare function decompressZstd(data: Uint8Array, uncompressedSize: number): Uint8Array;
