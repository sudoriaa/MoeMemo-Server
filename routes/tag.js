const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// 创建标签
router.post('/tags', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: '标签名必填' });
  try {
    const [rows] = await pool.query('SELECT id FROM tags WHERE name = ?', [name]);
    if (rows.length > 0) return res.status(409).json({ message: '标签已存在' });
    const [result] = await pool.query('INSERT INTO tags (name) VALUES (?)', [name]);
    res.json({ id: result.insertId, name });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取所有标签（包含文章数量统计）
router.get('/tags', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let query = '';
    let queryParams = [];
    
    if (userRole === 'admin') {
      // 管理员可以看到所有标签
      query = `
        SELECT t.*, COUNT(nt.note_id) as articleCount 
        FROM tags t 
        LEFT JOIN note_tags nt ON t.id = nt.tag_id 
        GROUP BY t.id 
        ORDER BY t.id DESC
      `;
    } else {
      // 普通用户只能看到与自己笔记相关的标签
      query = `
        SELECT t.*, COUNT(nt.note_id) as articleCount 
        FROM tags t 
        LEFT JOIN note_tags nt ON t.id = nt.tag_id 
        LEFT JOIN notes n ON nt.note_id = n.id
        WHERE n.user_id = ? OR nt.note_id IS NULL
        GROUP BY t.id 
        ORDER BY t.id DESC
      `;
      queryParams.push(userId);
    }
    
    const [rows] = await pool.query(query, queryParams);
    res.json(rows);
  } catch (err) {
    console.error('获取标签失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取热门标签（按文章数量排序，限制数量）
router.get('/tags/hot', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const [rows] = await pool.query(`
      SELECT t.*, COUNT(nt.note_id) as articleCount 
      FROM tags t 
      LEFT JOIN note_tags nt ON t.id = nt.tag_id 
      GROUP BY t.id 
      HAVING articleCount > 0
      ORDER BY articleCount DESC, t.id DESC
      LIMIT ?
    `, [limit]);
    res.json(rows);
  } catch (err) {
    console.error('获取热门标签失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取某标签下所有笔记
router.get('/tags/:id/notes', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. 查询该标签下的已发布笔记
    const [notes] = await pool.query(`
      SELECT n.*, u.username, u.nickname,
        CASE 
          WHEN u.nickname IS NOT NULL AND u.nickname != '' THEN u.nickname 
          ELSE u.username 
        END as author 
      FROM notes n 
      LEFT JOIN users u ON n.user_id = u.id 
      JOIN note_tags nt ON n.id = nt.note_id 
      WHERE nt.tag_id = ? AND n.status = 'published'
      ORDER BY n.created_at DESC
    `, [id]);

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
    console.error('获取标签文章失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取单个标签信息
router.get('/tags/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [[tag]] = await pool.query('SELECT * FROM tags WHERE id = ?', [id]);
    if (!tag) {
      return res.status(404).json({ message: '标签不存在' });
    }
    res.json(tag);
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 编辑标签
router.put('/tags/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) return res.status(400).json({ message: '标签名必填' });
  
  try {
    // 检查标签是否存在
    const [[tag]] = await pool.query('SELECT * FROM tags WHERE id = ?', [id]);
    if (!tag) {
      return res.status(404).json({ message: '标签不存在' });
    }
    
    // 检查新名称是否已存在
    const [existingTags] = await pool.query('SELECT id FROM tags WHERE name = ? AND id != ?', [name, id]);
    if (existingTags.length > 0) {
      return res.status(409).json({ message: '标签名已存在' });
    }
    
    await pool.query('UPDATE tags SET name = ? WHERE id = ?', [name, id]);
    res.json({ message: '更新成功', id, name });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 删除标签
router.delete('/tags/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    // 检查标签是否被文章使用
    const [usedTags] = await pool.query('SELECT COUNT(*) as count FROM note_tags WHERE tag_id = ?', [id]);
    if (usedTags[0].count > 0) {
      return res.status(400).json({ message: '无法删除已关联文章的标签，请先移除文章关联' });
    }
    
    await pool.query('DELETE FROM tags WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

module.exports = router; 