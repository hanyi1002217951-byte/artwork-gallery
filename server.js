const express  = require('express');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const fs       = require('fs');
const axios    = require('axios');

const app  = express();
const PORT = process.env.PORT || 3030;

// ===== GitHub Gist 配置 =====
// 请替换为你自己的 GitHub Token（在 GitHub Settings → Developer settings → Personal access tokens 生成）
// 需要勾选 "gist" 权限
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID       = process.env.GIST_ID       || '';  // 首次运行会自动创建

// ===== 目录初始化（仅用于缓存）=====
const CACHE_DIR  = path.join(__dirname, 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'artworks.json');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ===== 中间件 =====
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname)));

// ===== GitHub Gist 读写 =====
let gistData = null;  // 内存缓存

async function loadFromGist() {
  if (!GITHUB_TOKEN) {
    // 无 Token 时回退到本地文件
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
    return [];
  }

  try {
    if (GIST_ID) {
      // 读取已有 Gist
      const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
      const file = Object.values(res.data.files).find(f => f.filename === 'artworks.json');
      if (file) {
        fs.writeFileSync(CACHE_FILE, file.content, 'utf-8');
        return JSON.parse(file.content);
      }
    } else {
      // 首次：列出用户的 Gist，找到我们创建的
      const res = await axios.get('https://api.github.com/gists', {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
      const existing = res.data.find(g => g.description === '小丸作品集数据');
      if (existing) {
        const file = Object.values(existing.files).find(f => f.filename === 'artworks.json');
        if (file) {
          fs.writeFileSync(CACHE_FILE, file.content, 'utf-8');
          return JSON.parse(file.content);
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ 读取 Gist 失败，使用本地缓存:', e.message);
  }

  if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  return [];
}

async function saveToGist(data) {
  const content = JSON.stringify(data, null, 2);

  // 先写本地缓存
  fs.writeFileSync(CACHE_FILE, content, 'utf-8');

  if (!GITHUB_TOKEN) return; // 无 Token 只存本地

  try {
    const payload = {
      description: '小丸作品集数据',
      public: false,
      files: {
        'artworks.json': { content }
      }
    };

    if (GIST_ID) {
      await axios.patch(`https://api.github.com/gists/${GIST_ID}`, payload, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
    } else {
      const res = await axios.post('https://api.github.com/gists', payload, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
      console.log('✅ 已创建新 Gist，ID:', res.data.id);
      console.log('请将 GIST_ID=' + res.data.id + ' 添加到 Railway 环境变量中');
    }
  } catch (e) {
    console.warn('⚠️ 保存 Gist 失败，数据已保存在本地:', e.message);
  }
}

// ===== API 路由 =====

// 获取所有作品
app.get('/api/artworks', async (_, res) => {
  try {
    if (!gistData) gistData = await loadFromGist();
    res.json(gistData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 上传图片（透传 base64）
app.post('/api/upload', (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '未收到图片' });
    }
    res.json({ urls: images });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新建作品
app.post('/api/artworks', async (req, res) => {
  try {
    const { name, desc, images, colors, category } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '作品名称不能为空' });

    if (!gistData) gistData = await loadFromGist();
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
    gistData.unshift(artwork);
    await saveToGist(gistData);
    res.json(artwork);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新作品
app.put('/api/artworks/:id', async (req, res) => {
  try {
    if (!gistData) gistData = await loadFromGist();
    const idx = gistData.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '作品不存在' });

    const { name, desc, images, colors, category } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '作品名称不能为空' });

    gistData[idx] = {
      ...gistData[idx],
      name:     name.trim(),
      desc:     (desc || '').trim(),
      images:   images || gistData[idx].images,
      colors:   colors || gistData[idx].colors,
      category: category !== undefined ? category : gistData[idx].category,
    };
    await saveToGist(gistData);
    res.json(gistData[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除作品
app.delete('/api/artworks/:id', async (req, res) => {
  try {
    if (!gistData) gistData = await loadFromGist();
    const idx = gistData.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '作品不存在' });

    gistData.splice(idx, 1);
    await saveToGist(gistData);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`\n🌸 小丸作品集已启动！`);
  console.log(`   本机访问：http://localhost:${PORT}`);
  if (!GITHUB_TOKEN) {
    console.log(`\n⚠️ 未配置 GITHUB_TOKEN，数据仅保存在 Railway 临时文件系统中`);
    console.log(`   重新部署会导致数据丢失！`);
    console.log(`   如需永久保存，请设置 GITHUB_TOKEN 环境变量\n`);
  } else {
    console.log(`✅ 数据将同步到 GitHub Gist，永久保存\n`);
  }
});

