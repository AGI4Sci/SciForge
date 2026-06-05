#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';

import { mainChatImageUnderstandingLiveMatrixCases } from './main-chat-image-understanding-live-matrix-cases.js';

type Rgba = [number, number, number, number];

type RasterImage = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

const white: Rgba = [250, 252, 255, 255];
const ink: Rgba = [26, 35, 50, 255];
const blue: Rgba = [49, 111, 211, 255];
const teal: Rgba = [20, 151, 133, 255];
const red: Rgba = [211, 71, 82, 255];
const amber: Rgba = [225, 159, 42, 255];
const purple: Rgba = [117, 86, 196, 255];
const gray: Rgba = [130, 143, 160, 255];
const paleGray: Rgba = [232, 237, 244, 255];

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = makeCrcTable();

export async function generateMainChatImageUnderstandingMaterials() {
  for (const matrixCase of mainChatImageUnderstandingLiveMatrixCases) {
    const image = imageForCase(matrixCase.id, matrixCase.material.width, matrixCase.material.height);
    await writePng(matrixCase.material.ref, image);
    const bytes = await import('node:fs/promises').then((fs) => fs.readFile(matrixCase.material.ref));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    process.stdout.write(`${matrixCase.id} ${matrixCase.material.ref} ${digest}\n`);
  }
}

function imageForCase(caseId: string, width: number, height: number) {
  if (caseId === 'scientific-chart-legend-axis') return scientificChart(width, height);
  if (caseId === 'microscopy-experimental-contrast') return microscopyPanel(width, height);
  if (caseId === 'ui-screenshot-state') return uiScreenshot(width, height);
  if (caseId === 'dense-annotated-small-text') return denseAnnotatedImage(width, height);
  throw new Error(`Unknown material case: ${caseId}`);
}

function createImage(width: number, height: number, background: Rgba = white): RasterImage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const image = { width, height, pixels };
  fillRect(image, 0, 0, width, height, background);
  return image;
}

function scientificChart(width: number, height: number) {
  const image = createImage(width, height);
  fillRect(image, 90, 70, width - 150, height - 145, [255, 255, 255, 255]);
  strokeRect(image, 90, 70, width - 150, height - 145, paleGray, 3);
  for (let i = 0; i <= 6; i += 1) {
    const y = 110 + i * 88;
    line(image, 150, y, width - 120, y, [226, 232, 240, 255], 2);
    drawText(image, `${120 - i * 20}`, 98, y - 10, gray, 3);
  }
  line(image, 150, height - 160, width - 120, height - 160, ink, 4);
  line(image, 150, height - 160, 150, 100, ink, 4);
  drawText(image, 'RESPONSE BY CONDITION', 420, 35, ink, 5);
  drawText(image, 'TIMEPOINT', 560, height - 92, ink, 4);
  drawText(image, 'MEAN SIGNAL', 22, 325, ink, 3);
  const xs = [210, 360, 510, 660, 810, 960, 1110];
  const control = [560, 525, 490, 455, 415, 390, 360];
  const treated = [555, 485, 415, 340, 275, 230, 185];
  for (let i = 0; i < xs.length - 1; i += 1) {
    line(image, xs[i], control[i], xs[i + 1], control[i + 1], blue, 5);
    line(image, xs[i], treated[i], xs[i + 1], treated[i + 1], red, 5);
  }
  for (let i = 0; i < xs.length; i += 1) {
    circle(image, xs[i], control[i], 9, blue);
    circle(image, xs[i], treated[i], 9, red);
    line(image, xs[i], treated[i] - 28, xs[i], treated[i] + 28, red, 2);
    line(image, xs[i] - 14, treated[i] - 28, xs[i] + 14, treated[i] - 28, red, 2);
    line(image, xs[i] - 14, treated[i] + 28, xs[i] + 14, treated[i] + 28, red, 2);
    drawText(image, `D${i}`, xs[i] - 16, height - 135, gray, 3);
  }
  fillRect(image, width - 360, 105, 235, 92, [255, 255, 255, 240]);
  strokeRect(image, width - 360, 105, 235, 92, paleGray, 2);
  fillRect(image, width - 335, 132, 35, 10, blue);
  drawText(image, 'CONTROL', width - 285, 124, ink, 3);
  fillRect(image, width - 335, 166, 35, 10, red);
  drawText(image, 'TREATED', width - 285, 158, ink, 3);
  return image;
}

function microscopyPanel(width: number, height: number) {
  const image = createImage(width, height, [17, 24, 39, 255]);
  drawText(image, 'EXPERIMENTAL MICROSCOPY PANEL', 275, 36, [235, 244, 255, 255], 5);
  const panels = [
    { x: 90, y: 110, label: 'CONTROL', color: teal },
    { x: 650, y: 110, label: 'TREATED', color: purple },
  ];
  for (const panel of panels) {
    fillRect(image, panel.x, panel.y, 500, 520, [12, 18, 30, 255]);
    strokeRect(image, panel.x, panel.y, 500, 520, [80, 92, 117, 255], 3);
    drawText(image, panel.label, panel.x + 170, panel.y + 25, [229, 236, 246, 255], 4);
    for (let i = 0; i < 110; i += 1) {
      const cx = panel.x + 35 + ((i * 67) % 430);
      const cy = panel.y + 85 + ((i * 43) % 390);
      const radius = 5 + (i % 9);
      const tint = i % 3 === 0 ? panel.color : i % 3 === 1 ? amber : blue;
      circle(image, cx, cy, radius, [...tint.slice(0, 3), 95 + (i % 4) * 32] as Rgba);
    }
    for (let i = 0; i < 18; i += 1) {
      const cx = panel.x + 70 + ((i * 131) % 370);
      const cy = panel.y + 120 + ((i * 79) % 350);
      circle(image, cx, cy, 22 + (i % 4) * 3, [...panel.color.slice(0, 3), 180] as Rgba);
      line(image, cx - 28, cy, cx + 28, cy, [240, 246, 255, 210], 2);
      line(image, cx, cy - 28, cx, cy + 28, [240, 246, 255, 210], 2);
    }
  }
  fillRect(image, 100, 655, 1080, 80, [28, 38, 58, 255]);
  drawText(image, 'ANNOTATIONS: bright puncta, nuclei outlines, contrast shift in treated sample', 125, 682, [232, 240, 252, 255], 3);
  return image;
}

function uiScreenshot(width: number, height: number) {
  const image = createImage(width, height, [244, 247, 251, 255]);
  fillRect(image, 0, 0, width, 72, [31, 41, 58, 255]);
  drawText(image, 'SCIFORGE WORKBENCH', 36, 24, [241, 245, 249, 255], 4);
  fillRect(image, 40, 105, 255, 720, [255, 255, 255, 255]);
  strokeRect(image, 40, 105, 255, 720, [215, 222, 235, 255], 2);
  drawText(image, 'PROJECTS', 68, 132, ink, 3);
  for (let i = 0; i < 9; i += 1) {
    fillRect(image, 70, 182 + i * 62, 185, 32, i === 2 ? [215, 232, 255, 255] : [239, 243, 248, 255]);
    drawText(image, i === 2 ? 'ACTIVE RUN' : `THREAD ${i + 1}`, 90, 190 + i * 62, i === 2 ? blue : gray, 2);
  }
  fillRect(image, 340, 115, 690, 640, [255, 255, 255, 255]);
  strokeRect(image, 340, 115, 690, 640, [215, 222, 235, 255], 2);
  drawText(image, 'CHAT', 370, 145, ink, 4);
  fillRect(image, 385, 210, 580, 92, [239, 246, 255, 255]);
  drawText(image, 'USER: compare the uploaded chart', 410, 238, ink, 3);
  fillRect(image, 385, 330, 580, 160, [248, 250, 252, 255]);
  drawText(image, 'ASSISTANT THOUGHT', 410, 355, teal, 3);
  drawText(image, 'WORKED 4 STEPS  STATUS: RUNNING', 410, 395, gray, 3);
  fillRect(image, 385, 600, 520, 78, [255, 255, 255, 255]);
  strokeRect(image, 385, 600, 520, 78, [196, 208, 224, 255], 2);
  drawText(image, 'Plan  Ask  Debug  Multitask  Image  Models', 410, 627, ink, 3);
  fillRect(image, 1070, 115, 310, 640, [255, 255, 255, 255]);
  strokeRect(image, 1070, 115, 310, 640, [215, 222, 235, 255], 2);
  drawText(image, 'REFERENCES', 1100, 145, ink, 3);
  for (let i = 0; i < 6; i += 1) {
    fillRect(image, 1100, 195 + i * 78, 230, 45, [246, 248, 251, 255]);
    drawText(image, `ref:${i + 1} status ${i % 2 ? 'ready' : 'live'}`, 1120, 210 + i * 78, gray, 2);
  }
  return image;
}

function denseAnnotatedImage(width: number, height: number) {
  const image = createImage(width, height, [252, 251, 246, 255]);
  drawText(image, 'DENSE ANNOTATED FIELD MAP', 470, 28, ink, 5);
  strokeRect(image, 80, 95, width - 160, height - 190, [195, 182, 160, 255], 3);
  for (let x = 120; x < width - 100; x += 95) line(image, x, 115, x, height - 130, [231, 222, 204, 255], 1);
  for (let y = 135; y < height - 125; y += 75) line(image, 100, y, width - 100, y, [231, 222, 204, 255], 1);
  for (let i = 0; i < 85; i += 1) {
    const x = 120 + ((i * 137) % (width - 260));
    const y = 140 + ((i * 91) % (height - 310));
    const color = [blue, teal, red, amber, purple][i % 5];
    circle(image, x, y, 8 + (i % 4), color);
    if (i % 3 === 0) drawText(image, `L${i}`, x + 14, y - 9, ink, 2);
    if (i % 7 === 0) {
      line(image, x, y, x + 52, y - 36, ink, 1);
      drawText(image, `ZONE-${String.fromCharCode(65 + (i % 26))}`, x + 58, y - 46, gray, 2);
    }
  }
  fillRect(image, 1150, 145, 310, 245, [255, 255, 255, 235]);
  strokeRect(image, 1150, 145, 310, 245, [203, 213, 225, 255], 2);
  drawText(image, 'LEGEND', 1190, 170, ink, 3);
  for (let i = 0; i < 5; i += 1) {
    const color = [blue, teal, red, amber, purple][i];
    circle(image, 1190, 215 + i * 34, 8, color);
    drawText(image, `CLASS ${i + 1}  N=${18 + i * 7}`, 1215, 204 + i * 34, ink, 2);
  }
  drawText(image, 'SMALL TEXT CONFIDENCE: MIXED', 103, height - 92, red, 3);
  drawText(image, 'AXIS X: REGION INDEX     AXIS Y: SIGNAL LOCALITY', 104, height - 58, ink, 3);
  return image;
}

function fillRect(image: RasterImage, x: number, y: number, width: number, height: number, color: Rgba) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(image.width, Math.ceil(x + width));
  const y1 = Math.min(image.height, Math.ceil(y + height));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) setPixel(image, px, py, color);
  }
}

function strokeRect(image: RasterImage, x: number, y: number, width: number, height: number, color: Rgba, size = 1) {
  fillRect(image, x, y, width, size, color);
  fillRect(image, x, y + height - size, width, size, color);
  fillRect(image, x, y, size, height, color);
  fillRect(image, x + width - size, y, size, height, color);
}

function line(image: RasterImage, x0: number, y0: number, x1: number, y1: number, color: Rgba, size = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    fillRect(image, x0 + (x1 - x0) * t - size / 2, y0 + (y1 - y0) * t - size / 2, size, size, color);
  }
}

function circle(image: RasterImage, cx: number, cy: number, radius: number, color: Rgba) {
  const r2 = radius * radius;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= r2) setPixel(image, cx + x, cy + y, color);
    }
  }
}

function drawText(image: RasterImage, text: string, x: number, y: number, color: Rgba, scale = 2) {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    if (raw === ' ') {
      cursor += 4 * scale;
      continue;
    }
    const glyph = glyphs[raw] ?? glyphs['?'];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === '1') fillRect(image, cursor + column * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += 6 * scale;
  }
}

function setPixel(image: RasterImage, x: number, y: number, color: Rgba) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
  const index = (py * image.width + px) * 4;
  const alpha = color[3] / 255;
  image.pixels[index] = Math.round(color[0] * alpha + image.pixels[index] * (1 - alpha));
  image.pixels[index + 1] = Math.round(color[1] * alpha + image.pixels[index + 1] * (1 - alpha));
  image.pixels[index + 2] = Math.round(color[2] * alpha + image.pixels[index + 2] * (1 - alpha));
  image.pixels[index + 3] = 255;
}

async function writePng(path: string, image: RasterImage) {
  await mkdir(dirname(path), { recursive: true });
  const scanlineLength = image.width * 4 + 1;
  const raw = Buffer.alloc(scanlineLength * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * scanlineLength] = 0;
    const rowStart = y * scanlineLength + 1;
    const sourceStart = y * image.width * 4;
    raw.set(image.pixels.subarray(sourceStart, sourceStart + image.width * 4), rowStart);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  await writeFile(path, Buffer.concat([
    pngSignature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const glyphs: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
};

if (process.argv[1]?.endsWith('generate-main-chat-image-understanding-materials.ts')) {
  await generateMainChatImageUnderstandingMaterials();
}
