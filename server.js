const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const ADMIN_USER = process.env.ADMIN_USER || '管理员';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adminpass';

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json());
app.use(morgan('tiny'));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(__dirname));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now()+'-'+Math.random().toString(36).slice(2,8)+path.extname(file.originalname))
});
const upload = multer({ storage, limits:{ fileSize:300*1024*1024 } });

const DATA_PATH = path.join(__dirname, 'data.json');

function initData(){
  if(!fs.existsSync(DATA_PATH)){
    const init = { news:[], media:[], wishes:[] };
    fs.writeFileSync(DATA_PATH, JSON.stringify(init, null, 2));
  }
}
function readData(){ initData(); return JSON.parse(fs.readFileSync(DATA_PATH)); }
function saveData(d){ fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2)); }
function broadcastUpdate(){ io.emit('update', readData()); }

// health
app.get('/health',(req,res)=>res.json({ok:true}));

// login
app.post('/login',(req,res)=>{
  const {name,password} = req.body || {};
  if(!name || !/^[\u4e00-\u9fa5]{2,}$/.test(name)) return res.json({success:false,msg:'姓名须为中文且至少2个字'});
  if(name === ADMIN_USER){
    if(password === ADMIN_PASS) return res.json({success:true,role:'admin'});
    else return res.json({success:false,msg:'管理员密码错误'});
  }
  return res.json({success:true,role:'user'});
});

// get data
app.get('/data',(req,res)=>res.json(readData()));

// create news (admin)
app.post('/news',(req,res)=>{
  const { title, content, image, tag, pinned } = req.body || {};
  if(!title) return res.status(400).json({success:false,msg:'缺少标题'});
  const d = readData();
  const item = {
    id: Date.now(),
    title, content: content||'', image: image || null,
    tag: tag || '未分类',
    pinned: !!pinned,
    date: new Date().toISOString(),
    likes: 0, likers: [], comments: []
  };
  if(item.pinned) d.news.unshift(item);
  else d.news.unshift(item);
  saveData(d); broadcastUpdate(); res.json({success:true,item});
});

// upload media
app.post('/upload', upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({success:false,msg:'未收到文件'});
  const type = req.body.type || (req.file.mimetype.startsWith('video') ? 'video' : 'image');
  const d = readData();
  const item = { id: Date.now(), type, filename: '/uploads/' + req.file.filename, originalName: req.file.originalname, date: new Date().toISOString(), likes:0, likers:[] };
  d.media.unshift(item); saveData(d); broadcastUpdate(); res.json({success:true,item});
});

// wish (can be anonymous)
app.post('/wish',(req,res)=>{
  const { name, text, anonymous } = req.body || {};
  if(!text) return res.status(400).json({success:false,msg:'许愿内容为空'});
  const d = readData();
  const item = {
    id: Date.now(), name: anonymous ? '匿名' : (name||'匿名'),
    text, date: new Date().toISOString(),
    likes:0, likers: [], comments: []
  };
  d.wishes.unshift(item); saveData(d); broadcastUpdate(); res.json({success:true,item});
});

// like (for news/media/wishes)
app.post('/like',(req,res)=>{
  const { type, id, name } = req.body || {};
  if(!type || !id) return res.status(400).json({success:false});
  const d = readData(); const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({success:false});
  const item = list.find(i=>String(i.id)===String(id));
  if(!item) return res.status(404).json({success:false});
  item.likers = item.likers || [];
  if(!item.likers.includes(name)){
    item.likers.push(name); item.likes = (item.likes||0) + 1;
  }
  saveData(d); broadcastUpdate(); res.json({success:true,likes:item.likes,likers:item.likers});
});

// comment (news or wishes)
app.post('/comment',(req,res)=>{
  const { type, id, name, text } = req.body || {};
  if(!type || !id || !text) return res.status(400).json({success:false,msg:'参数缺失'});
  const d = readData(); const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({success:false,msg:'类型错误'});
  const item = list.find(i=>String(i.id)===String(id));
  if(!item) return res.status(404).json({success:false,msg:'未找到目标'});
  const comment = { id: Date.now(), name: name||'匿名', text, date: new Date().toISOString(), likes:0, likers:[], replies:[] };
  item.comments = item.comments || []; item.comments.push(comment);
  saveData(d); broadcastUpdate(); res.json({success:true,comment});
});

// reply to a comment
app.post('/reply',(req,res)=>{
  const { type, id, commentId, name, text } = req.body || {};
  if(!type||!id||!commentId||!text) return res.status(400).json({success:false,msg:'参数缺失'});
  const d = readData(); const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({success:false,msg:'类型错误'});
  const item = list.find(i=>String(i.id)===String(id));
  if(!item) return res.status(404).json({success:false,msg:'未找到目标'});
  item.comments = item.comments || [];
  const comment = item.comments.find(c=>String(c.id)===String(commentId));
  if(!comment) return res.status(404).json({success:false,msg:'未找到评论'});
  const reply = { id: Date.now(), name: name||'匿名', text, date: new Date().toISOString(), likes:0, likers:[] };
  comment.replies = comment.replies || []; comment.replies.push(reply);
  saveData(d); broadcastUpdate(); res.json({success:true,reply});
});

// like comment
app.post('/likeComment',(req,res)=>{
  const { type, id, commentId, name } = req.body || {};
  if(!type||!id||!commentId) return res.status(400).json({success:false});
  const d = readData(); const list = d[type];
  const item = list.find(i=>String(i.id)===String(id)); if(!item) return res.status(404).json({success:false});
  item.comments = item.comments || []; const comment = item.comments.find(c=>String(c.id)===String(commentId));
  if(!comment) return res.status(404).json({success:false});
  comment.likers = comment.likers || [];
  if(!comment.likers.includes(name)){ comment.likers.push(name); comment.likes = (comment.likes||0) + 1; }
  saveData(d); broadcastUpdate(); res.json({success:true,likes:comment.likes,likers:comment.likers});
});

// pin/unpin news (admin)
app.post('/pinNews',(req,res)=>{
  const { id, pinned } = req.body || {};
  const d = readData();
  const item = d.news.find(n=>String(n.id)===String(id));
  if(!item) return res.status(404).json({success:false});
  item.pinned = !!pinned;
  // move to top if pinned
  if(item.pinned){
    d.news = d.news.filter(n=>String(n.id)!==String(id));
    d.news.unshift(item);
  }
  saveData(d); broadcastUpdate(); res.json({success:true});
});

// search across news, wishes, comments
app.get('/search',(req,res)=>{
  const q = (req.query.q||'').trim().toLowerCase();
  if(!q) return res.json({success:true,results:[]});
  const d = readData();
  const results = { news:[], wishes:[] };
  d.news.forEach(n=>{
    if((n.title||'').toLowerCase().includes(q) || (n.content||'').toLowerCase().includes(q) || (n.tag||'').toLowerCase().includes(q)){
      results.news.push(n);
    } else if((n.comments||[]).some(c=> (c.text||'').toLowerCase().includes(q) || (c.name||'').toLowerCase().includes(q))){
      results.news.push(n);
    }
  });
  d.wishes.forEach(w=>{
    if((w.text||'').toLowerCase().includes(q) || (w.name||'').toLowerCase().includes(q)){
      results.wishes.push(w);
    } else if((w.comments||[]).some(c=> (c.text||'').toLowerCase().includes(q) || (c.name||'').toLowerCase().includes(q))){
      results.wishes.push(w);
    }
  });
  res.json({success:true,results});
});

// delete endpoints (admin)
app.delete('/news/:id',(req,res)=>{ const d=readData(); d.news = d.news.filter(n=>String(n.id)!==String(req.params.id)); saveData(d); broadcastUpdate(); res.json({success:true}); });
app.delete('/wish/:id',(req,res)=>{ const d=readData(); d.wishes = d.wishes.filter(w=>String(w.id)!==String(req.params.id)); saveData(d); broadcastUpdate(); res.json({success:true}); });
app.delete('/media/:id',(req,res)=>{ const d=readData(); const removed = d.media.filter(m=>String(m.id)===String(req.params.id)); removed.forEach(r=>{ try{ fs.unlinkSync(path.join(__dirname, r.filename)); }catch(e){} }); d.media = d.media.filter(m=>String(m.id)!==String(req.params.id)); saveData(d); broadcastUpdate(); res.json({success:true}); });

app.get('/',(req,res)=>{ res.sendFile(path.join(__dirname,'index.html')); });

let onlineUsers=new Set();
io.on('connection',(socket)=>{
  socket.on('register',(name)=>{ socket.username=name; onlineUsers.add(name); io.emit('onlineUsers',Array.from(onlineUsers)); });
  socket.on('disconnect',()=>{ if(socket.username) onlineUsers.delete(socket.username); io.emit('onlineUsers',Array.from(onlineUsers)); });
  socket.emit('update',readData());
});

server.listen(PORT,()=>console.log('✅ Server running on port '+PORT));
