const express  = require('express');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const fs       = require('fs');
const axios    = require('axios');

const app  = express();
const PORT = process.env.PORT || 3030;

// ===== 配置 =====
// GITHUB_TOKEN + GIST_ID: 用于存储作品数据（artworks.json），永久保存
// IMGBB_KEY: 免费图床 API key，用于存储图片，永久保存
//   申请地址: https://api.imgbb.com/ （免费，无需信用卡）
//   不想注册？可以直接用下方匿名 key（限时限量，适合测试）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID      = process.env.GIST_ID      || '';
const IMGBB_KEY    = process.env.IMGBB_KEY    || 'a44a77ed4d3d1bbb5fc406c3e2eb4004'; // 公共测试 key

// ===== 本地缓存目录 =====
const CACHE_DIR  = path.join(__dirname, 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'artworks.json');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ===== 中间件 =====
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ===== 数据加载/保存（GitHub Gist）=====
let dataCache = null;

async function loadData() {
  // 优先读本地缓存
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (cached.length >= 0) return cached;
    } catch {}
  }

  // 无 Token 则返回空
  if (!GITHUB_TOKEN) return [];

  // 从 Gist 加载
  try {
    if (GIST_ID) {
      const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
      const file = Object.values(res.data.files).find(f => f.filename === 'artworks.json');
      if (file && file.content) {
        const parsed = JSON.parse(file.content);
        fs.writeFileSync(CACHE_FILE, file.content, 'utf-8');
        return parsed;
      }
    }
  } catch (e) {
    console.warn('⚠️ 读取 Gist 失败:', e.message);
  }
  return [];
}

async function saveData(data) {
  const content = JSON.stringify(data, null, 2);
  // 永远先写本地缓存
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
      await axios.patch(`https://api.github.com/gists/${GIST_ID}`, payload, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
    } else {
      const res = await axios.post('https://api.github.com/gists', payload, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      });
      console.log('✅ 已创建 Gist，ID:', res.data.id);
      console.log('请将 GIST_ID=' + res.data.id + ' 添加到 Railway 环境变量');
    }
  } catch (e) {
    console.error('❌ 保存 Gist 失败:', e.response?.data || e.message);
  }
}

// ===== 图片上传（imgbb 免费图床）=====
async function uploadToImgbb(base64Data) {
  const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const form = new URLSearchParams();
  form.append('image', base64);

  try {
    const res = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 25000,
    });

    if (res.data?.data?.url) {
      return res.data.data.url;
    }
    // imgbb 返回格式不对
    console.warn('⚠️ imgbb 返回格式异常:', JSON.stringify(res.data).substring(0, 200));
    return base64Data; // 回退到 base64
  } catch (e) {
    console.warn('⚠️ imgbb 上传失败，回退 base64:', e.message);
    return base64Data; // 上传失败直接存 base64（体积大但不丢数据）
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

// 上传图片
app.post('/api/upload', async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '未收到图片' });
    }

    // 每批 3 张，错开发送避免并发超时
    const urls = [];
    for (let i = 0; i < images.length; i++) {
      urls.push(await uploadToImgbb(images[i]));
      if (i < images.length - 1) await new Promise(r => setTimeout(r, 200)); // 限速
    }
    res.json({ urls });
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
    console.log(`✅ 数据将同步到 GitHub Gist（永久存储）`);
    console.log(`✅ 图片将通过 imgbb 图床存储（永久存储）\n`);
  }
});
