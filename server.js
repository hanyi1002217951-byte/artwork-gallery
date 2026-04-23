const express = require('express');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3030;

// ===== 目录初始化 =====
const DATA_FILE = path.join(__dirname, 'data', 'artworks.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');

// ===== 中间件 =====
app.use(cors());
app.use(express.json({ limit: '50mb' }));       // 支持大请求体（图片base64）
app.use(express.static(path.join(__dirname)));  // 前端页面

// ===== 数据读写工具 =====
function readData()       { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
function writeData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8'); }

// ===== API 路由 =====

// 获取所有作品
app.get('/api/artworks', (_, res) => {
  try {
    res.json(readData());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 上传图片（转成 base64 直接存储在 artworks.json 中）
app.post('/api/upload', async (req, res) => {
  try {
    const { images } = req.body;  // images 是 base64 字符串数组
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '未收到图片' });
    }
    // 直接存储 base64，不经过磁盘，永久保存在 artworks.json
    const urls = images.map((b64, i) => {
      // 前端传过来已经是完整的 data:image/xxx;base64,xxxx 格式
      return b64;
    });
    res.json({ urls });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新建作品
app.post('/api/artworks', (req, res) => {
  try {
    const { name, desc, images, colors, category } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '作品名称不能为空' });

    const artworks = readData();
    const artwork = {
      id:        uuidv4(),
      name:      name.trim(),
      desc:      (desc || '').trim(),
      images:    images || [],
      colors:    colors || [],
      category:  category || '',
      date:      new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' }),
      createdAt: Date.now()
    };
    artworks.unshift(artwork);
    writeData(artworks);
    res.json(artwork);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新作品
app.put('/api/artworks/:id', (req, res) => {
  try {
    const artworks = readData();
    const idx = artworks.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '作品不存在' });

    const { name, desc, images, colors, category } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '作品名称不能为空' });

    artworks[idx] = {
      ...artworks[idx],
      name:     name.trim(),
      desc:     (desc || '').trim(),
      images:   images || artworks[idx].images,
      colors:   colors || artworks[idx].colors,
      category: category !== undefined ? category : artworks[idx].category,
    };
    writeData(artworks);
    res.json(artworks[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除作品
app.delete('/api/artworks/:id', (req, res) => {
  try {
    const artworks = readData();
    const idx = artworks.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '作品不存在' });

    artworks.splice(idx, 1);
    writeData(artworks);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`\n🌸 小丸作品集已启动！`);
  console.log(`   本机访问：http://localhost:${PORT}`);
  console.log(`   局域网：  http://<本机IP>:${PORT}\n`);
});
