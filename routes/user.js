const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const pool = require('../config/db');
const bcrypt = require('bcrypt');

// 权限验证中间件
const requireAdmin = async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0 || rows[0].role !== 'admin') {
      return res.status(403).json({ message: '需要管理员权限' });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
};

// 获取当前用户信息
router.get('/users/me', authenticateToken, async (req, res) => {
  // 认证中间件已经获取了完整的用户信息
  res.json(req.user);
});

// 更新当前用户信息
router.put('/users/me', authenticateToken, async (req, res) => {
  const { username, email, nickname, bio } = req.body;
  
  console.log('PUT /users/me - 用户ID:', req.user.id);
  console.log('PUT /users/me - 请求体:', req.body);
  
  try {
    // 检查用户名和邮箱是否被其他用户使用
    if (username || email) {
      const [duplicateUsers] = await pool.query(
        'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
        [username, email, req.user.id]
      );
      if (duplicateUsers.length > 0) {
        return res.status(409).json({ message: '用户名或邮箱已被其他用户使用' });
      }
    }
    
    // 构建更新字段
    const updateFields = [];
    const updateValues = [];
    
    if (username) {
      updateFields.push('username = ?');
      updateValues.push(username);
    }
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (nickname !== undefined) {
      updateFields.push('nickname = ?');
      updateValues.push(nickname);
    }
    if (bio !== undefined) {
      updateFields.push('bio = ?');
      updateValues.push(bio);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: '没有提供要更新的字段' });
    }
    
    updateValues.push(req.user.id);
    
    console.log('PUT /users/me - 更新SQL:', `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`);
    console.log('PUT /users/me - 更新参数:', updateValues);
    
    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    res.json({ message: '个人信息更新成功' });
  } catch (err) {
    console.error('PUT /users/me - 错误:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 修改密码
router.put('/users/me/password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: '当前密码和新密码必填' });
  }
  
  if (newPassword.length < 6) {
    return res.status(400).json({ message: '新密码长度不能少于6位' });
  }
  
  try {
    // 验证当前密码
    const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    const isValidPassword = await bcrypt.compare(currentPassword, rows[0].password);
    if (!isValidPassword) {
      return res.status(400).json({ message: '当前密码错误' });
    }
    
    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // 更新密码
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
    
    res.json({ message: '密码修改成功' });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 更新最后登录时间 - 放在 /users/:id 之前
router.put('/users/me/last-login', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [req.user.id]);
    res.json({ message: '登录时间更新成功' });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取用户列表（仅管理员）
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, nickname, bio, role, status, created_at, last_login FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 创建用户（仅管理员）
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
  const { username, email, password, role = 'subscriber', status = 'active' } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ message: '用户名、邮箱和密码必填' });
  }
  
  try {
    // 检查用户名是否已存在
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existingUsers.length > 0) {
      return res.status(409).json({ message: '用户名或邮箱已存在' });
    }
    
    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 创建用户
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
      [username, email, hashedPassword, role, status]
    );
    
    res.status(201).json({ 
      message: '用户创建成功',
      userId: result.insertId 
    });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 更新用户信息（仅管理员）
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const { username, email, role, status } = req.body;
  
  try {
    // 检查用户是否存在
    const [existingUser] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (existingUser.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    // 检查用户名和邮箱是否被其他用户使用
    if (username || email) {
      const [duplicateUsers] = await pool.query(
        'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
        [username, email, userId]
      );
      if (duplicateUsers.length > 0) {
        return res.status(409).json({ message: '用户名或邮箱已被其他用户使用' });
      }
    }
    
    // 构建更新字段
    const updateFields = [];
    const updateValues = [];
    
    if (username) {
      updateFields.push('username = ?');
      updateValues.push(username);
    }
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (role) {
      updateFields.push('role = ?');
      updateValues.push(role);
    }
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: '没有提供要更新的字段' });
    }
    
    updateValues.push(userId);
    
    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    res.json({ message: '用户信息更新成功' });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 删除用户（仅管理员）
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  
  // 不能删除自己
  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ message: '不能删除自己的账户' });
  }
  
  try {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.json({ message: '用户删除成功' });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

module.exports = router; 