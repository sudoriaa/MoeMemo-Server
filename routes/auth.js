const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('../config/db');

// 注册
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: '用户名、邮箱和密码必填' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: '密码长度不能少于6位' });
  }

  try {
    // 检查用户名和邮箱是否已存在
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ message: '用户名或邮箱已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建用户（默认为订阅者角色）
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
      [username, email, hashedPassword, 'subscriber', 'active']
    );

    res.status(201).json({
      message: '注册成功',
      userId: result.insertId
    });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: '用户名和密码必填' });
  }

  try {
    // 支持用户名或邮箱登录
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE (username = ? OR email = ?) AND status = "active"',
      [username, username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: '用户名或密码错误，或账户已被禁用' });
    }

    const user = rows[0];

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 更新最后登录时间
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // 生成JWT token
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '48h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 验证token
router.get('/verify', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '未提供token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 获取用户信息
    const [rows] = await pool.query(
      'SELECT id, username, email, role, status FROM users WHERE id = ? AND status = "active"',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: '用户不存在或已被禁用' });
    }

    res.json({
      valid: true,
      user: rows[0]
    });
  } catch (err) {
    res.status(401).json({ message: 'token无效' });
  }
});

module.exports = router; 