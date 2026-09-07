import axios from 'axios';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5050/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add JWT token
api.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling. Branches the redirect target
// by current path so a lender hitting a 401 lands back on /lender/login
// (not /login, which would wipe their localStorage and route them to the
// PSP/admin sign-in form).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const onLenderPath =
        typeof window !== 'undefined' &&
        window.location.pathname.startsWith('/lender');
      if (onLenderPath) {
        localStorage.removeItem('token');
        localStorage.removeItem('lender');
        window.location.href = '/lender/login';
      } else {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Authentication endpoints
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, password) => api.post(`/auth/reset-password/${token}`, { password }),
};

// PSP endpoints
export const pspAPI = {
  getProfile: () => api.get('/psp/profile'),
  updateProfile: (data) => api.put('/psp/profile', data),
  applyForLimit: (data) => api.post('/psp/apply-limit', data),
  getOrderBook: () => api.get('/psp/order-book'),
  requestFinancing: (data) => api.post('/psp/request-financing', data),
  getFinancingRequest: (id) => api.get(`/psp/financing-requests/${id}`),
  getActiveFinancings: () => api.get('/psp/active-financings'),
  getRepaymentQuote: (requestId) => api.get(`/psp/repayment-quote/${requestId}`),
  processRepayment: (data) => api.post('/psp/process-repayment', data),
  requestRepayment: (data) => api.post('/psp/request-repayment', data),

  // Account Settings (Shared)
  getProfileData: () => api.get('/psp/profile'),
  updateProfileData: (data) => api.put('/psp/update-profile', data),
  changePassword: (data) => api.post('/auth/change-password', data),

  getPoolStatus: () => api.get('/psp/pool-status'),
  getCreditLineExpiry: () => api.get('/psp/credit-line-expiry'),

  // Maintenance fee endpoints
  getCurrentMaintenanceCharge: () => api.get('/maintenance/current'),
  getMaintenanceSummary: () => api.get('/maintenance/summary'),
  getMaintenanceCharges: () => api.get('/maintenance/charges'),
  payMaintenanceFee: (chargeId, data) => api.post(`/maintenance/pay/${chargeId}`, data),
  uploadDocument: (data) => api.post('/psp/upload-document', data),
  deleteDocument: (id) => api.delete(`/psp/documents/${id}`),
  downloadDocument: (id) => api.get(`/psp/documents/${id}/download`, { responseType: 'blob' }),
  updateFinancingReceipt: (data) => api.patch('/psp/financing-requests/receipt', data),
  clAction: (data) => api.post('/psp/cl-action', data),
  addNegotiationNote: (data) => api.post('/psp/cl-negotiate', data),
};

// Admin endpoints (KAM, CAD, CRO, VIEW_ONLY)
export const adminAPI = {
  getApplications: (params) => api.get('/admin/applications', { params }),
  getApplication: (id) => api.get(`/admin/applications/${id}`),
  forwardToCAD: (id, data) => api.post(`/admin/applications/${id}/forward-to-cad`, data),
  forwardToCRO: (id, data) => api.post(`/admin/applications/${id}/forward-to-cro`, data),
  returnToKAM: (id, data) => api.post(`/admin/applications/${id}/return-to-kam`, data),
  saveCreditScore: (id, data) => api.post(`/admin/applications/${id}/score`, data),
  saveAIScanReport: (id, data) => api.post(`/admin/applications/${id}/ai-scan-report`, data),
  startAIScan: (id) => api.post(`/admin/applications/${id}/ai-scan`),
  approveApplication: (id, data) => api.post(`/admin/applications/${id}/approve`, data),
  rejectApplication: (id, data) => api.post(`/admin/applications/${id}/reject`, data),
  requestInfo: (id, data) => api.post(`/admin/applications/${id}/request-info`, data),
  uploadApplicationDocument: (id, data) => api.post(`/admin/applications/${id}/upload-document`, data),
  getDocumentContent: (docId) => api.get(`/admin/documents/${docId}`),
  downloadDocument: (docId) => api.get(`/admin/documents/${docId}/download`, { responseType: 'blob' }),
  getStats: () => api.get('/admin/stats'),
  getAlerts: () => api.get('/admin/alerts'),
  getUsers: () => api.get('/admin/users'),
  getUserDetail: (id) => api.get(`/admin/users/${id}`),
  getAuditLogs: (id) => api.get(`/admin/applications/${id}/audit-log`),
  approveOnboarding: (id) => api.post(`/admin/applications/${id}/approve-onboarding`),

  // Pool Management Endpoints
  replenishPool: (id, data) => api.post(`/admin/pools/${id}/replenish`, data),
  replenishFees: (id, data) => api.post(`/admin/pools/${id}/replenish-fees`, data),
  triggerPenalty: (id, data) => api.post(`/admin/pools/${id}/trigger-penalty`, data),
  pausePool: (id, data) => api.post(`/admin/pools/${id}/pause`, data),
  unpausePool: (id) => api.post(`/admin/pools/${id}/unpause`),
  computeUnutilizedFee: (id) => api.get(`/admin/pools/${id}/compute-unutilized-fee`),

  // Financing Requests Review (Manual Flow)
  getPendingFinancing: () => api.get('/admin/financing/pending'),
  validateFinancing: (id) => api.get(`/admin/financing/${id}/validate`),
  // body: { txHash?, blockNumber? } — pasted by the CAD from the Safe
  // transaction history. Enables exact tx_hash match in SAFE-Observer.
  confirmFinancing: (id, body = {}) => api.post(`/admin/financing/${id}/confirm`, body),

  // Repayment Confirmation
  getPendingRepayments: () => api.get('/admin/repayments/pending'),
  // body: { txHash?, blockNumber? } — same purpose as confirmFinancing.
  confirmRepayment: (id, body = {}) => api.post(`/admin/repayments/${id}/confirm`, body),

  // transaction monitoring
  getRepaymentHistory: (params) => api.get('/admin/repayment-history', { params }),
  getAllFinancings: (params) => api.get('/admin/all-financings', { params }),
  getOrderBook: (params) => api.get('/admin/order-book', { params }),

  // Reconciled lifecycle (added 2026-04-11, feat/observer-lifecycle-integration).
  // Returns the LATEST drawdown's lifecycle for the orderRef. Use the
  // drawdownId-based lookup below when you need an unambiguous answer
  // (revolving credit allows multiple drawdowns per orderRef).
  getCreditLineLifecycle: (reference) =>
    api.get(`/admin/credit-lines/${encodeURIComponent(reference)}/lifecycle`),

  // Returns ONE specific drawdown's lifecycle by FinancingRequest._id.
  // Unambiguous; use when iterating draws under a duplicate orderRef.
  getDrawdownLifecycle: (drawdownId) =>
    api.get(`/admin/drawdowns/${encodeURIComponent(drawdownId)}/lifecycle`),

  // Returns ALL drawdowns under an orderRef in one call (newest first).
  // Each entry has its own paymate + observer blocks. Lets the FE render
  // a multi-drawdown lifecycle without N+1 fetches.
  getCreditLineLifecycles: (reference) =>
    api.get(`/admin/credit-lines/${encodeURIComponent(reference)}/lifecycles`),

  // Unmatched vault activity — Safe transactions with no PayMate record.
  // Flagged as unusual/unmapped for admin investigation. Added 2026-04-12.
  getUnmatchedVaultActivity: () => api.get('/admin/unmatched-vault-activity'),

  // CL Flow Endpoints
  forwardToTermSheet: (id) => api.post(`/admin/applications/${id}/forward-to-term-sheet`),
  shareAgreement: (id, data) => api.post(`/admin/applications/${id}/share-agreement`, data),
  addNegotiationNote: (id, text, options = {}) => api.post(`/admin/applications/${id}/negotiate`, { text, ...options }),
  moveStep: (id, data) => api.post(`/admin/applications/${id}/move-step`, data),
  getSegments: () => api.get('/segment'),
};

// CFO endpoints
export const cfoAPI = {
  getStats: () => api.get('/cfo/stats'),
  getDashboardStats: () => api.get('/cfo/dashboard-stats'),
  getAllFinancings: () => api.get('/admin/all-financings'),
  getExposure: () => api.get('/cfo/exposure'),
  getYieldHistory: () => api.get('/cfo/yield-history'),
  getEarnedYieldHistory: () => api.get('/cfo/earned-yield-history'),
  getYieldAnalytics: () => api.get('/cfo/yield-analytics'),
  getRepaymentHistory: (params) => api.get('/admin/repayment-history', { params }),
};

// Notification endpoints
export const notificationAPI = {
  getNotifications: () => api.get('/notifications'),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markAllRead: () => api.put('/notifications/mark-all-read'),
  markRead: (id) => api.put(`/notifications/${id}/mark-read`),
};

// Support endpoints
export const supportAPI = {
  getTickets: () => api.get('/support/tickets'),
  getTicket: (id) => api.get(`/support/tickets/${id}`),
  createTicket: (data) => api.post('/support/tickets', data),
  addMessage: (id, data) => api.post(`/support/tickets/${id}/message`, data),
  closeTicket: (id) => api.post(`/support/tickets/${id}/close`),
};

// RAG/Projects API Instance
const ragApiInstance = axios.create({
  baseURL: 'https://ai-beta.invoicemate.net/rag-api',
  headers: {
    'Content-Type': 'application/json',
  },
});

ragApiInstance.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

ragApiInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// RAG/Projects endpoints
export const ragAPI = {
  // Users
  createUser: (userId) => ragApiInstance.post('/api/user/create', { userId }),

  // Projects
  getProjects: () => ragApiInstance.get('/api/projects/'),
  createProject: (data) => ragApiInstance.post('/api/projects/', data),
  getProject: (projectId) => ragApiInstance.get(`/api/projects/${projectId}`),
  deleteProject: (projectId) => ragApiInstance.delete(`/api/projects/${projectId}`),
  getProjectSettings: (projectId) => ragApiInstance.get(`/api/projects/${projectId}/settings`),
  updateProjectSettings: (projectId, data) => ragApiInstance.put(`/api/projects/${projectId}/settings`, data),

  // Documents & URLs (Knowledge Base)
  getDocuments: (projectId) => ragApiInstance.get(`/api/projects/${projectId}/files`),
  getUploadUrl: (projectId, data) => ragApiInstance.post(`/api/projects/${projectId}/files/upload-url`, data),
  confirmUpload: (projectId, data) => ragApiInstance.post(`/api/projects/${projectId}/files/confirm`, data),
  scrapeUrl: (projectId, data) => ragApiInstance.post(`/api/projects/${projectId}/urls`, data),
  deleteDocument: (projectId, docId) => ragApiInstance.delete(`/api/projects/${projectId}/files/${docId}`),
  getDocumentChunks: (projectId, docId) => ragApiInstance.get(`/api/projects/${projectId}/files/${docId}/chunks`),

  // Conversations & AI Chat
  getChats: (projectId) => ragApiInstance.get(`/api/projects/${projectId}/chats`),
  createChat: (data) => ragApiInstance.post('/api/chats/', data),
  getChatHistory: (chatId) => ragApiInstance.get(`/api/chats/${chatId}`),
  deleteChat: (chatId) => ragApiInstance.delete(`/api/chats/${chatId}`),
  streamMessage: async (projectId, chatId, content, clerkId) => {
    return fetch(`${ragApiInstance.defaults.baseURL}/api/projects/${projectId}/chats/${chatId}/messages/stream?clerk_id=${clerkId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content })
    });
  },
  submitFeedback: (data) => ragApiInstance.post('/api/feedback', data),
};

export default api;
