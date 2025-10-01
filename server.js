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

// 首页 fallback
app.get('/',(req,res)=>{
  res.sendFile(path.join(__dirname,'index.html'));
});

server.listen(PORT,()=>console.log('✅ Server running on port '+PORT));