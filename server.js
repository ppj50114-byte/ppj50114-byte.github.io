const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const morgan = require('morgan');
const { Server } = require('socket.io');
const { Parser } = require('json2csv');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ✅ 固定管理员用户名与密码
const ADMIN_USER = '管理员';
const ADMIN_PASS = 'guangminghui';

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use(express.json());
app.use(morgan('tiny'));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(__dirname)); // 前端 index.html 静态托管

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// 数据存储文件
const DATA_PATH = path.join(__dirname, 'data.json');
function ensureData() {
  if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, JSON.stringify({news:[], media:[], wishes:[]}, null, 2));
}
function readData() {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_PATH));
}
function saveData(d) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2));
}

// 统计数据
function statsPath() { return path.join(__dirname, 'stats.json'); }
function addStat(record) {
  let arr = [];
  if (fs.existsSync(statsPath())) arr = JSON.parse(fs.readFileSync(statsPath()));
  record._ts = new Date().toISOString();
  arr.push(record);
  fs.writeFileSync(statsPath(), JSON.stringify(arr, null, 2));
}
function readStats() {
  if (fs.existsSync(statsPath())) return JSON.parse(fs.readFileSync(statsPath()));
  return [];
}

// 登录接口
app.post('/login', (req, res) => {
  const { name, password } = req.body;
  if (name === ADMIN_USER && password === ADMIN_PASS) {
    addStat({ type: 'login', user: name });
    return res.json({ success: true, role: 'admin' });
  }
  return res.status(401).json({ success: false, message: '管理员密码错误' });
});

// 导出统计
app.get('/stats/export', (req, res) => {
  const arr = readStats();
  const rows = arr.map(x => ({
    date: x._ts,
    type: x.type,
    user: x.user || ''
  }));
  const parser = new Parser();
  const csv = parser.parse(rows);
  res.setHeader('Content-disposition', 'attachment; filename=stats.csv');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.send(csv);
});

// 首页
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 启动服务器
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
