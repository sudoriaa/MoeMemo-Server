<template>
  <div class="page-manager">
    <div class="page-header">
      <h2>页面管理</h2>
      <button @click="showCreateModal = true" class="create-btn">
        <Icon icon="mdi:plus" /> 新建页面
      </button>
    </div>

    <div class="page-list">
      <div v-if="loading" class="loading">
        <div class="loading-spinner"></div>
        <p>加载中...</p>
      </div>
      
      <div v-else-if="error" class="error">
        <p>{{ error }}</p>
        <button @click="fetchPages" class="retry-btn">重试</button>
      </div>
      
      <div v-else-if="pages.length === 0" class="empty">
        <p>暂无页面</p>
        <button @click="showCreateModal = true" class="create-btn">创建第一个页面</button>
      </div>
      
      <div v-else class="pages-grid">
        <div v-for="page in pages" :key="page.id" class="page-card">
          <div class="page-card-header">
            <h3>{{ page.title }}</h3>
            <div class="page-actions">
              <button @click="editPage(page)" class="edit-btn" title="编辑">
                <Icon icon="mdi:pencil" />
              </button>
              <button @click="deletePage(page.id)" class="delete-btn" title="删除">
                <Icon icon="mdi:delete" />
              </button>
            </div>
          </div>
          
          <div class="page-card-content">
            <p class="page-description">{{ page.description || '暂无描述' }}</p>
            <div class="page-meta">
              <span class="slug">别名：{{ page.slug }}</span>
              <span class="status" :class="page.status">{{ getStatusText(page.status) }}</span>
              <span class="author">作者：{{ page.author }}</span>
            </div>
            <div class="page-dates">
              <span>创建：{{ formatDate(page.created_at) }}</span>
              <span>更新：{{ formatDate(page.updated_at) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建/编辑页面模态框 -->
    <div v-if="showCreateModal || showEditModal" class="modal-overlay" @click="closeModal">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>{{ showEditModal ? '编辑页面' : '新建页面' }}</h3>
          <button @click="closeModal" class="close-btn">
            <Icon icon="mdi:close" />
          </button>
        </div>
        
        <form @submit.prevent="savePage" class="modal-form">
          <div class="form-group">
            <label>页面标题 *</label>
            <input v-model="formData.title" type="text" required placeholder="请输入页面标题" />
          </div>
          
          <div class="form-group">
            <label>页面别名 *</label>
            <input v-model="formData.slug" type="text" required placeholder="请输入页面别名（用于URL）" />
          </div>
          
          <div class="form-group">
            <label>页面描述</label>
            <textarea v-model="formData.description" rows="3" placeholder="请输入页面描述"></textarea>
          </div>
          
          <div class="form-group">
            <label>页面内容</label>
            <textarea v-model="formData.content" rows="10" placeholder="请输入页面内容（支持Markdown）"></textarea>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>页面状态</label>
              <select v-model="formData.status">
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
                <option value="private">私有</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>排序</label>
              <input v-model.number="formData.sort_order" type="number" min="0" />
            </div>
          </div>
          
          <div class="modal-actions">
            <button type="button" @click="closeModal" class="cancel-btn">取消</button>
            <button type="submit" :disabled="saving" class="save-btn">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';

interface Page {
  id: number;
  title: string;
  slug: string;
  content: string;
  description: string;
  status: 'draft' | 'published' | 'private';
  sort_order: number;
  author: string;
  created_at: string;
  updated_at: string;
}

interface FormData {
  title: string;
  slug: string;
  content: string;
  description: string;
  status: 'draft' | 'published' | 'private';
  sort_order: number;
}

const pages = ref<Page[]>([]);
const loading = ref(true);
const error = ref('');
const saving = ref(false);
const showCreateModal = ref(false);
const showEditModal = ref(false);
const editingPageId = ref<number | null>(null);

const formData = ref<FormData>({
  title: '',
  slug: '',
  content: '',
  description: '',
  status: 'draft',
  sort_order: 0
});

const getStatusText = (status: string) => {
  const statusMap = {
    draft: '草稿',
    published: '已发布',
    private: '私有'
  };
  return statusMap[status as keyof typeof statusMap] || status;
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('zh-CN');
};

const fetchPages = async () => {
  loading.value = true;
  error.value = '';
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/pages', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      pages.value = await response.json();
    } else {
      error.value = '获取页面列表失败';
    }
  } catch (err) {
    console.error('获取页面失败:', err);
    error.value = '网络错误';
  } finally {
    loading.value = false;
  }
};

const editPage = (page: Page) => {
  editingPageId.value = page.id;
  formData.value = {
    title: page.title,
    slug: page.slug,
    content: page.content,
    description: page.description,
    status: page.status,
    sort_order: page.sort_order
  };
  showEditModal.value = true;
};

const savePage = async () => {
  saving.value = true;
  
  try {
    const token = localStorage.getItem('token');
    const url = showEditModal.value 
      ? `/api/pages/${editingPageId.value}` 
      : '/api/pages';
    
    const response = await fetch(url, {
      method: showEditModal.value ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(formData.value)
    });
    
    if (response.ok) {
      closeModal();
      fetchPages();
    } else {
      const errorData = await response.json();
      error.value = errorData.message || '保存失败';
    }
  } catch (err) {
    console.error('保存页面失败:', err);
    error.value = '网络错误';
  } finally {
    saving.value = false;
  }
};

const deletePage = async (pageId: number) => {
  if (!confirm('确定要删除这个页面吗？')) return;
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/pages/${pageId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      fetchPages();
    } else {
      const errorData = await response.json();
      error.value = errorData.message || '删除失败';
    }
  } catch (err) {
    console.error('删除页面失败:', err);
    error.value = '网络错误';
  }
};

const closeModal = () => {
  showCreateModal.value = false;
  showEditModal.value = false;
  editingPageId.value = null;
  formData.value = {
    title: '',
    slug: '',
    content: '',
    description: '',
    status: 'draft',
    sort_order: 0
  };
};

onMounted(() => {
  fetchPages();
});
</script>

<style lang="scss" scoped>
.page-manager {
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  
  h2 {
    margin: 0;
    color: #333;
  }
  
  .create-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: #0ecbff;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    
    &:hover {
      background: #009fd9;
    }
  }
}

.loading, .error, .empty {
  text-align: center;
  padding: 60px 20px;
  
  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #0ecbff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 16px;
  }
  
  p {
    color: #666;
    margin-bottom: 16px;
  }
  
  .retry-btn, .create-btn {
    padding: 8px 16px;
    background: #0ecbff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    
    &:hover {
      background: #009fd9;
    }
  }
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.pages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.page-card {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  transition: box-shadow 0.2s;
  
  &:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }
  
  .page-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    background: #f8f9fa;
    border-bottom: 1px solid #e9ecef;
    
    h3 {
      margin: 0;
      font-size: 16px;
      color: #333;
    }
    
    .page-actions {
      display: flex;
      gap: 8px;
      
      button {
        padding: 4px;
        background: none;
        border: none;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;
        
        &.edit-btn {
          color: #0ecbff;
          &:hover { background: #e0f7ff; }
        }
        
        &.delete-btn {
          color: #ff4d4f;
          &:hover { background: #ffecec; }
        }
      }
    }
  }
  
  .page-card-content {
    padding: 16px;
    
    .page-description {
      color: #666;
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.4;
    }
    
    .page-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 12px;
      
      .slug {
        color: #0ecbff;
        font-weight: 500;
      }
      
      .status {
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 500;
        
        &.draft {
          background: #fff3cd;
          color: #856404;
        }
        
        &.published {
          background: #d4edda;
          color: #155724;
        }
        
        &.private {
          background: #f8d7da;
          color: #721c24;
        }
      }
      
      .author {
        color: #666;
      }
    }
    
    .page-dates {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: #999;
    }
  }
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid #e9ecef;
    
    h3 {
      margin: 0;
      color: #333;
    }
    
    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: #666;
      
      &:hover {
        color: #333;
      }
    }
  }
  
  .modal-form {
    padding: 20px;
    
    .form-group {
      margin-bottom: 16px;
      
      label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        color: #333;
      }
      
      input, textarea, select {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
        
        &:focus {
          outline: none;
          border-color: #0ecbff;
          box-shadow: 0 0 0 2px rgba(14, 203, 255, 0.2);
        }
      }
      
      textarea {
        resize: vertical;
        font-family: inherit;
      }
    }
    
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 24px;
      
      .cancel-btn {
        padding: 8px 16px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        
        &:hover {
          background: #5a6268;
        }
      }
      
      .save-btn {
        padding: 8px 16px;
        background: #0ecbff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        
        &:hover:not(:disabled) {
          background: #009fd9;
        }
        
        &:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
      }
    }
  }
}
</style> 