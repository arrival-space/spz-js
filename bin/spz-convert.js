#!/usr/bin/env node

import { program } from "commander";
import { createReadStream, existsSync, writeFileSync } from 'fs';
import path from "path";
import { Readable } from 'stream';
import { loadPly } from "../dist/ply-loader.js";
import { serializeSpz } from "../dist/spz-serializer.js";

const loadPlyFile = async (file) => {
  const extension = path.extname(file);
  if (extension === ".ply") {
    const fileStream = createReadStream(file);
    const webStream = Readable.toWeb(fileStream);
    return await loadPly(webStream);
  }
  throw new Error(`Unsupported file extension: ${extension}`);
};

program
  .name("spz-convert")
  .description("Convert a .ply file from one format to another")
  .usage("spz-convert input.ply compressed.spz")
  .argument("<input>", "Input .ply file")
  .argument("<output>", "Output .spz file")
  .action(async (inputFile, outputFile) => {
    if (!existsSync(inputFile)) {
      console.error(`Error: File "${inputFile}" not found.`);
      process.exit(1);
    }

    console.log(`Converting "${inputFile}" to "${outputFile}"...`);
    const plyData = await loadPlyFile(inputFile);
    const spzData = await serializeSpz(plyData);
    writeFileSync(outputFile, Buffer.from(spzData));
    console.log(`Converted ${inputFile} to ${outputFile}`);
  });

// Parse arguments
program.parse(process.argv);

