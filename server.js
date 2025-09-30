const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// 确保 uploads 目录存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 静态文件目录
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 上传配置
const upload = multer({ dest: uploadDir });

// 数据文件路径
const dataPath = path.join(__dirname, 'data.json');

// 读取数据
function readData() {
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify({ news: [], media: [], wishes: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
}

// 保存数据
function saveData(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

// 获取数据
app.get('/data', (req, res) => {
  res.json(readData());
});

// 发布新闻
app.post('/news', (req, res) => {
  const { title, desc, link } = req.body;
  const data = readData();
  data.news.unshift({
    id: Date.now(),
    title,
    desc,
    link,
    date: new Date().toISOString().split('T')[0],
    views: 0
  });
  saveData(data);
  res.json({ success: true });
});

// 上传图片/视频
app.post('/upload', upload.single('file'), (req, res) => {
  const { type } = req.body;
  const data = readData();
  data.media.unshift({
    id: Date.now(),
    type: type || 'image',
    file: '/uploads/' + req.file.filename,
    date: new Date().toISOString().split('T')[0],
    views: 0
  });
  saveData(data);
  res.json({ success: true, file: '/uploads/' + req.file.filename });
});

// 添加愿望
app.post('/wish', (req, res) => {
  const { text, anonymous } = req.body;
  const data = readData();
  data.wishes.unshift({
    id: Date.now(),
    text,
    anonymous: anonymous || false,
    date: new Date().toISOString().split('T')[0]
  });
  saveData(data);
  res.json({ success: true });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});