// 图标生成脚本 - 将 SVG 转换为多尺寸 PNG
// 使用方法：
// 1. cd icon-tools
// 2. npm install
// 3. npm run generate-icons

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SVG_PATH = resolve(__dirname, '../src-tauri/icons/icon.svg');
const OUTPUT_DIR = resolve(__dirname, '../src-tauri/icons');

// 需要生成的尺寸
const SIZES = [
  { size: 32, name: '32x32.png' },
  { size: 64, name: '64x64.png' },
  { size: 128, name: '128x128.png' },
  { size: 256, name: '128x128@2x.png' },
  { size: 256, name: 'icon.png' },
  { size: 512, name: '512x512.png' },
  { size: 1024, name: '1024x1024.png' },
];

async function generateIcons() {
  console.log('📐 读取 SVG 源文件...');
  const svgBuffer = readFileSync(SVG_PATH);

  for (const { size, name } of SIZES) {
    console.log(`🎨 生成 ${name} (${size}×${size})...`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(resolve(OUTPUT_DIR, name));
  }

  console.log('✅ 所有 PNG 图标生成完成！');
  console.log('\n📝 下一步：');
  console.log('1. 使用在线工具生成 icon.ico (Windows):');
  console.log('   https://convertio.co/png-ico/');
  console.log('   上传 icon.png (256×256)');
  console.log('\n2. 使用在线工具生成 icon.icns (macOS):');
  console.log('   https://cloudconvert.com/png-to-icns');
  console.log('   上传 1024x1024.png');
}

generateIcons().catch(err => {
  console.error('❌ 生成失败:', err);
  process.exit(1);
});
