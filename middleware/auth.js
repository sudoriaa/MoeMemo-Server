const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  console.log('认证中间件 - 请求路径:', req.path);
  console.log('认证中间件 - Authorization头:', authHeader);
  console.log('认证中间件 - Token:', token ? '存在' : '不存在');
  
  if (!token) {
    return res.status(401).json({ message: '未提供认证token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('认证中间件 - JWT解码成功，用户ID:', decoded.id);
    
    // 从数据库获取完整用户信息并验证状态
    const [rows] = await pool.query(
      'SELECT id, username, email, nickname, bio, role, status, created_at, last_login FROM users WHERE id = ? AND status = "active"',
      [decoded.id]
    );
    
    console.log('认证中间件 - 数据库查询结果:', rows.length > 0 ? '用户存在' : '用户不存在');
    if (rows.length > 0) {
      console.log('认证中间件 - 用户状态:', rows[0].status);
    }
    
    if (rows.length === 0) {
      return res.status(401).json({ message: '用户不存在或已被禁用' });
    }
    
    req.user = rows[0];
    console.log('认证中间件 - 认证成功，用户ID:', req.user.id);
    next();
  } catch (err) {
    console.error('认证中间件 - 错误:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'token已过期' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'token无效' });
    }
    return res.status(500).json({ message: '服务器错误', error: err.message });
  }
}

module.exports = authenticateToken; 