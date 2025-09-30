const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ensure uploads dir
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// static
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// multer with 300MB limit
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } });

// data file
const dataPath = path.join(__dirname, 'data.json');

function readData(){
  if(!fs.existsSync(dataPath)){
    const init = { news: [], media: [], wishes: [], usersOnline: 0 };
    fs.writeFileSync(dataPath, JSON.stringify(init, null, 2));
  }
  return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
}
function saveData(d){ fs.writeFileSync(dataPath, JSON.stringify(d, null, 2)); }

// simple login: name must be chinese >=2 chars. If name === '管理员' require password === 'adminpass'
app.post('/login', (req, res) => {
  const { name, password } = req.body || {};
  if(!name || !/^[\u4e00-\u9fa5]{2,}$/.test(name)){
    return res.json({ success:false, msg: '姓名须为中文且至少2个字' });
  }
  if(name === '管理员'){
    if(password === 'adminpass'){
      return res.json({ success:true, role:'admin' });
    } else {
      return res.json({ success:false, msg:'管理员密码错误' });
    }
  }
  return res.json({ success:true, role:'user' });
});

// get data
app.get('/data', (req, res) => {
  const d = readData();
  res.json(d);
});

// post news (admin)
app.post('/news', (req, res) => {
  const { title, content, image } = req.body;
  if(!title) return res.status(400).json({ success:false, msg:'缺少标题' });
  const d = readData();
  const item = {
    id: Date.now(),
    title, content: content||'',
    image: image||null,
    date: new Date().toISOString(),
    views:0,
    comments: [],
    likes: 0
  };
  d.news.unshift(item);
  saveData(d);
  res.json({ success:true, item });
});

// upload media (admin)
app.post('/upload', upload.single('file'), (req, res) => {
  if(!req.file) return res.status(400).json({ success:false, msg:'未收到文件' });
  const { type } = req.body;
  const d = readData();
  const item = {
    id: Date.now(),
    type: type || (req.file.mimetype.startsWith('video') ? 'video' : 'image'),
    filename: '/uploads/' + req.file.filename,
    originalName: req.file.originalname,
    date: new Date().toISOString(),
    views: 0,
    comments: [],
    likes: 0
  };
  d.media.unshift(item);
  saveData(d);
  res.json({ success:true, item });
});

// wish
app.post('/wish', (req, res) => {
  const { name, text } = req.body;
  if(!text) return res.status(400).json({ success:false, msg:'许愿内容为空' });
  const d = readData();
  const item = { id: Date.now(), name: name||'匿名', text, date: new Date().toISOString(), likes:0, comments:[] };
  d.wishes.unshift(item);
  saveData(d);
  res.json({ success:true, item });
});

// comment (on news/media/wish)
app.post('/comment', (req, res) => {
  const { type, id, name, text } = req.body;
  if(!type || !id || !text) return res.status(400).json({ success:false, msg:'参数缺失' });
  const d = readData();
  const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({ success:false, msg:'类型错误' });
  const idx = list.findIndex(i => String(i.id) === String(id));
  if(idx === -1) return res.status(404).json({ success:false, msg:'未找到目标' });
  list[idx].comments = list[idx].comments || [];
  list[idx].comments.push({ id: Date.now(), name: name||'匿名', text, date: new Date().toISOString() });
  saveData(d);
  res.json({ success:true });
});

// like
app.post('/like', (req, res) => {
  const { type, id } = req.body;
  if(!type || !id) return res.status(400).json({ success:false });
  const d = readData();
  const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({ success:false });
  const item = list.find(i => String(i.id) === String(id));
  if(!item) return res.status(404).json({ success:false });
  item.likes = (item.likes||0) + 1;
  saveData(d);
  res.json({ success:true, likes: item.likes });
});

// delete endpoints (admin)
app.delete('/news/:id', (req, res) => {
  const d = readData();
  d.news = d.news.filter(n => String(n.id) !== String(req.params.id));
  saveData(d);
  res.json({ success:true });
});
app.delete('/media/:id', (req, res) => {
  const d = readData();
  const removed = d.media.filter(m => String(m.id) === String(req.params.id));
  if(removed.length){
    removed.forEach(r => {
      try{ fs.unlinkSync(path.join(__dirname, r.filename)); }catch(e){}
    });
  }
  d.media = d.media.filter(m => String(m.id) !== String(req.params.id));
  saveData(d);
  res.json({ success:true });
});
app.delete('/wish/:id', (req, res) => {
  const d = readData();
  d.wishes = d.wishes.filter(w => String(w.id) !== String(req.params.id));
  saveData(d);
  res.json({ success:true });
});

// start
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});