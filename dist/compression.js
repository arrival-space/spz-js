import { decompress as zstdDecompress } from 'fzstd';
const createStream = (data) => {
    return new ReadableStream({
        async start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    });
};
export async function decompressGzipped(data) {
    try {
        const stream = createStream(data);
        if (!stream)
            throw new Error('Failed to create stream from data');
        return await decompressGzipStream(stream);
    }
    catch (error) {
        console.error('Error decompressing gzipped data:', error);
        throw error;
    }
}
export async function decompressGzipStream(stream) {
    const decompressor = new DecompressionStream('gzip');
    const decompressedStream = stream.pipeThrough(decompressor);
    const response = new Response(decompressedStream);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}
export async function compressGzipped(data) {
    try {
        const stream = createStream(data);
        const compressor = new CompressionStream('gzip');
        const compressedStream = stream.pipeThrough(compressor);
        const response = new Response(compressedStream);
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    }
    catch (error) {
        console.error('Error compressing gzipped data:', error);
        throw error;
    }
}
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
export function decompressZstd(data, uncompressedSize) {
    const out = zstdDecompress(data, uncompressedSize > 0 ? new Uint8Array(uncompressedSize) : undefined);
    if (out.length !== uncompressedSize) {
        throw new Error(`ZSTD stream decompressed to ${out.length} bytes, expected ${uncompressedSize}`);
    }
    return out;
}
