# 图标生成工具

## 设计说明

**方案 A+B 组合**：N-Channel MOSFET 符号 + Id-Vg 曲线元素

### 设计元素
- **MOSFET 符号**：G（栅极）、D（漏极）、S（源极）三端子
- **沟道表示**：三段短线（增强型 MOSFET）
- **曲线暗示**：右上角的 S 型曲线（Id-Vg 特性）
- **配色**：主题色 #0D7F8F（深青绿）

### 使用方法

#### 自动生成（推荐）

```bash
cd icon-tools
npm install
npm run generate-icons
```

这会生成所有尺寸的 PNG 文件。

#### 手动生成 ICO 和 ICNS

1. **Windows ICO**：
   - 访问 https://convertio.co/png-ico/
   - 上传 `src-tauri/icons/icon.png` (256×256)
   - 下载并替换 `src-tauri/icons/icon.ico`

2. **macOS ICNS**：
   - 访问 https://cloudconvert.com/png-to-icns
   - 上传 `src-tauri/icons/1024x1024.png`
   - 下载并替换 `src-tauri/icons/icon.icns`

### 文件清单

生成后应包含：
- `icon.svg` - SVG 源文件（已创建）
- `32x32.png` - 小图标
- `64x64.png` - 中等图标
- `128x128.png` - 标准图标
- `128x128@2x.png` - 高清图标
- `icon.png` - 通用图标 (256×256)
- `512x512.png` - 大尺寸
- `1024x1024.png` - 超大尺寸
- `icon.ico` - Windows 图标（需手动生成）
- `icon.icns` - macOS 图标（需手动生成）

### 预览

打开 `src-tauri/icons/icon.svg` 可以预览设计效果。

### 修改设计

如需调整，直接编辑 `icon.svg`：
- 线条粗细：修改 `stroke-width` 属性
- 颜色：修改 `stroke` 和 `fill` 的颜色值
- 布局：调整 `transform` 的 `translate` 值
