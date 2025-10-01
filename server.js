const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { Server } = require("socket.io");
const morgan = require("morgan");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000; // Render 默认给的是 10000 端口
const ADMIN_USER = process.env.ADMIN_USER || "管理员";
const ADMIN_PASS = process.env.ADMIN_PASS || "adminpass";

// === 路径配置 ===
const publicDir = __dirname; // 静态文件目录（index.html 就在这里）
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// === 中间件 ===
app.use(express.json());
app.use(morgan("tiny"));
app.use("/uploads", express.static(uploadDir));
app.use(express.static(publicDir)); // 提供 index.html、JS、CSS 等

// === Multer 上传配置 ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8) +
        path.extname(file.originalname)
    );
  },
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } });

// === 数据存储 ===
const DATA_PATH = path.join(__dirname, "data.json");
function readData() {
  if (!fs.existsSync(DATA_PATH))
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify({ news: [], media: [], wishes: [] }, null, 2)
    );
  return JSON.parse(fs.readFileSync(DATA_PATH));
}
function saveData(d) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2));
}
function broadcastUpdate() {
  io.emit("update", readData());
}

// === 路由 ===
app.get("/health", (req, res) => res.json({ ok: true }));

// 登录
app.post("/login", (req, res) => {
  const { name, password } = req.body || {};
  if (!/^[\u4e00-\u9fa5]{2,}$/.test(name))
    return res.json({ success: false, msg: "姓名须为中文且至少2个字" });

  if (name === ADMIN_USER) {
    if (password === ADMIN_PASS)
      return res.json({ success: true, role: "admin" });
    else return res.json({ success: false, msg: "管理员密码错误" });
  }
  return res.json({ success: true, role: "user" });
});

// 获取数据
app.get("/data", (req, res) => res.json(readData()));

// 发布新闻
app.post("/news", (req, res) => {
  const { title, content, image } = req.body || {};
  if (!title) return res.status(400).json({ success: false, msg: "缺少标题" });
  const d = readData();
  const item = {
    id: Date.now(),
    title,
    content,
    image,
    date: new Date().toISOString(),
    likes: 0,
    likers: [],
  };
  d.news.unshift(item);
  saveData(d);
  broadcastUpdate();
  res.json({ success: true, item });
});

// 上传媒体
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, msg: "未收到文件" });
  const type =
    req.body.type ||
    (req.file.mimetype.startsWith("video") ? "video" : "image");
  const d = readData();
  const item = {
    id: Date.now(),
    type,
    filename: "/uploads/" + req.file.filename,
    date: new Date().toISOString(),
    likes: 0,
    likers: [],
  };
  d.media.unshift(item);
  saveData(d);
  broadcastUpdate();
  res.json({ success: true, item });
});

// 愿望池
app.post("/wish", (req, res) => {
  const { name, text } = req.body || {};
  if (!text)
    return res.status(400).json({ success: false, msg: "许愿内容为空" });
  const d = readData();
  const item = {
    id: Date.now(),
    name,
    text,
    date: new Date().toISOString(),
    likes: 0,
    likers: [],
  };
  d.wishes.unshift(item);
  saveData(d);
  broadcastUpdate();
  res.json({ success: true, item });
});

// 点赞
app.post("/like", (req, res) => {
  const { type, id, name } = req.body || {};
  const d = readData();
  const list = d[type];
  if (!list) return res.status(400).json({ success: false });
  const item = list.find((i) => String(i.id) === String(id));
  if (!item) return res.status(404).json({ success: false });

  item.likers = item.likers || [];
  if (!item.likers.includes(name)) {
    item.likers.push(name);
    item.likes = (item.likes || 0) + 1;
  }
  saveData(d);
  broadcastUpdate();
  res.json({ success: true, likes: item.likes, likers: item.likers });
});

// === 首页 fallback（Render 关键）===
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// === Socket.io 在线人数管理 ===
let onlineUsers = new Set();
io.on("connection", (socket) => {
  socket.on("register", (name) => {
    socket.username = name;
    onlineUsers.add(name);
    io.emit("onlineUsers", Array.from(onlineUsers));
  });
  socket.on("disconnect", () => {
    if (socket.username) onlineUsers.delete(socket.username);
    io.emit("onlineUsers", Array.from(onlineUsers));
  });
  socket.emit("update", readData());
});

server.listen(PORT, () =>
  console.log("✅ Server running on port " + PORT)
);
