# Library to convert gaussian splats between PLY and SPZ formats

Based on the [original C++ library](https://github.com/nianticlabs/spz).

## Installation

[![NPM](https://nodei.co/npm/spz-js.png)](https://npmjs.org/package/spz-js)

```bash
npm install spz-js
```

## Example (Node.js)

```javascript
import {
    createReadStream,
    readFileSync,
    writeFileSync,
    unlinkSync
} from 'fs';
import { Readable } from 'stream';
import path from 'path';

import {
    loadPly,
    loadSpz,
    serializePly,
    serializeSpz
} from 'spz-js';

// Helper function to load either SPZ or PLY files
const loadFile = async (file) => {
    const extension = path.extname(file);
    if (extension === '.spz') {
        const fileBuffer = readFileSync(file);
        return await loadSpz(fileBuffer);
    } else if (extension === '.ply') {
        const fileStream = createReadStream(file);
        const webStream = Readable.toWeb(fileStream);
        return await loadPly(webStream);
    }
    throw new Error(`Unsupported file extension: ${extension}`);
};

const gs = await loadFile("gs.ply"); // or gs.spz

const plyData = serializePly(gs);
writeFileSync("gs.ply", Buffer.from(plyData));

const spzData = await serializeSpz(gs);
writeFileSync("gs.spz", Buffer.from(spzData));
```

## Example (Browser)

```javascript
import {
    loadPly,
    loadSpz
} from 'spz-js';

const loadFile = async (url) => {
    const response = await fetch(url);
    const extension = url.split('.').pop();
    
    if (extension === 'spz') {
        const buffer = await response.arrayBuffer();
        return await loadSpz(buffer);
    } else if (extension === 'ply') {
        return await loadPly(response.body);
    }
    throw new Error(`Unsupported file extension: ${extension}`);
};
```
## SPZ format support

| Version | Container | Rotations | Read | Write |
| --- | --- | --- | --- | --- |
| 1 | gzip, 16-byte header | 3 bytes (xyz, `w` derived) | ✅ | — |
| 2 | gzip, 16-byte header | 3 bytes (xyz, `w` derived) | ✅ | ✅ |
| 3 | gzip, 16-byte header | 4 bytes (smallest three) | ✅ | — |
| 4 | plaintext 32-byte header + TOC + per-attribute ZSTD | 4 bytes (smallest three) | ✅ | — |

`loadSpz` detects the container from the file itself, so callers do not need to
know the version: v1–3 begin with the gzip magic, while v4 leaves its header
uncompressed and starts with `NGSP`.

`serializeSpz` writes version 2 — the last version a pure-JS library can produce
without shipping a ZSTD *compressor*. Reading v4 only needs a decompressor, which
[fzstd](https://github.com/101arrowz/fzstd) provides in ~10 KB of dependency-free
JavaScript that runs the same in the browser and in Node.

Two v4 details worth knowing:

- **Extensions** (header flag `0x2`) are skipped. They sit between the header and
  the table of contents, and the TOC offset already points past them.
- **SH degree 4** (24 coefficients per channel) has no representation in this
  library's `GaussianCloud`, which stops at degree 3. Such a file is read at
  degree 3, keeping the first 15 coefficients of each channel, rather than being
  rejected.

## Tests

```bash
npm run build && npm test
```

The suite builds v2, v3 and v4 fixtures from the same source cloud and checks
that they decode to the same splats, plus the v4-specific cases (no SH, SH
degree 4, extension records) and a set of malformed files that must be rejected.
