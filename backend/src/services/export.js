const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');

// Visual styles only: every template renders the same Markdown. Sizes in points, colors as hex.
exports.TEMPLATES = {
  modern: { font: 'Helvetica', bold: 'Helvetica-Bold', docxFont: 'Calibri', size: 10.5, name: 20, heading: 12.5, color: '1f2a6b', center: false, rule: true, gap: 0.6 },
  classic: { font: 'Times-Roman', bold: 'Times-Bold', docxFont: 'Times New Roman', size: 11, name: 22, heading: 12, color: '000000', center: true, rule: true, gap: 0.7 },
  compact: { font: 'Helvetica', bold: 'Helvetica-Bold', docxFont: 'Arial', size: 9.5, name: 16, heading: 10.5, color: '333333', center: false, rule: false, gap: 0.35 },
};

// Resume Markdown -> [{ type: 'h1' | 'h2' | 'li' | 'p', text, header }]. Only the subset the generator emits.
// `header` marks the name/contact lines before the first section.
const plain = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|`)/g, '').replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2');

exports.parse = (markdown) => {
  let header = true;
  return markdown
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (l.startsWith('## ')) {
        header = false;
        return { type: 'h2', text: plain(l.slice(3)) };
      }
      if (l.startsWith('# ')) return { type: 'h1', text: plain(l.slice(2)), header };
      const li = l.match(/^[-*+]\s+(.*)/);
      return li ? { type: 'li', text: plain(li[1]) } : { type: 'p', text: plain(l), header };
    });
};

exports.toPdf = (blocks, out, t = exports.TEMPLATES.modern) => {
  const doc = new PDFDocument({ size: 'A4', margin: t.gap < 0.5 ? 40 : 54 });
  const color = `#${t.color}`;
  doc.pipe(out);
  for (const { type, text, header } of blocks) {
    const align = header && t.center ? 'center' : 'left';
    if (type === 'h1') doc.font(t.bold).fontSize(t.name).fillColor(color).text(text, { align }).moveDown(0.2);
    else if (type === 'h2') {
      doc.moveDown(t.gap).font(t.bold).fontSize(t.heading).fillColor(color).text(text.toUpperCase());
      if (t.rule) doc.moveTo(doc.page.margins.left, doc.y + 1).lineTo(doc.page.width - doc.page.margins.right, doc.y + 1).strokeColor(color).lineWidth(0.75).stroke();
      doc.moveDown(0.25);
    } else if (type === 'li') doc.font(t.font).fontSize(t.size).fillColor('black').text(`•  ${text}`, { indent: 10 });
    else doc.font(t.font).fontSize(t.size).fillColor('black').text(text, { align });
  }
  doc.end();
};

exports.toDocx = (blocks, t = exports.TEMPLATES.modern) => {
  const run = (text, extra) => new TextRun({ text, font: t.docxFont, size: t.size * 2, ...extra });
  const center = (header) => (header && t.center ? { alignment: AlignmentType.CENTER } : {});
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: blocks.map(({ type, text, header }) =>
            type === 'h1'
              ? new Paragraph({ heading: HeadingLevel.TITLE, ...center(header), children: [run(text, { bold: true, size: t.name * 2, color: t.color })] })
              : type === 'h2'
                ? new Paragraph({
                    heading: HeadingLevel.HEADING_2,
                    spacing: { before: Math.round(t.gap * 400), after: 80 },
                    ...(t.rule && { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: t.color, space: 1 } } }),
                    children: [run(text.toUpperCase(), { bold: true, size: t.heading * 2, color: t.color })],
                  })
                : type === 'li'
                  ? new Paragraph({ bullet: { level: 0 }, children: [run(text)] })
                  : new Paragraph({ ...center(header), children: [run(text)] })
          ),
        },
      ],
    })
  );
};
