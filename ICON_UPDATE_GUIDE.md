# 图标更新指南

**日期**: 2026-07-08  
**设计方案**: A+B 组合 - MOSFET 符号 + Id-Vg 曲线

---

## 📁 已创建的文件

```
SpiceBuilder/
├── src-tauri/icons/
│   └── icon.svg          ← 新设计的 SVG 源文件
└── icon-tools/
    ├── package.json      ← 依赖配置
    ├── generate-icons.js ← 自动生成脚本
    └── README.md         ← 使用说明
```

---

## 🎨 设计说明

### 视觉元素

**主体**：N-Channel MOSFET 符号
- **G (Gate)**：左侧栅极，带绝缘层
- **D (Drain)**：上方漏极，略带曲线
- **S (Source)**：下方源极
- **沟道**：三段短线（增强型 MOSFET）
- **衬底箭头**：向上箭头表示 N 沟道

**辅助元素**：Id-Vg 曲线
- 右上角的 S 型曲线
- 透明度 70%，暗示数据拟合功能

**配色**：
- 主色：`#0D7F8F`（与应用主题一致）
- 背景：白色圆角矩形
- 边框：半透明主色

---

## 🚀 快速开始

### 方法 1：自动生成（推荐）

```bash
# 1. 进入工具目录
cd icon-tools

# 2. 安装依赖
npm install

# 3. 生成 PNG 图标
npm run generate-icons
```

**输出文件**：
- `32x32.png`
- `64x64.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.png` (256×256)
- `512x512.png`
- `1024x1024.png`

### 方法 2：手动生成

如果不想安装 Node.js 依赖：

1. **在线转换 PNG**：
   - 访问 https://cloudconvert.com/svg-to-png
   - 上传 `src-tauri/icons/icon.svg`
   - 设置输出尺寸：32, 64, 128, 256, 512, 1024
   - 批量下载并重命名

2. **生成 Windows 图标 (.ico)**：
   - 访问 https://convertio.co/png-ico/
   - 上传 `icon.png` (256×256)
   - 下载 `icon.ico`

3. **生成 macOS 图标 (.icns)**：
   - 访问 https://cloudconvert.com/png-to-icns
   - 上传 `1024x1024.png`
   - 下载 `icon.icns`

---

## 📋 生成后的文件清单

在 `src-tauri/icons/` 目录下应包含：

```
✅ icon.svg           - SVG 源文件（已创建）
⏳ 32x32.png          - 小图标
⏳ 64x64.png          - 中等图标
⏳ 128x128.png        - 标准图标
⏳ 128x128@2x.png     - 高清图标
⏳ icon.png           - 通用图标 (256×256)
⏳ 512x512.png        - 大尺寸
⏳ 1024x1024.png      - 超大尺寸
⏳ icon.ico           - Windows 图标（需手动生成）
⏳ icon.icns          - macOS 图标（需手动生成）
```

---

## 🔧 修改设计

如需调整图标设计，直接编辑 `src-tauri/icons/icon.svg`：

### 调整线条粗细
```xml
<line ... stroke-width="12" />  ← 改为 10 或 14
```

### 调整颜色
```xml
stroke="#0D7F8F"  ← 改为其他颜色
```

### 调整布局
```xml
<g transform="translate(256, 256)">  ← 改变中心位置
```

### 调整曲线透明度
```xml
opacity="0.7"  ← 改为 0.5 或 0.9
```

修改后重新运行生成脚本即可。

---

## 🎯 应用图标

生成所有文件后，重新编译 Tauri 应用：

```bash
# 开发模式查看效果
npm run tauri dev

# 构建生产版本
npm run tauri build
```

Windows 和 macOS 会自动使用新图标。

---

## 🖼️ 预览

在浏览器中打开 `src-tauri/icons/icon.svg` 可预览完整设计。

在以下场景查看效果：
- 任务栏（16×16 @ 100% DPI）
- 程序列表（32×32）
- 桌面快捷方式（64×64）
- Alt+Tab 切换（128×128）

---

## 📝 设计理念

**为什么选择 MOSFET 符号？**
- SPICE 建模工具的核心就是晶体管参数提取
- 目标用户（半导体工程师）一眼能识别
- 符合专业工具的视觉传统

**为什么加入曲线元素？**
- 体现"数据拟合"的核心功能
- 增加视觉层次，避免过于静态
- 在小尺寸下不影响主体识别度

**为什么用深青绿色？**
- 与应用 UI 主题一致
- 区别于传统的蓝色（Cadence）和红色（Synopsis）
- 现代、专业、易识别

---

## 🎨 其他设计方案（备选）

如果当前设计不满意，可以尝试：

1. **纯 MOSFET 符号**（删除曲线元素）
2. **加深曲线**（opacity 改为 0.9）
3. **改变配色**（如橙色 `#C4612F` 或紫色 `#7C3AED`）
4. **简化版本**（仅保留 G-D-S 三个端子）

---

## ✅ 完成检查清单

- [x] 创建 SVG 源文件
- [ ] 生成 PNG 多尺寸
- [ ] 生成 Windows .ico
- [ ] 生成 macOS .icns
- [ ] 重新编译 Tauri 应用
- [ ] 验证任务栏图标
- [ ] 验证桌面快捷方式图标

---

**下一步**：运行 `cd icon-tools && npm install && npm run generate-icons` 生成所有 PNG 文件
