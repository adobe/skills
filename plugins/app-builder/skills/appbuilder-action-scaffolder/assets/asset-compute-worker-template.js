'use strict';

const { worker, SourceCorruptError } = require('@adobe/asset-compute-sdk');
const fs = require('fs').promises;

exports.main = worker(async (source, rendition) => {
  try {
    if (!source || !source.path) {
      throw new Error('source.path is required');
    }

    if (!rendition || !rendition.path) {
      throw new Error('rendition.path is required');
    }

    const stats = await fs.stat(source.path);
    if (stats.size === 0) {
      throw new SourceCorruptError('Source file is empty.');
    }

    console.log('Asset Compute worker invoked', JSON.stringify({
      sourcePath: source.path,
      renditionPath: rendition.path,
      instructions: rendition.instructions || {}
    }));

    // Replace this copy step with your actual transformation logic.
    await fs.copyFile(source.path, rendition.path);

    console.log('Rendition generated successfully', JSON.stringify({
      bytesProcessed: stats.size,
      outputPath: rendition.path
    }));
  } catch (error) {
    console.error('Asset Compute worker failed', error.message);
    throw error;
  }
});