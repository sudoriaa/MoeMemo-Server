const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');

// 获取某篇文章的留言列表（支持嵌套回复）
router.get('/comments/:articleId', async (req, res) => {
  const { articleId } = req.params;
  
  try {
    // 获取所有评论（包括回复）
    const [allComments] = await pool.query(`
      SELECT 
        c.*,
        u.username as user_name,
        u.avatar as user_avatar,
        u.id as user_id,
        COALESCE(cl.likes_count, 0) as likes,
        CASE WHEN user_likes.id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        parent_user.username as parent_user_name
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN users parent_user ON c.parent_id = parent_user.id
      LEFT JOIN (
        SELECT comment_id, COUNT(*) as likes_count
        FROM comment_likes
        GROUP BY comment_id
      ) cl ON c.id = cl.comment_id
      LEFT JOIN comment_likes user_likes ON c.id = user_likes.comment_id 
        AND user_likes.user_id = ?
      WHERE c.article_id = ?
      ORDER BY c.created_at ASC
    `, [req.user?.id || 0, articleId]);

    // 构建嵌套结构
    const buildNestedComments = (comments, parentId = null) => {
      return comments
        .filter(comment => comment.parent_id === parentId)
        .map(comment => ({
          ...comment,
          replies: buildNestedComments(comments, comment.id)
        }));
    };

    const nestedComments = buildNestedComments(allComments);
    
    res.json(nestedComments);
  } catch (err) {
    console.error('获取留言失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 获取评论详情和所有回复
router.get('/comments/detail/:commentId', async (req, res) => {
  const { commentId } = req.params;
  
  try {
    // 获取原评论信息
    const [[comment]] = await pool.query(`
      SELECT 
        c.*,
        u.username as user_name,
        u.avatar as user_avatar,
        u.id as user_id
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [commentId]);
    
    if (!comment) {
      return res.status(404).json({ message: '评论不存在' });
    }
    
    // 获取该评论的所有回复（包括嵌套回复）
    const [allReplies] = await pool.query(`
      SELECT 
        c.*,
        u.username as user_name,
        u.avatar as user_avatar,
        u.id as user_id,
        COALESCE(cl.likes_count, 0) as likes,
        CASE WHEN user_likes.id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        parent_user.username as parent_user_name
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN users parent_user ON c.parent_id = parent_user.id
      LEFT JOIN (
        SELECT comment_id, COUNT(*) as likes_count
        FROM comment_likes
        GROUP BY comment_id
      ) cl ON c.id = cl.comment_id
      LEFT JOIN comment_likes user_likes ON c.id = user_likes.comment_id 
        AND user_likes.user_id = ?
      WHERE c.article_id = ? AND (c.id = ? OR c.parent_id = ? OR c.parent_id IN (
        SELECT id FROM comments WHERE parent_id = ?
      ))
      ORDER BY c.created_at ASC
    `, [req.user?.id || 0, comment.article_id, commentId, commentId, commentId]);
    
    // 过滤出真正的回复（排除原评论本身）
    const replies = allReplies.filter(reply => reply.id !== parseInt(commentId));
    
    res.json({
      comment,
      allReplies: replies
    });
  } catch (err) {
    console.error('获取评论详情失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 发表留言（支持回复）
router.post('/comments', authenticateToken, async (req, res) => {
  const { article_id, content, parent_id } = req.body;
  const userId = req.user.id;
  
  if (!content || !content.trim()) {
    return res.status(400).json({ message: '留言内容不能为空' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ message: '留言内容不能超过500字符' });
  }

  // 如果是回复，验证父评论是否存在
  if (parent_id) {
    try {
      const [[parentComment]] = await pool.query(
        'SELECT id, article_id FROM comments WHERE id = ?', 
        [parent_id]
      );
      if (!parentComment) {
        return res.status(404).json({ message: '回复的评论不存在' });
      }
      if (parentComment.article_id != article_id) {
        return res.status(400).json({ message: '回复的评论不属于该文章' });
      }
    } catch (err) {
      return res.status(500).json({ message: '验证父评论失败' });
    }
  }
  
  try {
    // 检查文章是否存在
    const [[article]] = await pool.query('SELECT id FROM notes WHERE id = ?', [article_id]);
    if (!article) {
      return res.status(404).json({ message: '文章不存在' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO comments (user_id, article_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [userId, article_id, content.trim(), parent_id || null]
    );
    
    // 获取刚插入的留言详情
    const [[newComment]] = await pool.query(`
      SELECT 
        c.*,
        u.username as user_name,
        u.avatar as user_avatar,
        u.id as user_id,
        0 as likes,
        0 as is_liked
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [result.insertId]);
    
    res.json(newComment);
  } catch (err) {
    console.error('发表留言失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 点赞/取消点赞留言
router.post('/comments/:id/like', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  try {
    // 检查留言是否存在
    const [[comment]] = await pool.query('SELECT id FROM comments WHERE id = ?', [id]);
    if (!comment) {
      return res.status(404).json({ message: '留言不存在' });
    }
    
    // 检查是否已经点赞
    const [[existingLike]] = await pool.query(
      'SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?',
      [userId, id]
    );
    
    if (existingLike) {
      // 取消点赞
      await pool.query(
        'DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?',
        [userId, id]
      );
      
      const [likesResult] = await pool.query(
        'SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?',
        [id]
      );
      
      res.json({ 
        is_liked: false, 
        likes: likesResult[0].count 
      });
    } else {
      // 添加点赞
      await pool.query(
        'INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)',
        [userId, id]
      );
      
      const [likesResult] = await pool.query(
        'SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?',
        [id]
      );
      
      res.json({ 
        is_liked: true, 
        likes: likesResult[0].count 
      });
    }
  } catch (err) {
    console.error('点赞操作失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

// 删除留言（需要是留言作者或管理员）
router.delete('/comments/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  try {
    // 检查留言是否存在
    const [[comment]] = await pool.query('SELECT * FROM comments WHERE id = ?', [id]);
    if (!comment) {
      return res.status(404).json({ message: '留言不存在' });
    }
    
    // 检查权限（留言作者或管理员）
    if (comment.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: '无权限删除此留言' });
    }
    
    // 删除留言（会自动删除相关的点赞记录）
    await pool.query('DELETE FROM comments WHERE id = ?', [id]);
    
    res.json({ message: '删除成功' });
  } catch (err) {
    console.error('删除留言失败:', err);
    res.status(500).json({ message: '服务器错误', error: err.message });
  }
});

module.exports = router; 