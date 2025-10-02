const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');
const morgan = require('morgan');
const { Parser } = require('json2csv');

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

// Stats (simplified)
function statsPath(){ return path.join(__dirname,'stats.json'); }
function addStat(record){
  let arr=[]; if(fs.existsSync(statsPath())) arr=JSON.parse(fs.readFileSync(statsPath()));
  record._ts=new Date().toISOString(); arr.push(record);
  fs.writeFileSync(statsPath(),JSON.stringify(arr,null,2));
}
function readStats(){ if(!fs.existsSync(statsPath())) return []; return JSON.parse(fs.readFileSync(statsPath())); }

// login
app.post('/login',(req,res)=>{
  const {name,password} = req.body||{};
  if(!name || !/^[\u4e00-\u9fa5]{2,}$/.test(name)) return res.json({success:false,msg:'姓名须为中文且至少2个字'});
  if(name===ADMIN_USER){
    if(password===ADMIN_PASS){ addStat({type:'login',user:name,role:'admin'}); return res.json({success:true,role:'admin'}); }
    else return res.json({success:false,msg:'管理员密码错误'});
  }
  addStat({type:'login',user:name,role:'user'});
  res.json({success:true,role:'user'});
});

// Export stats as CSV
app.get('/stats/export',(req,res)=>{
  const arr = readStats();
  const rows = arr.map(s=>({
    date: s._ts, type: s.type, user: s.user||'', contentType: s.contentType||'', contentId: s.contentId||'', title: s.title||'', extra: JSON.stringify(s)
  }));
  const parser = new Parser();
  const csv = parser.parse(rows);
  res.setHeader('Content-disposition', 'attachment; filename=report.csv');
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

app.get('/',(req,res)=>{ res.sendFile(path.join(__dirname,'index.html')); });

server.listen(PORT,()=>console.log('✅ Server running on port '+PORT));