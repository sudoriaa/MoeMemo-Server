const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// 获取已发布的页面（公开接口，用于前端导航）
router.get('/pages/published', async (req, res) => {
  try {
    const [pages] = await pool.query(`
      SELECT id, title, slug, description, cover_image, created_at, updated_at
      FROM pages 
      WHERE status = 'published'
      ORDER BY sort_order ASC, created_at DESC
    `);

    res.json(pages);
  } catch (err) {
    console.error('获取已发布页面失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取所有页面（管理员可见所有，普通用户只能看到自己的）
router.get('/pages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let whereClause = '';
    let queryParams = [];
    
    // 如果不是管理员，只能看到自己的页面
    if (userRole !== 'admin') {
      whereClause = 'WHERE p.user_id = ?';
      queryParams.push(userId);
    }
    
    const [pages] = await pool.query(`
      SELECT p.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM pages p 
      LEFT JOIN users u ON p.user_id = u.id 
      ${whereClause}
      ORDER BY p.sort_order ASC, p.created_at DESC
    `, queryParams);

    res.json(pages);
  } catch (err) {
    console.error('获取页面列表失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取单个页面详情（用于编辑）
router.get('/pages/:id/edit', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  try {
    const [[page]] = await pool.query(`
      SELECT p.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM pages p 
      LEFT JOIN users u ON p.user_id = u.id 
      WHERE p.id = ?
    `, [id]);
    
    if (!page) {
      return res.status(404).json({ message: '页面不存在' });
    }
    
    // 只允许查看自己的页面，除非是管理员
    if (page.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限查看此页面' });
    }
    
    res.json(page);
  } catch (err) {
    console.error('获取页面详情失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 根据slug获取单个页面（公开接口）
router.get('/pages/:slug', async (req, res) => {
  const { slug } = req.params;
  
  try {
    const [[page]] = await pool.query(`
      SELECT p.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM pages p 
      LEFT JOIN users u ON p.user_id = u.id 
      WHERE p.slug = ? AND (p.status = 'published' OR p.status = 'hidden')
    `, [slug]);
    
    if (!page) {
      return res.status(404).json({ message: '页面不存在' });
    }
    
    res.json(page);
  } catch (err) {
    console.error('获取页面失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 创建新页面
router.post('/pages', authenticateToken, async (req, res) => {
  const { title, slug, content, description, coverImage, status = 'draft', sort_order = 0 } = req.body;
  const userId = req.user.id;
  
  if (!title || !slug) {
    return res.status(400).json({ message: '标题和别名必填' });
  }
  
  try {
    // 检查slug是否已存在
    const [[existingPage]] = await pool.query('SELECT id FROM pages WHERE slug = ?', [slug]);
    if (existingPage) {
      return res.status(400).json({ message: '页面别名已存在' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO pages (title, slug, content, description, cover_image, status, sort_order, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, slug, content, description, coverImage, status, sort_order, userId]
    );
    
    res.json({ 
      id: result.insertId, 
      title, 
      slug, 
      content, 
      description, 
      coverImage,
      status, 
      sort_order,
      message: '页面创建成功' 
    });
  } catch (err) {
    console.error('创建页面失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 更新页面
router.put('/pages/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, slug, content, description, coverImage, status, sort_order } = req.body;
  const userId = req.user.id;
  
  try {
    // 检查页面是否存在
    const [[page]] = await pool.query('SELECT * FROM pages WHERE id = ?', [id]);
    if (!page) {
      return res.status(404).json({ message: '页面不存在' });
    }
    
    // 只允许修改自己的页面，除非是管理员
    if (page.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限修改此页面' });
    }
    
    // 如果修改了slug，检查是否与其他页面冲突
    if (slug && slug !== page.slug) {
      const [[existingPage]] = await pool.query('SELECT id FROM pages WHERE slug = ? AND id != ?', [slug, id]);
      if (existingPage) {
        return res.status(400).json({ message: '页面别名已存在' });
      }
    }
    
    await pool.query(
      'UPDATE pages SET title = ?, slug = ?, content = ?, description = ?, cover_image = ?, status = ?, sort_order = ? WHERE id = ?',
      [title, slug, content, description, coverImage, status, sort_order, id]
    );
    
    res.json({ message: '页面更新成功' });
  } catch (err) {
    console.error('更新页面失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 删除页面
router.delete('/pages/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  try {
    // 检查页面是否存在
    const [[page]] = await pool.query('SELECT * FROM pages WHERE id = ?', [id]);
    if (!page) {
      return res.status(404).json({ message: '页面不存在' });
    }
    
    // 只允许删除自己的页面，除非是管理员
    if (page.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限删除此页面' });
    }
    
    await pool.query('DELETE FROM pages WHERE id = ?', [id]);
    
    res.json({ message: '页面删除成功' });
  } catch (err) {
    console.error('删除页面失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

module.exports = router; 