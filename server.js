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

// ✅ 管理员账号
const ADMIN_USER = '光明会';
const ADMIN_PASS = 'guangminghui';

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use(express.json());
app.use(morgan('tiny'));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(__dirname)); // 前端 index.html

// 上传文件配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// 数据文件
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

// 登录接口
app.post('/login', (req, res) => {
  const { name, password } = req.body;

  if (!name) return res.json({ success: false, message: "请输入名字" });

  if (name === ADMIN_USER) {
    if (password === ADMIN_PASS) {
      return res.json({ success: true, role: 'admin', name: ADMIN_USER });
    } else {
      return res.json({ success: false, message: "管理员密码错误" });
    }
  }

  // 普通客户
  return res.json({ success: true, role: 'customer', name });
});

// 首页
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ✅ 启动服务
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
