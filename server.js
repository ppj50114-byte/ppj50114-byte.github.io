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

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || '管理员';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adminpass';

const publicDir = __dirname;
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json());
app.use(morgan('tiny'));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => { cb(null, Date.now()+'-'+Math.random().toString(36).slice(2,8)+path.extname(file.originalname)); }
});
const upload = multer({ storage, limits:{ fileSize:300*1024*1024 } });

const DATA_PATH = path.join(__dirname, 'data.json');
function readData(){ if(!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, JSON.stringify({news:[],media:[],wishes:[]},null,2)); return JSON.parse(fs.readFileSync(DATA_PATH)); }
function saveData(d){ fs.writeFileSync(DATA_PATH, JSON.stringify(d,null,2)); }
function broadcastUpdate(){ io.emit('update', readData()); }

app.post('/login',(req,res)=>{ const {name,password}=req.body||{}; if(!/^[\u4e00-\u9fa5]{2,}$/.test(name)) return res.json({success:false,msg:'姓名须为中文且至少2个字'}); if(name===ADMIN_USER){ if(password===ADMIN_PASS) return res.json({success:true,role:'admin'}); else return res.json({success:false,msg:'管理员密码错误'});} return res.json({success:true,role:'user'}); });
app.get('/data',(req,res)=>res.json(readData()));
app.post('/news',(req,res)=>{ const {title,content,image}=req.body||{}; if(!title) return res.status(400).json({success:false}); const d=readData(); const item={id:Date.now(),title,content,image,date:new Date().toISOString(),likes:0,likers:[]}; d.news.unshift(item); saveData(d); broadcastUpdate(); res.json({success:true}); });
app.post('/upload', upload.single('file'), (req,res)=>{ if(!req.file) return res.status(400).json({success:false}); const type=req.body.type|| (req.file.mimetype.startsWith('video')?'video':'image'); const d=readData(); const item={id:Date.now(),type,filename:'/uploads/'+req.file.filename,date:new Date().toISOString(),likes:0,likers:[]}; d.media.unshift(item); saveData(d); broadcastUpdate(); res.json({success:true,item}); });
app.post('/wish',(req,res)=>{ const {name,text}=req.body||{}; if(!text) return res.status(400).json({success:false}); const d=readData(); const item={id:Date.now(),name,text,date:new Date().toISOString(),likes:0,likers:[]}; d.wishes.unshift(item); saveData(d); broadcastUpdate(); res.json({success:true}); });
app.post('/like',(req,res)=>{ const {type,id,name}=req.body||{}; const d=readData(); const list=d[type]; const item=list.find(i=>String(i.id)===String(id)); if(!item) return res.status(404).json({success:false}); item.likers=item.likers||[]; if(!item.likers.includes(name)){ item.likers.push(name); item.likes=(item.likes||0)+1; } saveData(d); broadcastUpdate(); res.json({success:true,likes:item.likes,likers:item.likers}); });

let onlineUsers=new Set();
io.on('connection',(socket)=>{ socket.on('register',(name)=>{ socket.username=name; onlineUsers.add(name); io.emit('onlineUsers',Array.from(onlineUsers)); }); socket.on('disconnect',()=>{ if(socket.username) onlineUsers.delete(socket.username); io.emit('onlineUsers',Array.from(onlineUsers)); }); socket.emit('update',readData()); });

server.listen(PORT,()=>console.log('Server running on http://localhost:'+PORT));