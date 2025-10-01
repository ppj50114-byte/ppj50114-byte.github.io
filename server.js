const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');
const morgan = require('morgan');
const stringify = require('csv-stringify/lib/sync');

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
function ensureData(){
  if(!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, JSON.stringify({news:[], media:[], wishes:[]},null,2));
}
function readData(){ ensureData(); return JSON.parse(fs.readFileSync(DATA_PATH)); }
function saveData(d){ fs.writeFileSync(DATA_PATH, JSON.stringify(d,null,2)); }

// stats stored per-month: stats-YYYY-MM.json
function statsPathForMonth(ym){
  return path.join(__dirname, `stats-${ym}.json`);
}
function addStat(record){
  const now = new Date();
  const ym = now.toISOString().slice(0,7);
  const p = statsPathForMonth(ym);
  let arr = [];
  if(fs.existsSync(p)) arr = JSON.parse(fs.readFileSync(p));
  record._ts = new Date().toISOString();
  arr.push(record);
  fs.writeFileSync(p, JSON.stringify(arr,null,2));
}

// helper to read stats of a month
function readStatsMonth(ym){
  const p = statsPathForMonth(ym);
  if(!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p));
}

// Broadcast helpers
function broadcastUpdate(){ io.emit('update', readData()); io.emit('onlineUsers', Array.from(onlineUsers)); }

// health
app.get('/health',(req,res)=>res.json({ok:true}));

// login
app.post('/login',(req,res)=>{
  const {name,password} = req.body||{};
  if(!name || !/^[\u4e00-\u9fa5]{2,}$/.test(name)) return res.json({success:false,msg:'姓名须为中文且至少2个字'});
  if(name===ADMIN_USER){
    if(password===ADMIN_PASS){
      addStat({type:'login', user:name, role:'admin'});
      return res.json({success:true,role:'admin'});
    } else return res.json({success:false,msg:'管理员密码错误'});
  }
  addStat({type:'login', user:name, role:'user'});
  return res.json({success:true,role:'user'});
});

// get all data
app.get('/data',(req,res)=>res.json(readData()));

// create news
app.post('/news',(req,res)=>{
  const {title,content,image,tag,pinned,author} = req.body||{};
  if(!title) return res.status(400).json({success:false,msg:'缺少标题'});
  const d = readData();
  const item = { id: Date.now().toString(), title, content:content||'', image:image||null, tag:tag||'未分类', pinned:!!pinned, author:author||'管理员', date:new Date().toISOString(), likes:0, likers:[], comments:[] };
  if(item.pinned) d.news.unshift(item); else d.news.unshift(item);
  saveData(d);
  addStat({type:'publish', user:item.author, contentType:'news', contentId:item.id, title:item.title});
  broadcastUpdate();
  res.json({success:true,item});
});

// upload media
app.post('/upload', upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({success:false,msg:'未收到文件'});
  const type = req.body.type || (req.file.mimetype.startsWith('video') ? 'video' : 'image');
  const d = readData();
  const item = { id: Date.now().toString(), type, filename:'/uploads/' + req.file.filename, originalName:req.file.originalname, date:new Date().toISOString(), likes:0, likers:[], comments:[] };
  d.media.unshift(item);
  saveData(d);
  addStat({type:'publish', user:req.body.author||'管理员', contentType:'media', contentId:item.id, title:item.originalName});
  broadcastUpdate();
  res.json({success:true,item});
});

// wish (anonymous support)
app.post('/wish',(req,res)=>{
  const {name,text,anonymous} = req.body||{};
  if(!text) return res.status(400).json({success:false,msg:'许愿内容为空'});
  const d = readData();
  const item = { id: Date.now().toString(), name: anonymous ? '匿名' : (name||'匿名'), text, date:new Date().toISOString(), likes:0, likers:[], comments:[], pinned:false };
  d.wishes.unshift(item);
  saveData(d);
  addStat({type:'publish', user:item.name, contentType:'wish', contentId:item.id, title:item.text});
  broadcastUpdate();
  res.json({success:true,item});
});

// like an item (news/media/wishes)
app.post('/like',(req,res)=>{
  const {type,id,name} = req.body||{};
  if(!type||!id) return res.status(400).json({success:false});
  const d = readData();
  const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({success:false});
  const item = list.find(i=>String(i.id)===String(id));
  if(!item) return res.status(404).json({success:false});
  item.likers = item.likers || [];
  if(!item.likers.includes(name)){
    item.likers.push(name); item.likes = (item.likes||0)+1;
    addStat({type:'like', user:name||'匿名', contentType:type, contentId:id, title:item.title||item.originalName||''});
  }
  saveData(d);
  broadcastUpdate();
  res.json({success:true,likes:item.likes,likers:item.likers});
});

// comment
app.post('/comment',(req,res)=>{
  const {type,id,name,text,anonymous} = req.body||{};
  if(!type||!id||!text) return res.status(400).json({success:false,msg:'参数缺失'});
  const d = readData();
  const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({success:false,msg:'类型错误'});
  const item = list.find(i=>String(i.id)===String(id));
  if(!item) return res.status(404).json({success:false,msg:'未找到目标'});
  const comment = { id: Date.now().toString(), name: anonymous ? '匿名' : (name||'匿名'), text, date:new Date().toISOString(), likes:0, likers:[], replies:[] };
  item.comments = item.comments || []; item.comments.push(comment);
  saveData(d);
  addStat({type:'comment', user:comment.name, contentType:type, contentId:id, commentId:comment.id});
  broadcastUpdate();
  res.json({success:true,comment});
});

// reply to comment
app.post('/reply',(req,res)=>{
  const {type,id,commentId,name,text,anonymous} = req.body||{};
  if(!type||!id||!commentId||!text) return res.status(400).json({success:false,msg:'参数缺失'});
  const d = readData(); const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({success:false,msg:'类型错误'});
  const item = list.find(i=>String(i.id)===String(id));
  if(!item) return res.status(404).json({success:false,msg:'未找到目标'});
  item.comments = item.comments || [];
  const comment = item.comments.find(c=>String(c.id)===String(commentId));
  if(!comment) return res.status(404).json({success:false,msg:'未找到评论'});
  const reply = { id: Date.now().toString(), name: anonymous ? '匿名' : (name||'匿名'), text, date:new Date().toISOString(), likes:0, likers:[] };
  comment.replies = comment.replies || []; comment.replies.push(reply);
  saveData(d);
  addStat({type:'reply', user:reply.name, contentType:type, contentId:id, commentId:commentId, replyId:reply.id});
  broadcastUpdate();
  res.json({success:true,reply});
});

// like a comment
app.post('/likeComment',(req,res)=>{
  const {type,id,commentId,name} = req.body||{};
  if(!type||!id||!commentId) return res.status(400).json({success:false});
  const d = readData();
  const list = d[type];
  const item = list.find(i=>String(i.id)===String(id)); if(!item) return res.status(404).json({success:false});
  item.comments = item.comments || []; const comment = item.comments.find(c=>String(c.id)===String(commentId));
  if(!comment) return res.status(404).json({success:false});
  comment.likers = comment.likers || [];
  if(!comment.likers.includes(name)){ comment.likers.push(name); comment.likes = (comment.likes||0)+1; addStat({type:'likeComment', user:name||'匿名', contentType:type, contentId:id, commentId:commentId}); }
  saveData(d); broadcastUpdate(); res.json({success:true,likes:comment.likes,likers:comment.likers});
});

// pin comment or wish or news
app.post('/pin',(req,res)=>{
  const {type,id,commentId,pinned} = req.body||{};
  const d = readData();
  if(type==='news'){
    const item = d.news.find(n=>String(n.id)===String(id)); if(!item) return res.status(404).json({success:false});
    item.pinned = !!pinned;
    if(item.pinned){ d.news = d.news.filter(n=>String(n.id)!==String(id)); d.news.unshift(item); }
    saveData(d); addStat({type:'pin', user:'admin', contentType:'news', contentId:id, pinned:!!pinned}); broadcastUpdate(); return res.json({success:true});
  } else if(type==='wishes' && commentId){ // pin a comment in wishes
    const item = d.wishes.find(w=>String(w.id)===String(id)); if(!item) return res.status(404).json({success:false});
    const c = (item.comments||[]).find(c=>String(c.id)===String(commentId)); if(!c) return res.status(404).json({success:false});
    c.pinned = !!pinned; saveData(d); addStat({type:'pinComment', user:'admin', contentType:type, contentId:id, commentId:commentId, pinned:!!pinned}); broadcastUpdate(); return res.json({success:true});
  }
  res.status(400).json({success:false});
});

// delete comment
app.delete('/comment/:type/:id/:commentId',(req,res)=>{
  const {type,id,commentId} = req.params;
  const d = readData();
  const list = d[type];
  if(!Array.isArray(list)) return res.status(400).json({success:false});
  const item = list.find(i=>String(i.id)===String(id)); if(!item) return res.status(404).json({success:false});
  item.comments = (item.comments||[]).filter(c=>String(c.id)!==String(commentId));
  saveData(d); addStat({type:'deleteComment', user:'admin', contentType:type, contentId:id, commentId:commentId}); broadcastUpdate();
  res.json({success:true});
});

// delete endpoints (admin)
app.delete('/news/:id',(req,res)=>{ const d=readData(); d.news = d.news.filter(n=>String(n.id)!==String(req.params.id)); saveData(d); addStat({type:'delete', user:'admin', contentType:'news', contentId:req.params.id}); broadcastUpdate(); res.json({success:true}); });
app.delete('/wish/:id',(req,res)=>{ const d=readData(); d.wishes = d.wishes.filter(w=>String(w.id)!==String(req.params.id)); saveData(d); addStat({type:'delete', user:'admin', contentType:'wish', contentId:req.params.id}); broadcastUpdate(); res.json({success:true}); });
app.delete('/media/:id',(req,res)=>{ const d=readData(); const removed = d.media.filter(m=>String(m.id)===String(req.params.id)); removed.forEach(r=>{ try{ fs.unlinkSync(path.join(__dirname, r.filename)); }catch(e){} }); d.media = d.media.filter(m=>String(m.id)!==String(req.params.id)); saveData(d); addStat({type:'delete', user:'admin', contentType:'media', contentId:req.params.id}); broadcastUpdate(); res.json({success:true}); });

// online users list
app.get('/online',(req,res)=>{ res.json({success:true, users:Array.from(onlineUsers)}); });

// stats endpoints
app.get('/stats/today',(req,res)=>{
  const ym = new Date().toISOString().slice(0,7);
  const arr = readStatsMonth(ym);
  const today = new Date().toISOString().slice(0,10);
  const todayStats = arr.filter(s=>s._ts && s._ts.slice(0,10)===today);
  const logins = todayStats.filter(s=>s.type==='login').length;
  // aggregate likes by content id
  const likes = todayStats.filter(s=>s.type==='like' || s.type==='likeComment');
  res.json({success:true, date:today, logins, likes, raw:todayStats});
});

app.get('/stats/month',(req,res)=>{
  const q = req.query.month || new Date().toISOString().slice(0,7);
  const arr = readStatsMonth(q);
  res.json({success:true, month:q, count:arr.length, raw:arr});
});

app.get('/stats/export',(req,res)=>{
  const month = req.query.month || new Date().toISOString().slice(0,7);
  const arr = readStatsMonth(month);
  const rows = arr.map(s=>({date:s._ts, type:s.type, user:s.user||'', contentType:s.contentType||'', contentId:s.contentId||'', title:s.title||'', extra: JSON.stringify(s)}));
  const csv = stringify(rows, { header: true });
  res.setHeader('Content-disposition', 'attachment; filename=report-'+month+'.csv');
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/',(req,res)=>{ res.sendFile(path.join(__dirname,'index.html')); });

let onlineUsers = new Set();
io.on('connection',(socket)=>{
  socket.on('register',(name)=>{ socket.username = name; onlineUsers.add(name); io.emit('onlineUsers', Array.from(onlineUsers)); });
  socket.on('disconnect',()=>{ if(socket.username) onlineUsers.delete(socket.username); io.emit('onlineUsers', Array.from(onlineUsers)); });
  socket.emit('update', readData());
});

server.listen(PORT,()=>console.log('✅ Server running on port '+PORT));