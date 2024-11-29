export async function decompressGzipped(data: Uint8Array): Promise<Uint8Array> {
    try {
        const stream = new Response(data).body;
        if (!stream) throw new Error('Failed to create stream from data');

        return await decompressGzipStream(stream);
    } catch (error) {
        console.error('Error decompressing gzipped data:', error);
        throw error;
    }
}

export async function decompressGzipStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const response = new Response(decompressedStream);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();

    return new Uint8Array(buffer);
}

export async function compressGzipped(data: Uint8Array): Promise<Uint8Array> {
    try {
        const stream = new Response(data).body;
        if (!stream) throw new Error('Failed to create stream from data');

        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const response = new Response(compressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();

        return new Uint8Array(buffer);
    } catch (error) {
        console.error('Error compressing gzipped data:', error);
        throw error;
    }
}
