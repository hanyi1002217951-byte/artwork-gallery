const express  = require('express');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3030;

// ===== GitHub Gist 配置 =====
// GITHUB_TOKEN + GIST_ID: 永久存储作品数据
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID      = process.env.GIST_ID      || '';

// ===== 本地缓存目录 =====
const CACHE_DIR  = path.join(__dirname, 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'artworks.json');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ===== 中间件 =====
app.use(cors());
app.use(express.json({ limit: '200mb' })); // 大请求体（支持 base64 图片）
app.use(express.static(path.join(__dirname)));

// ===== 数据加载/保存（GitHub Gist）=====
let dataCache = null;

async function loadData() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  if (!GITHUB_TOKEN) return [];
  try {
    if (GIST_ID) {
      const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
      const json = await res.json();
      const file = Object.values(json.files || {}).find(f => f.filename === 'artworks.json');
      if (file && file.content) {
        fs.writeFileSync(CACHE_FILE, file.content, 'utf-8');
        return JSON.parse(file.content);
      }
    }
  } catch (e) {
    console.warn('⚠️ 读取 Gist 失败:', e.message);
  }
  return [];
}

async function saveData(data) {
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(CACHE_FILE, content, 'utf-8');

  if (!GITHUB_TOKEN) {
    console.log('⚠️ 无 GITHUB_TOKEN，数据仅存 Railway 本地（重启会丢失）');
    return;
  }

  try {
    const payload = {
      description: '小丸作品集数据',
      public: false,
      files: { 'artworks.json': { content } }
    };

    if (GIST_ID) {
      await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      console.log('✅ 已创建 Gist，ID:', json.id);
      console.log('请将 GIST_ID=' + json.id + ' 添加到 Railway 环境变量');
    }
  } catch (e) {
    console.error('❌ 保存 Gist 失败:', e.message);
  }
}

// ===== API 路由 =====

app.get('/api/artworks', async (_, res) => {
  try {
    if (!dataCache) dataCache = await loadData();
    res.json(dataCache);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 上传图片：直接存储 base64（无外部依赖，Railway 内网也能工作）
app.post('/api/upload', async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '未收到图片' });
    }
    // 直接透传 base64，存进 artworks.json
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

    if (!dataCache) dataCache = await loadData();
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
    dataCache.unshift(artwork);
    await saveData(dataCache);
    res.json(artwork);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新作品
app.put('/api/artworks/:id', async (req, res) => {
  try {
    if (!dataCache) dataCache = await loadData();
    const idx = dataCache.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '作品不存在' });

    const { name, desc, images, colors, category } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '作品名称不能为空' });

    dataCache[idx] = {
      ...dataCache[idx],
      name:     name.trim(),
      desc:     (desc || '').trim(),
      images:   images || dataCache[idx].images,
      colors:   colors || dataCache[idx].colors,
      category: category !== undefined ? category : dataCache[idx].category,
    };
    await saveData(dataCache);
    res.json(dataCache[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除作品
app.delete('/api/artworks/:id', async (req, res) => {
  try {
    if (!dataCache) dataCache = await loadData();
    const idx = dataCache.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '作品不存在' });

    dataCache.splice(idx, 1);
    await saveData(dataCache);
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
    console.log(`\n⚠️ 未配置 GITHUB_TOKEN，数据仅保存在 Railway（重启会丢失）`);
    console.log(`   建议：配置 GITHUB_TOKEN + GIST_ID 实现永久存储\n`);
  } else {
    console.log(`✅ 数据将同步到 GitHub Gist（永久存储）\n`);
  }
});
