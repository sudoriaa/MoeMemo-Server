const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

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

// 创建笔记（可带标签）
router.post('/notes', authenticateToken, async (req, res) => {
  const { title, content, tagIds = [], coverImage = '', isSlide = false, slideOrder = 0, status = 'draft' } = req.body;
  const userId = req.user.id;
  
  if (!title) {
    return res.status(400).json({ message: '标题必填' });
  }
  
  try {
    const [result] = await pool.query(
      'INSERT INTO notes (user_id, title, content, cover_image, is_slide, slide_order, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, title, content, coverImage, isSlide ? 1 : 0, slideOrder, status]
    );
    const noteId = result.insertId;
    
    // 关联标签
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const values = tagIds.map(tagId => [noteId, tagId]);
      await pool.query('INSERT INTO note_tags (note_id, tag_id) VALUES ?', [values]);
    }
    
    res.json({ id: noteId, title, content, tagIds, coverImage, isSlide, slideOrder, status });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取已发布的笔记（公开接口，用于前端主页）
router.get('/notes/published', async (req, res) => {
  try {
    // 1. 查询已发布的笔记
    const [notes] = await pool.query(`
      SELECT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      WHERE n.status = 'published'
      ORDER BY n.created_at DESC
    `);

    // 2. 查询这些笔记的标签
    const noteIds = notes.map(note => note.id);
    let noteTags = [];
    
    if (noteIds.length > 0) {
      const [tags] = await pool.query(`
        SELECT nt.note_id, t.id as tag_id, t.name 
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id IN (?)
      `, [noteIds]);
      noteTags = tags;
    }

    // 3. 组装tags到每条笔记
    const noteIdToTags = {};
    noteTags.forEach(row => {
      if (!noteIdToTags[row.note_id]) noteIdToTags[row.note_id] = [];
      noteIdToTags[row.note_id].push({ id: row.tag_id, name: row.name });
    });

    const notesWithTags = notes.map(note => ({
      ...note,
      tags: noteIdToTags[note.id] || []
    }));

    res.json(notesWithTags);
  } catch (err) {
    console.error('获取已发布笔记列表失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 公开搜索笔记（按标题、内容和标签）
router.get('/notes/search', async (req, res) => {
  const { q = '', tag = '' } = req.query;
  
  try {
    let query = `
      SELECT DISTINCT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
    `;
    
    let whereConditions = [];
    let queryParams = [];
    
    // 只搜索已发布的笔记
    whereConditions.push(`n.status = 'published'`);
    
    // 如果有关键词搜索
    if (q && q.trim()) {
      whereConditions.push(`(n.title LIKE ? OR n.content LIKE ?)`);
      const searchTerm = `%${q.trim()}%`;
      queryParams.push(searchTerm, searchTerm);
    }
    
    // 如果有标签搜索
    if (tag && tag.trim()) {
      query += ` LEFT JOIN note_tags nt ON n.id = nt.note_id LEFT JOIN tags t ON nt.tag_id = t.id`;
      whereConditions.push(`t.name LIKE ?`);
      queryParams.push(`%${tag.trim()}%`);
    }
    
    // 添加 WHERE 条件
    if (whereConditions.length > 0) {
      query += ` WHERE ` + whereConditions.join(' AND ');
    }
    
    query += ` ORDER BY n.created_at DESC`;
    
    const [notes] = await pool.query(query, queryParams);
    
    // 获取这些笔记的标签
    const noteIds = notes.map(note => note.id);
    let noteTags = [];
    
    if (noteIds.length > 0) {
      const [tags] = await pool.query(`
        SELECT nt.note_id, t.id as tag_id, t.name 
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id IN (?)
      `, [noteIds]);
      noteTags = tags;
    }
    
    // 组装标签数据
    const noteIdToTags = {};
    noteTags.forEach(row => {
      if (!noteIdToTags[row.note_id]) noteIdToTags[row.note_id] = [];
      noteIdToTags[row.note_id].push({ id: row.tag_id, name: row.name });
    });
    
    // 组装最终数据
    const notesWithTags = notes.map(note => ({
      ...note,
      tags: noteIdToTags[note.id] || []
    }));
    
    res.json(notesWithTags);
  } catch (err) {
    console.error('搜索笔记失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取幻灯片笔记（用于首页轮播）
router.get('/notes/slides', async (req, res) => {
  try {
    // 1. 先查询幻灯片笔记
    const [slides] = await pool.query(`
      SELECT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      WHERE n.is_slide = 1 AND n.status = 'published'
      ORDER BY n.slide_order ASC, n.created_at DESC
      LIMIT 10
    `);

    // 2. 查询这些笔记的标签
    const slideIds = slides.map(slide => slide.id);
    let slideTags = [];
    
    if (slideIds.length > 0) {
      const [tags] = await pool.query(`
        SELECT nt.note_id, t.id as tag_id, t.name 
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id IN (?)
      `, [slideIds]);
      slideTags = tags;
    }

    // 3. 组装标签数据
    const noteIdToTags = {};
    slideTags.forEach(row => {
      if (!noteIdToTags[row.note_id]) noteIdToTags[row.note_id] = [];
      noteIdToTags[row.note_id].push({ id: row.tag_id, name: row.name });
    });

    // 4. 组装最终数据
    const slidesWithTags = slides.map(slide => ({
      ...slide,
      tags: noteIdToTags[slide.id] || []
    }));

    console.log('幻灯片数据:', slidesWithTags);
    res.json(slidesWithTags);
  } catch (err) {
    console.error('获取幻灯片失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取所有幻灯片笔记（用于管理页面）
router.get('/notes/slides/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // 构建查询条件
    let whereClause = 'WHERE n.is_slide = 1';
    let queryParams = [];
    
    // 如果不是管理员，只能看到自己的幻灯片笔记
    if (userRole !== 'admin') {
      whereClause += ' AND n.user_id = ?';
      queryParams.push(userId);
    }
    
    // 1. 查询幻灯片笔记
    const [slides] = await pool.query(`
      SELECT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      ${whereClause}
      ORDER BY n.slide_order ASC, n.created_at DESC
    `, queryParams);

    // 2. 查询这些笔记的标签
    const slideIds = slides.map(slide => slide.id);
    let slideTags = [];
    
    if (slideIds.length > 0) {
      const [tags] = await pool.query(`
        SELECT nt.note_id, t.id as tag_id, t.name 
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id IN (?)
      `, [slideIds]);
      slideTags = tags;
    }

    // 3. 组装标签数据
    const noteIdToTags = {};
    slideTags.forEach(row => {
      if (!noteIdToTags[row.note_id]) noteIdToTags[row.note_id] = [];
      noteIdToTags[row.note_id].push({ id: row.tag_id, name: row.name });
    });

    // 4. 组装最终数据
    const slidesWithTags = slides.map(slide => ({
      ...slide,
      tags: noteIdToTags[slide.id] || []
    }));

    res.json(slidesWithTags);
  } catch (err) {
    console.error('获取所有幻灯片失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取最新文章（用于侧边栏）
router.get('/notes/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    // 1. 查询最新文章
    const [notes] = await pool.query(`
      SELECT n.id, n.title, n.created_at, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      WHERE n.status = 'published'
      ORDER BY n.created_at DESC
      LIMIT ?
    `, [limit]);

    // 2. 查询这些文章的标签
    const noteIds = notes.map(note => note.id);
    let noteTags = [];
    
    if (noteIds.length > 0) {
      const [tags] = await pool.query(`
        SELECT nt.note_id, t.id as tag_id, t.name 
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id IN (?)
      `, [noteIds]);
      noteTags = tags;
    }

    // 3. 组装标签数据
    const noteIdToTags = {};
    noteTags.forEach(row => {
      if (!noteIdToTags[row.note_id]) noteIdToTags[row.note_id] = [];
      noteIdToTags[row.note_id].push({ id: row.tag_id, name: row.name });
    });

    // 4. 组装最终数据
    const notesWithTags = notes.map(note => ({
      ...note,
      tags: noteIdToTags[note.id] || []
    }));

    res.json(notesWithTags);
  } catch (err) {
    console.error('获取最新文章失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取博客统计信息
router.get('/notes/stats', async (req, res) => {
  try {
    // 文章总数
    const [[articleCount]] = await pool.query(`
      SELECT COUNT(*) as count FROM notes WHERE status = 'published'
    `);
    
    // 用户总数
    const [[userCount]] = await pool.query(`
      SELECT COUNT(*) as count FROM users
    `);
    
    // 标签总数
    const [[tagCount]] = await pool.query(`
      SELECT COUNT(*) as count FROM tags
    `);
    
    // 评论总数
    const [[commentCount]] = await pool.query(`
      SELECT COUNT(*) as count FROM comments
    `).catch(() => [[{ count: 0 }]]); // 如果没有评论表，返回0
    
    // 总阅读量（如果有阅读量字段的话）
    const [[viewCount]] = await pool.query(`
      SELECT COALESCE(SUM(view_count), 0) as count FROM notes WHERE status = 'published'
    `).catch(() => [[{ count: 0 }]]); // 如果没有阅读量字段，返回0

    res.json({
      articles: articleCount.count,
      users: userCount.count,
      tags: tagCount.count,
      comments: commentCount.count,
      views: viewCount.count
    });
  } catch (err) {
    console.error('获取统计信息失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取热门文章（按阅读量排序）
router.get('/notes/popular', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    // 1. 查询热门文章
    const [notes] = await pool.query(`
      SELECT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      WHERE n.status = 'published'
      ORDER BY n.view_count DESC, n.created_at DESC
      LIMIT ?
    `, [limit]);

    // 2. 查询这些文章的标签
    const noteIds = notes.map(note => note.id);
    let noteTags = [];
    
    if (noteIds.length > 0) {
      const [tags] = await pool.query(`
        SELECT nt.note_id, t.id as tag_id, t.name 
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id IN (?)
      `, [noteIds]);
      noteTags = tags;
    }

    // 3. 组装标签数据
    const noteIdToTags = {};
    noteTags.forEach(row => {
      if (!noteIdToTags[row.note_id]) noteIdToTags[row.note_id] = [];
      noteIdToTags[row.note_id].push({ id: row.tag_id, name: row.name });
    });

    // 4. 组装最终数据
    const notesWithTags = notes.map(note => ({
      ...note,
      tags: noteIdToTags[note.id] || []
    }));

    res.json(notesWithTags);
  } catch (err) {
    console.error('获取热门文章失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取所有笔记（包含作者信息和标签）
router.get('/notes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // 构建查询条件
    let whereClause = '';
    let queryParams = [];
    
    // 如果不是管理员，只能看到自己的笔记
    if (userRole !== 'admin') {
      whereClause = 'WHERE n.user_id = ?';
      queryParams.push(userId);
    }
    
    // 1. 查询笔记
    const [notes] = await pool.query(`
      SELECT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      ${whereClause}
      ORDER BY n.created_at DESC
    `, queryParams);

    // 2. 查询这些笔记的标签
    const noteIds = notes.map(note => note.id);
    let noteTags = [];
    
    if (noteIds.length > 0) {
      const [tags] = await pool.query(`
        SELECT nt.note_id, t.id as tag_id, t.name 
        FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id IN (?)
      `, [noteIds]);
      noteTags = tags;
    }

    // 3. 组装tags到每条笔记
    const noteIdToTags = {};
    noteTags.forEach(row => {
      if (!noteIdToTags[row.note_id]) noteIdToTags[row.note_id] = [];
      noteIdToTags[row.note_id].push({ id: row.tag_id, name: row.name });
    });

    const notesWithTags = notes.map(note => ({
      ...note,
      tags: noteIdToTags[note.id] || []
    }));

    res.json(notesWithTags);
  } catch (err) {
    console.error('获取笔记列表失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 增加文章阅读量
router.post('/notes/:id/view', async (req, res) => {
  const { id } = req.params;
  
  console.log('收到阅读量增加请求，文章ID:', id);
  
  try {
    // 检查笔记是否存在
    const [[note]] = await pool.query('SELECT id FROM notes WHERE id = ?', [id]);
    if (!note) {
      console.log('文章不存在，ID:', id);
      return res.status(404).json({ message: '笔记不存在' });
    }
    
    console.log('文章存在，开始增加阅读量');
    
    // 增加阅读量
    await pool.query('UPDATE notes SET view_count = view_count + 1 WHERE id = ?', [id]);
    
    console.log('阅读量增加成功，文章ID:', id);
    
    res.json({ message: '阅读量增加成功' });
  } catch (err) {
    console.error('增加阅读量失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取单条笔记及其标签
router.get('/notes/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [[note]] = await pool.query(`
      SELECT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      WHERE n.id = ?
    `, [id]);
    
    if (!note) {
      return res.status(404).json({ message: '笔记不存在' });
    }
    
    const [tags] = await pool.query(
      'SELECT t.* FROM tags t JOIN note_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?',
      [id]
    );
    
    res.json({ ...note, tags });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 更新笔记内容和标签
router.put('/notes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, content, tagIds = [], coverImage = '', isSlide = false, slideOrder = 0, status = 'draft' } = req.body;
  const userId = req.user.id;
  
  try {
    // 检查笔记是否存在
    const [[note]] = await pool.query('SELECT * FROM notes WHERE id = ?', [id]);
    if (!note) {
      return res.status(404).json({ message: '笔记不存在' });
    }
    
    // 只允许修改自己的笔记，除非是管理员
    if (note.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限修改此笔记' });
    }
    
    await pool.query(
      'UPDATE notes SET title = ?, content = ?, cover_image = ?, is_slide = ?, slide_order = ?, status = ? WHERE id = ?',
      [title, content, coverImage, isSlide ? 1 : 0, slideOrder, status, id]
    );
    
    // 先删除原有标签关联
    await pool.query('DELETE FROM note_tags WHERE note_id = ?', [id]);
    
    // 再插入新标签关联
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const values = tagIds.map(tagId => [id, tagId]);
      await pool.query('INSERT INTO note_tags (note_id, tag_id) VALUES ?', [values]);
    }
    
    res.json({ message: '更新成功' });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 删除笔记
router.delete('/notes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  try {
    // 检查笔记是否存在
    const [[note]] = await pool.query('SELECT * FROM notes WHERE id = ?', [id]);
    if (!note) {
      return res.status(404).json({ message: '笔记不存在' });
    }
    
    // 只允许删除自己的笔记，除非是管理员
    if (note.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限删除此笔记' });
    }
    
    // 删除笔记（会自动删除关联的标签）
    await pool.query('DELETE FROM notes WHERE id = ?', [id]);
    
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

module.exports = router; 