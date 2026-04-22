const express  = require('express');
const multer   = require('multer');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3030;

// ===== 目录初始化 =====
const DATA_FILE   = path.join(__dirname, 'data', 'artworks.json');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');

[path.join(__dirname, 'data'), UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');

// ===== 中间件 =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));          // 前端页面
app.use('/uploads', express.static(UPLOADS_DIR));       // 图片静态服务

// ===== multer 图片上传配置 =====
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename:    (_, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },  // 单张最大 20MB
  fileFilter: (_, file, cb) => {
    if (/^image\//i.test(file.mimetype)) cb(null, true);
    else cb(new Error('只允许上传图片'));
  }
});

// ===== 数据读写工具 =====
function readData()       { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
function writeData(data)  { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8'); }

// ===== API 路由 =====

// 获取所有作品
app.get('/api/artworks', (_, res) => {
  try {
    res.json(readData());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 上传图片（可批量）→ 返回文件 URL 列表
app.post('/api/upload', upload.array('images', 20), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: '未收到图片文件' });

  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
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

// 删除作品（同时删除其图片文件）
app.delete('/api/artworks/:id', (req, res) => {
  try {
    const artworks = readData();
    const idx = artworks.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '作品不存在' });

    // 删除图片文件
    (artworks[idx].images || []).forEach(url => {
      const filePath = path.join(UPLOADS_DIR, path.basename(url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

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
