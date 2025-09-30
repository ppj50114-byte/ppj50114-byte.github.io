const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || '管理员';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adminpass';

// ensure folders
const publicDir = path.join(__dirname, 'public');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json());
app.use(morgan('tiny'));

// serve static and uploads
app.use('/uploads', express.static(uploadDir));
app.use(express.static(publicDir));

// multer config (300MB)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2,8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } });

// data file
const DATA_PATH = path.join(__dirname, 'data.json');
function readData() {
  if (!fs.existsSync(DATA_PATH)) {
    const init = { news: [], media: [], wishes: [] , usersOnline: 0 };
    fs.writeFileSync(DATA_PATH, JSON.stringify(init, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}
function saveData(d) { fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2)); }

// simple health
app.get('/health', (req, res) => res.json({ ok: true }));

// login
app.post('/login', (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !/^[\u4e00-\u9fa5]{2,}$/.test(name)) {
    return res.json({ success: false, msg: '姓名须为中文且至少2个字' });
  }
  if (name === ADMIN_USER) {
    if (password === ADMIN_PASS) return res.json({ success: true, role: 'admin' });
    else return res.json({ success: false, msg: '管理员密码错误' });
  }
  return res.json({ success: true, role: 'user' });
});

// get full data
app.get('/data', (req, res) => {
  const d = readData();
  return res.json(d);
});

// post news (admin)
app.post('/news', (req, res) => {
  const { title, content, image } = req.body || {};
  if (!title) return res.status(400).json({ success: false, msg: '缺少标题' });
  const d = readData();
  const item = {
    id: Date.now(),
    title: title,
    content: content || '',
    image: image || null,
    date: new Date().toISOString(),
    likes: 0,
    comments: []
  };
  d.news.unshift(item);
  saveData(d);
  res.json({ success: true, item });
});

// upload media
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, msg: '未收到文件' });
  const type = (req.body.type) ? req.body.type : (req.file.mimetype.startsWith('video') ? 'video' : 'image');
  const d = readData();
  const item = {
    id: Date.now(),
    type,
    filename: '/uploads/' + req.file.filename,
    originalName: req.file.originalname,
    date: new Date().toISOString(),
    likes: 0,
    comments: []
  };
  d.media.unshift(item);
  saveData(d);
  res.json({ success: true, item });
});

// wish
app.post('/wish', (req, res) => {
  const { name, text } = req.body || {};
  if (!text) return res.status(400).json({ success: false, msg: '许愿内容为空' });
  const d = readData();
  const item = { id: Date.now(), name: name || '匿名', text, date: new Date().toISOString(), likes: 0, comments: [] };
  d.wishes.unshift(item);
  saveData(d);
  res.json({ success: true, item });
});

// comment
app.post('/comment', (req, res) => {
  const { type, id, name, text } = req.body || {};
  if (!type || !id || !text) return res.status(400).json({ success: false, msg: '参数缺失' });
  const d = readData();
  const list = d[type];
  if (!Array.isArray(list)) return res.status(400).json({ success: false, msg: '类型错误' });
  const idx = list.findIndex(i => String(i.id) === String(id));
  if (idx === -1) return res.status(404).json({ success: false, msg: '未找到目标' });
  list[idx].comments = list[idx].comments || [];
  list[idx].comments.push({ id: Date.now(), name: name || '匿名', text, date: new Date().toISOString() });
  saveData(d);
  res.json({ success: true });
});

// like
app.post('/like', (req, res) => {
  const { type, id } = req.body || {};
  if (!type || !id) return res.status(400).json({ success: false });
  const d = readData();
  const list = d[type];
  if (!Array.isArray(list)) return res.status(400).json({ success: false });
  const item = list.find(i => String(i.id) === String(id));
  if (!item) return res.status(404).json({ success: false });
  item.likes = (item.likes || 0) + 1;
  saveData(d);
  res.json({ success: true, likes: item.likes });
});

// delete (admin)
app.delete('/news/:id', (req, res) => {
  const d = readData();
  d.news = d.news.filter(n => String(n.id) !== String(req.params.id));
  saveData(d);
  res.json({ success: true });
});
app.delete('/media/:id', (req, res) => {
  const d = readData();
  const removed = d.media.filter(m => String(m.id) === String(req.params.id));
  removed.forEach(r => {
    try { fs.unlinkSync(path.join(__dirname, r.filename)); } catch (e) {}
  });
  d.media = d.media.filter(m => String(m.id) !== String(req.params.id));
  saveData(d);
  res.json({ success: true });
});
app.delete('/wish/:id', (req, res) => {
  const d = readData();
  d.wishes = d.wishes.filter(w => String(w.id) !== String(req.params.id));
  saveData(d);
  res.json({ success: true });
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});