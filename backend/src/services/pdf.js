const { PDFParse } = require('pdf-parse');

const MIN_CHARS = 30;

// Returns the PDF's text, or '' when there is effectively none (e.g. a scanned image-only PDF).
exports.extractText = async (buffer) => {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    // pdf-parse inserts "-- 1 of 2 --" page markers even for pages without any text.
    const text = (await parser.getText()).text.replace(/^-- \d+ of \d+ --$/gm, '').trim();
    return text.length >= MIN_CHARS ? text : '';
  } finally {
    await parser.destroy();
  }
};
