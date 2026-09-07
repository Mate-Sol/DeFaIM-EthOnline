import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ragAPI } from '../../services/api';
import { Loader2, ArrowLeft, Upload, Trash2, FileText, Send, Plus, Globe, CheckCircle, User, Bot, ThumbsUp, ThumbsDown, Settings, Presentation, File, AlertCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../context/AuthContext';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import ProcessingPipelineModal from '../../components/rag/ProcessingPipelineModal';
import Sidebar from '../../components/Sidebar';

const STRATEGY_OPTIONS = [
  {
    value: 'basic',
    label: 'Vector Search',
    description: 'Semantic similarity matching',
  },
  {
    value: 'hybrid',
    label: 'Hybrid Search',
    description: 'Semantic + keyword matching',
  },
  {
    value: 'multi-query-vector',
    label: 'Multi-Query Vector',
    description: 'Multiple semantic queries',
  },
  {
    value: 'multi-query-hybrid',
    label: 'Multi-Query Hybrid',
    description: 'Multiple hybrid queries',
  },
];

const RERANKING_MODELS = [
  { value: 'rerank-english-v3.0', label: 'rerank-english-v3.0' },
];

const EMBEDDING_MODELS = [
  { value: 'text-embedding-3-large', label: 'text-embedding-3-large' },
];

const AGENT_MODE_OPTIONS = [
  {
    value: 'simple',
    label: 'Simple RAG',
    description: 'Documents-only search',
  },
  {
    value: 'agentic',
    label: 'Agentic RAG',
    description: 'Smart tool selection with web search',
  },
];


const RAGChat = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [documents, setDocuments] = useState([]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [agentStatus, setAgentStatus] = useState('');

  // Knowledge Base states
  const [urlInput, setUrlInput] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [pipelineDocument, setPipelineDocument] = useState(null);
  const [activeTab, setActiveTab] = useState('documents');
  const [projectSettings, setProjectSettings] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    // Extract chatId from URL if present
    const searchParams = new URLSearchParams(location.search);
    const paramChatId = searchParams.get('chatId');
    if (paramChatId) setChatId(paramChatId);

    fetchProjectAndMessages(paramChatId);
  }, [projectId, location.search]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchProjectAndMessages = async (currentChatId) => {
    try {
      setLoading(true);
      const [projectRes, docsRes, chatsRes, settingsRes] = await Promise.all([
        ragAPI.getProject(projectId),
        ragAPI.getDocuments(projectId),
        ragAPI.getChats(projectId),
        ragAPI.getProjectSettings(projectId).catch(err => {
          console.error("Failed to fetch settings, falling back:", err);
          return { data: { data: null } };
        })
      ]);

      setProject(projectRes.data?.data || projectRes.data);
      setDocuments(docsRes.data?.data || docsRes.data || []);
      const settingsData = settingsRes.data?.data || settingsRes.data;
      setProjectSettings(settingsData);

      const chatList = chatsRes.data?.data || chatsRes.data || [];
      let activeChatId = currentChatId;

      if (!activeChatId && chatList.length > 0) {
        activeChatId = chatList[0].id || chatList[0]._id;
        setChatId(activeChatId);
      }

      if (activeChatId) {
        try {
          const historyRes = await ragAPI.getChatHistory(activeChatId);
          const historyData = historyRes.data?.data || historyRes.data;

          if (Array.isArray(historyData)) {
            setMessages(historyData);
          } else if (historyData && Array.isArray(historyData.messages)) {
            setMessages(historyData.messages);
          } else {
            setMessages([]);
          }
        } catch (err) {
          console.error("Failed to fetch history:", err);
          setMessages([]);
        }
      } else {
        // Create initial chat if none exists
        const createRes = await ragAPI.createChat({
          title: `Chat for ${projectRes.data?.data?.name || 'New Project'}`,
          project_id: projectId
        });
        const newChat = createRes.data?.data || createRes.data;
        setChatId(newChat.id || newChat._id);
        setMessages([]);
      }
    } catch (error) {
      toast.error('Failed to load chat');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = (updates) => {
    setProjectSettings(prev => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });
  };

  const handleApplySettings = async () => {
    if (!projectSettings) return;
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await ragAPI.updateProjectSettings(projectId, projectSettings);
      const updatedSettings = res.data?.data || res.data;
      setProjectSettings(updatedSettings);
      toast.success('Settings saved successfully!');
    } catch (err) {
      console.error(err);
      setSettingsError('Failed to save settings!');
      toast.error('Failed to save settings!');
    } finally {
      setSettingsLoading(false);
    }
  };

  const getPerformanceMetrics = () => {
    if (!projectSettings) return { totalChunks: 0, latency: 0 };

    const strategyConfig = {
      basic: { latency: 400 },
      hybrid: { latency: 600 },
      'multi-query-vector': { latency: 800 },
      'multi-query-hybrid': { latency: 1000 },
    }[projectSettings.rag_strategy] || { latency: 400 };

    const isMultiQuery = projectSettings.rag_strategy?.includes('multi-query');
    const totalChunks =
      projectSettings.chunks_per_search *
      (isMultiQuery ? projectSettings.number_of_queries : 1);

    const baseLatency = strategyConfig.latency;
    const queryLatency = isMultiQuery
      ? projectSettings.number_of_queries * 200
      : 0;
    const rerankingLatency = projectSettings.reranking_enabled ? 200 : 0;

    const latency = baseLatency + queryLatency + rerankingLatency;

    return { totalChunks, latency };
  };

  const fetchDocumentsOnly = async () => {
    try {
      const docsRes = await ragAPI.getDocuments(projectId);
      const updatedDocs = docsRes.data?.data || docsRes.data || [];
      setDocuments(updatedDocs);

      setPipelineDocument(prev => {
        if (!prev) return prev;
        const updated = updatedDocs.find(d => d.id === prev.id);
        return updated || prev;
      });
    } catch (err) {
      console.error("Failed to refresh documents", err);
    }
  };

  useEffect(() => {
    const hasProcessing = documents.some(doc => !['completed', 'failed'].includes(doc.processing_status));
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchDocumentsOnly();
    }, 5000);

    return () => clearInterval(interval);
  }, [projectId, documents]);

  const handleSendMessageFromInput = async (inputContent) => {
    if (!inputContent.trim() || !chatId) return;

    const userMessageContent = inputContent;

    const optimisticUserMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, optimisticUserMessage]);
    setSending(true);
    setIsStreaming(false);
    setStreamingMessage('');
    setAgentStatus('');

    try {
      const clerkId = user?.id || user?._id || 'unknown';
      const response = await ragAPI.streamMessage(projectId, chatId, userMessageContent, clerkId);

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep the last incomplete line

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('event:')) {
            currentEvent = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            const dataStr = line.substring(5).trim();
            if (dataStr === '[DONE]') break;

            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === 'status') {
                setAgentStatus(data.status);
              } else if (currentEvent === 'token') {
                setSending(false);
                setIsStreaming(true);
                let text = '';
                if (typeof data === 'string') {
                  text = data;
                } else if (data.content) {
                  text = data.content;
                }
                setStreamingMessage(prev => prev + text);
                setAgentStatus('');
              } else if (currentEvent === 'done') {
                setMessages(prev => {
                  return [
                    ...prev.filter(m => m.id !== optimisticUserMessage.id),
                    data.userMessage,
                    data.aiMessage
                  ];
                });
                setIsStreaming(false);
                setStreamingMessage('');
                setAgentStatus('');
              } else if (currentEvent === 'error') {
                toast.error(data.detail || data.message || 'Streaming error');
              } else if (!currentEvent) {
                // fallback if no event type
                let text = '';
                if (typeof data === 'string') {
                  text = data;
                } else if (data.content) {
                  text = data.content;
                }
                setStreamingMessage(prev => prev + text);
              }
            } catch (e) {
              if (currentEvent === 'token' && dataStr) {
                let text = dataStr;
                if (text.startsWith('"') && text.endsWith('"')) {
                  try { text = JSON.parse(text); } catch (err) { }
                }
                setStreamingMessage(prev => prev + text);
              }
            }
          } else if (line.trim() === '') {
            currentEvent = null; // reset event on empty line
          }
        }
      }
    } catch (error) {
      toast.error('Failed to send message');
      console.error(error);
      setMessages(prev => prev.filter(m => m.id !== optimisticUserMessage.id));
    } finally {
      setSending(false);
      setIsStreaming(false);
      setStreamingMessage('');
      setAgentStatus('');
    }
  };

  const handleDeleteDocument = async (docId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    try {
      await ragAPI.deleteDocument(projectId, docId);
      setDocuments(documents.filter(d => d.id !== docId));
      toast.success('Document deleted');
    } catch (error) {
      toast.error('Failed to delete document');
    }
  };

  const onDocumentUpload = async (files) => {
    const allowedExtensions = ['.pdf', '.docx', '.pptx', '.xlsx', '.xls', '.txt', '.csv'];
    const validFiles = files.filter(file => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      console.log(`Checking file: ${file.name} | Detected Ext: ${ext} | Original Type: ${file.type}`);
      if (!allowedExtensions.includes(ext)) {
        console.warn(`File REJECTED due to extension: ${file.name}`);
        toast.error(`${file.name} is not supported. Please upload PDF, DOCX, PPT, XLSX, XLS, TXT, or CSV.`, { id: 'rejection' });
        return false;
      }
      return true;
    });

    console.log("Valid files to process:", validFiles);
    if (validFiles.length === 0) return;
    try {
      toast.loading(`Uploading ${validFiles.length} file(s)...`, { id: 'upload' });
      for (const file of validFiles) {
        // Forcefully map standard MIME type by extension to override custom OS types (like WPS Office)
        let mimeType = file.type;
        const fileExt = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '';
        const standardMimeTypes = {
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.xls': 'application/vnd.ms-excel',
          '.pdf': 'application/pdf',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.csv': 'text/csv',
          '.txt': 'text/plain'
        };

        if (standardMimeTypes[fileExt]) {
          mimeType = standardMimeTypes[fileExt];
        } else if (!mimeType) {
          mimeType = 'application/octet-stream';
        }

        console.log(`Mapped MIME Type sent to backend for ${file.name}:`, mimeType);

        const response = await ragAPI.getUploadUrl(projectId, {
          filename: file.name,
          file_size: file.size,
          file_type: mimeType
        });
        const uploadUrl = response.data?.data?.upload_url;
        const s3Key = response.data?.data?.s3_key;

        if (!uploadUrl || !s3Key) throw new Error('Failed to get upload URL');

        await axios.put(uploadUrl, file, {
          headers: { 'Content-Type': mimeType }
        });
        await ragAPI.confirmUpload(projectId, { s3_key: s3Key });
      }
      toast.success('Upload complete!', { id: 'upload' });
      fetchDocumentsOnly();
    } catch (err) {
      toast.error('Upload failed', { id: 'upload' });
      console.error(err);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDocumentUpload
  });

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!urlInput.trim() || isAddingUrl) return;
    setIsAddingUrl(true);
    try {
      await ragAPI.scrapeUrl(projectId, { url: urlInput.trim() });
      setUrlInput('');
      toast.success('URL added successfully');
      fetchDocumentsOnly();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add URL');
    } finally {
      setIsAddingUrl(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex overflow-hidden">
        <Sidebar />
        <main className="ml-64 flex-1 flex flex-col h-screen p-4">
          <div className="max-w-7xl mx-auto h-[85vh] p-4 w-full flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-brand-purple mb-3" />
          </div>
        </main>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-hidden">
      <Sidebar />
      <main className="ml-64 flex-1 flex flex-col h-screen p-4">
        <div className="max-w-7xl mx-auto h-full w-full flex gap-4">

          {/* Left Column: Chat Interface */}
          <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm h-full relative">
            {/* Header */}
            <div className="bg-white/50 backdrop-blur-sm border-b border-gray-100 flex-shrink-0 z-10">
              <div className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => navigate(`/rag/projects/${projectId}`)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-brand-purple/10 text-gray-400 hover:text-brand-purple transition-colors"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div>
                    <h1 className="text-lg font-bold text-gray-800">{project.name}</h1>
                    <p className="text-xs text-gray-500 font-medium">{documents.length} sources indexed</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-6 scrollbar-thin relative z-0">
              {messages.length === 0 && (
                <div className="absolute w-[70%] h-[70%] top-[15%] left-[15%] animate-gradient opacity-10 blur-3xl pointer-events-none rounded-full"
                  style={{ background: 'linear-gradient(45deg, #0ea5e9, #3b82f6, transparent)' }} />
              )}

              {messages.length === 0 && !isStreaming && !sending ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12 relative z-10">
                  <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-brand-purple/5 text-brand-purple mb-4 border border-brand-purple/10 shadow-sm">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-3">Ready to start?</h2>
                  <p className="text-gray-500 text-sm max-w-md font-medium leading-relaxed">
                    Ask questions about your documents to get intelligent answers powered by RAG.
                  </p>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto px-6 py-4 w-full space-y-8">
                  {messages.map((message) => {
                    const isUser = message.role === 'user';
                    const time = new Date(message.created_at || message.timestamp || Date.now()).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const sources = message.citations || message.sources || [];

                    return (
                      <div key={message.id} className="group">
                        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] ${isUser ? "ml-12" : "mr-12"} relative`}>
                            {/* Avatar & Message Container */}
                            <div className="flex items-start gap-3">
                              {/* Avatar - Only show for assistant */}
                              {!isUser && (
                                <div className="flex-shrink-0 w-8 h-8 bg-brand-purple/5 border border-brand-purple/10 rounded-xl flex items-center justify-center mt-1 shadow-sm">
                                  <Bot size={16} className="text-brand-purple" />
                                </div>
                              )}

                              {/* Message Bubble */}
                              <div
                                className={`rounded-2xl p-4 border transition-all ${isUser
                                  ? "bg-brand-purple text-white border-brand-purple shadow-md shadow-brand-purple/10 rounded-tr-none"
                                  : "bg-gray-100 text-gray-900 border-gray-200 hover:border-gray-300 rounded-tl-none font-medium"
                                  }`}
                              >
                                <div className={`prose prose-sm max-w-none break-words ${isUser ? 'prose-invert text-white' : 'text-gray-900'}`}>
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      img: ({ node, ...props }) => {
                                        if (!props.src) return null;
                                        return <img {...props} className="max-w-full h-auto rounded-lg shadow-sm border border-gray-200 mt-2 max-h-64 object-contain bg-white" />;
                                      },
                                      a: ({ node, ...props }) => {
                                        return <a {...props} className="text-brand-purple font-semibold hover:underline" />;
                                      }
                                    }}
                                  >
                                    {message.content}
                                  </ReactMarkdown>
                                </div>
                              </div>

                              {/* User Avatar - Only show for user */}
                              {isUser && (
                                <div className="flex-shrink-0 w-8 h-8 bg-gray-100 border border-gray-200 rounded-xl flex items-center justify-center mt-1 shadow-sm">
                                  <User size={16} className="text-gray-600" />
                                </div>
                              )}
                            </div>

                            {/* Timestamp */}
                            <div
                              className={`flex items-center gap-2 mt-2 px-1 ${isUser ? "justify-end" : "justify-start ml-10"
                                }`}
                            >
                              <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                {time}
                              </span>
                              {!isUser && (
                                <div className="w-1 h-1 bg-gray-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Citations UI */}
                        {!isUser && sources && sources.length > 0 && (
                          <div className="mt-6 ml-0">
                            <div className="bg-gray-50/50 border border-gray-100 rounded-xl p-5">
                              <div className="flex items-center gap-3 mb-4">
                                <div className="w-5 h-5 bg-white border border-gray-200 rounded-md flex items-center justify-center shadow-sm">
                                  <FileText size={12} className="text-brand-purple" />
                                </div>
                                <span className="text-sm font-bold text-gray-900">
                                  Sources ({sources.length})
                                </span>
                              </div>

                              <div className="grid gap-2">
                                {sources.map((citation, citationIndex) => (
                                  <div
                                    key={citationIndex}
                                    className="flex items-center gap-3 bg-white hover:bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200 hover:border-brand-purple/20 transition-all shadow-sm group/citation"
                                  >
                                    {/* Document Icon */}
                                    <div className="flex-shrink-0 w-7 h-7 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-center group-hover/citation:border-brand-purple/30">
                                      <FileText size={12} className="text-gray-400 group-hover/citation:text-brand-purple transition-colors" />
                                    </div>

                                    {/* Citation Info */}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-gray-900 truncate">
                                        {typeof citation === 'string' ? citation : citation.filename || citation.source}
                                      </p>
                                      {citation.page && (
                                        <p className="text-xs text-gray-500 mt-0.5 font-medium">
                                          Page {citation.page}
                                        </p>
                                      )}
                                    </div>

                                    {/* Page Number Badge */}
                                    {citation.page && (
                                      <div className="flex-shrink-0">
                                        <div className="w-6 h-6 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-center">
                                          <span className="text-xs font-bold text-gray-600">
                                            {citation.page}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Streaming Message */}
                  {isStreaming && streamingMessage && (
                    <div className="group">
                      <div className="flex justify-start">
                        <div className="max-w-[85%] mr-12 relative">
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-8 h-8 bg-brand-purple/5 border border-brand-purple/10 rounded-xl flex items-center justify-center mt-1 shadow-sm">
                              <Bot size={16} className="text-brand-purple" />
                            </div>
                            <div className="bg-gray-100 border border-gray-200 rounded-2xl p-4 rounded-tl-none shadow-sm font-medium">
                              <div className="prose prose-sm max-w-none break-words text-gray-900">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {streamingMessage}
                                </ReactMarkdown>
                              </div>

                              {/* Typing Indicator */}
                              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-200">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-1.5 h-1.5 bg-brand-purple rounded-full animate-bounce"></div>
                                  <div
                                    className="w-1.5 h-1.5 bg-brand-purple rounded-full animate-bounce"
                                    style={{ animationDelay: "0.1s" }}
                                  ></div>
                                  <div
                                    className="w-1.5 h-1.5 bg-brand-purple rounded-full animate-bounce"
                                    style={{ animationDelay: "0.2s" }}
                                  ></div>
                                </div>
                                <span className="text-xs text-gray-500 ml-2 font-bold uppercase tracking-wider">
                                  AI is typing...
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Loading State - with dynamic status */}
                  {sending && !isStreaming && (
                    <div className="flex justify-start">
                      <div className="bg-gray-50 border border-gray-200 rounded-full px-6 py-3 shadow-sm ml-11">
                        <div className="flex items-center gap-3">
                          <Loader2 size={16} className="text-brand-purple animate-spin" />
                          <span className="text-sm text-gray-600 font-bold tracking-tight">
                            {agentStatus || "Thinking..."}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="mt-auto border-t border-gray-100 bg-gray-50 p-4 z-10 relative">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inputMessage.trim() && !sending) {
                    handleSendMessageFromInput(inputMessage);
                    setInputMessage('');
                  }
                }}
                className="flex items-center gap-3 bg-white p-1.5 pl-4 pr-1.5 rounded-2xl border border-gray-200 shadow-sm focus-within:border-brand-purple/50 focus-within:ring-2 focus-within:ring-brand-purple/10 transition-all"
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Ask a question about your documents..."
                  className="flex-1 bg-transparent border-none outline-none text-gray-700 text-sm py-2.5 font-medium placeholder:font-normal"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={!inputMessage.trim() || sending}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-brand-purple hover:bg-brand-purple-dark text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 active:scale-95"
                >
                  {sending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5 pl-0.5" />
                  )}
                </button>
              </form>
              <p className="text-[10px] text-gray-400 font-medium text-center mt-3">
                AI can make mistakes. Verify important information.
              </p>
            </div>
          </div>

          {/* Right Column: Knowledge Base Sidebar */}
          <div className="w-80 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 bg-white">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <div className="w-8 h-8 bg-brand-purple/10 rounded-lg flex items-center justify-center">
                    <FileText size={16} className="text-brand-purple" />
                  </div>
                  Knowledge Base
                </h2>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 bg-gray-50 p-1 mx-4 mt-4 rounded-xl">
              <button
                onClick={() => setActiveTab('documents')}
                className={`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'documents'
                    ? "bg-white shadow-sm text-brand-purple"
                    : "text-gray-500 hover:text-gray-800"
                  }`}
              >
                <FileText size={14} />
                <span>Docs</span>
                {documents.length > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'documents'
                        ? "bg-brand-purple text-white"
                        : "bg-gray-200 text-gray-600"
                      }`}
                  >
                    {documents.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'settings'
                    ? "bg-white shadow-sm text-brand-purple"
                    : "text-gray-500 hover:text-gray-800"
                  }`}
              >
                <Settings size={14} />
                <span>Config</span>
                {settingsError && (
                  <div className="w-2 h-2 bg-red-500 rounded-full shadow-sm"></div>
                )}
              </button>
            </div>

            {/* Tab Contents */}
            <div className="p-5 space-y-6 overflow-y-auto flex-1 scrollbar-thin">
              {activeTab === 'documents' ? (
                <>
                  <section className="space-y-4">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Add Sources</h3>
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${isDragActive
                        ? 'border-brand-purple bg-brand-purple/5'
                        : 'border-gray-200 hover:border-brand-purple/50 bg-gray-50/50 hover:bg-brand-purple/5'
                        }`}
                    >
                      <input {...getInputProps()} />
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-sm">
                          <Upload className="h-5 w-5 text-brand-purple" />
                        </div>
                        <div>
                          <p className="text-sm text-gray-800 font-bold">
                            {isDragActive ? 'Drop files here' : 'Upload Documents'}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-1 font-medium">PDF, DOCX, PPT, XLSX, XLS, CSV, TXT</p>
                        </div>
                      </div>
                    </div>

                    <div className="relative py-2">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-gray-200"></span>
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-white px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest italic">or insert link</span>
                      </div>
                    </div>

                    <form onSubmit={handleUrlSubmit} className="space-y-3">
                      <div className="relative group">
                        <Globe size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 group-focus-within:text-brand-purple transition-colors" />
                        <input
                          type="text"
                          placeholder="Website URL"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          disabled={isAddingUrl}
                          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-purple shadow-sm text-sm text-gray-800 font-medium"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!urlInput.trim() || isAddingUrl}
                        className="w-full px-4 py-2.5 bg-brand-purple hover:bg-brand-purple-dark disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-lg transition-all text-sm font-bold flex items-center justify-center gap-2"
                      >
                        {isAddingUrl ? <><Loader2 size={16} className="animate-spin text-white" /> Adding...</> : <><Plus size={16} /> Add Link</>}
                      </button>
                    </form>
                  </section>

                  <hr className="border-gray-100" />

                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Your Sources</h3>
                      <span className="text-[10px] font-bold text-brand-purple bg-brand-purple/10 px-2 py-0.5 rounded-full">
                        {documents.length}
                      </span>
                    </div>

                    {documents.length === 0 ? (
                      <div className="text-center py-8 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                        <FileText size={16} className="text-gray-400 mx-auto mb-2" />
                        <p className="text-xs text-gray-500 font-bold">No sources added yet</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="group bg-white border border-gray-100 rounded-lg p-3 hover:border-brand-purple/20 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-800 truncate">{doc.filename}</p>
                                <div className="flex items-center justify-between mt-1.5">
                                  {doc.processing_status === 'completed' ? (
                                    <button onClick={() => setPipelineDocument(doc)} className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full hover:bg-emerald-100 transition-colors">
                                      <CheckCircle size={10} /> Ready
                                    </button>
                                  ) : doc.processing_status === 'failed' ? (
                                    <button onClick={() => setPipelineDocument(doc)} className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full hover:bg-red-100 transition-colors">
                                      Failed
                                    </button>
                                  ) : (
                                    <button onClick={() => setPipelineDocument(doc)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors">
                                      <Loader2 size={10} className="animate-spin" /> {(doc.processing_status || 'Processing').charAt(0).toUpperCase() + (doc.processing_status || 'Processing').slice(1)}...
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteDocument(doc.id)}
                                    className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="space-y-6">
                  {settingsError && (
                    <div className="border border-red-200 bg-red-50 text-red-700 rounded-lg p-3 text-xs flex items-center gap-2">
                      <AlertCircle size={14} className="flex-shrink-0" />
                      <span>{settingsError}</span>
                    </div>
                  )}

                  {projectSettings ? (
                    <div className={`space-y-6 ${settingsLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                      {/* Embedding Model */}
                      <section className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                            Embedding Model
                          </h3>
                          <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center shadow-sm ${documents.length > 0 ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-blue-50 text-blue-600 border border-blue-100"
                              }`}
                            title={
                              documents.length > 0
                                ? "Locked (documents uploaded)"
                                : "Locked after first document upload"
                            }
                          >
                            <Info size={10} />
                          </div>
                        </div>
                        <select
                          value={projectSettings.embedding_model}
                          onChange={(e) => handleUpdateSettings({ embedding_model: e.target.value })}
                          disabled={documents.length > 0 || settingsLoading}
                          className="w-full p-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-purple text-xs font-bold text-gray-800 disabled:opacity-50 transition-all shadow-sm"
                        >
                          {EMBEDDING_MODELS.map((model) => (
                            <option key={model.value} value={model.value}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                        {documents.length > 0 && (
                          <p className="text-[10px] text-amber-600 font-bold italic px-1">
                            Existing vectors detected. Model is locked.
                          </p>
                        )}
                      </section>

                      <hr className="border-gray-100" />

                      {/* Search Strategy */}
                      <section className="space-y-3">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                          Search Strategy
                        </h3>
                        <div className="space-y-2">
                          {STRATEGY_OPTIONS.map((strategy) => (
                            <label
                              key={strategy.value}
                              className={`block p-3 rounded-xl border cursor-pointer transition-all ${projectSettings.rag_strategy === strategy.value
                                  ? "border-brand-purple bg-brand-purple/5 shadow-sm"
                                  : "border-gray-200 bg-white hover:border-brand-purple/20"
                                }`}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="radio"
                                  name="ragStrategy"
                                  value={strategy.value}
                                  checked={projectSettings.rag_strategy === strategy.value}
                                  onChange={(e) => handleUpdateSettings({ rag_strategy: e.target.value })}
                                  disabled={settingsLoading}
                                  className="w-4 h-4 text-brand-purple bg-white border-gray-300 focus:ring-brand-purple focus:ring-offset-0"
                                />
                                <div className="flex-1">
                                  <div className="text-xs font-bold text-gray-800">
                                    {strategy.label}
                                  </div>
                                  <div className="text-[10px] text-gray-500 font-medium mt-0.5">
                                    {strategy.description}
                                  </div>
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </section>

                      <hr className="border-gray-100" />

                      {/* Search Parameters */}
                      <section className="space-y-4">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                          Parameters
                        </h3>

                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-xs text-gray-500">
                            <span>Chunks per Search</span>
                            <span className="font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{projectSettings.chunks_per_search}</span>
                          </div>
                          <input
                            type="range"
                            min={5}
                            max={30}
                            value={projectSettings.chunks_per_search}
                            onChange={(e) => handleUpdateSettings({ chunks_per_search: parseInt(e.target.value) })}
                            disabled={settingsLoading}
                            className="w-full accent-brand-purple h-1 bg-gray-200 rounded-lg cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-xs text-gray-500">
                            <span>Final Context Size</span>
                            <span className="font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{projectSettings.final_context_size}</span>
                          </div>
                          <input
                            type="range"
                            min={3}
                            max={10}
                            value={projectSettings.final_context_size}
                            onChange={(e) => handleUpdateSettings({ final_context_size: parseInt(e.target.value) })}
                            disabled={settingsLoading}
                            className="w-full accent-brand-purple h-1 bg-gray-200 rounded-lg cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-xs text-gray-500">
                            <span>Similarity Threshold</span>
                            <span className="font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{projectSettings.similarity_threshold}</span>
                          </div>
                          <input
                            type="range"
                            min={0.1}
                            max={0.9}
                            step={0.1}
                            value={projectSettings.similarity_threshold}
                            onChange={(e) => handleUpdateSettings({ similarity_threshold: parseFloat(e.target.value) })}
                            disabled={settingsLoading}
                            className="w-full accent-brand-purple h-1 bg-gray-200 rounded-lg cursor-pointer"
                          />
                        </div>

                        {projectSettings.rag_strategy?.includes('multi-query') && (
                          <div className="space-y-1 pt-2 border-t border-gray-100">
                            <div className="flex justify-between items-center text-xs text-gray-500">
                              <span>Number of Queries</span>
                              <span className="font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{projectSettings.number_of_queries}</span>
                            </div>
                            <input
                              type="range"
                              min={3}
                              max={7}
                              value={projectSettings.number_of_queries}
                              onChange={(e) => handleUpdateSettings({ number_of_queries: parseInt(e.target.value) })}
                              disabled={settingsLoading}
                              className="w-full accent-brand-purple h-1 bg-gray-200 rounded-lg cursor-pointer"
                            />
                          </div>
                        )}
                      </section>

                      {/* Hybrid Weights */}
                      {projectSettings.rag_strategy?.includes('hybrid') && (
                        <>
                          <hr className="border-gray-100" />
                          <section className="space-y-3">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                              Weights
                            </h3>
                            <div className="space-y-1">
                              <div className="flex justify-between items-center text-xs text-gray-500">
                                <span>Vector Weight</span>
                                <span className="font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{projectSettings.vector_weight}</span>
                              </div>
                              <input
                                type="range"
                                min={0.1}
                                max={0.9}
                                step={0.1}
                                value={projectSettings.vector_weight}
                                onChange={(e) => {
                                  const vectorWeight = parseFloat(e.target.value);
                                  handleUpdateSettings({
                                    vector_weight: vectorWeight,
                                    keyword_weight: parseFloat((1 - vectorWeight).toFixed(1)),
                                  });
                                }}
                                disabled={settingsLoading}
                                className="w-full accent-brand-purple h-1 bg-gray-200 rounded-lg cursor-pointer"
                              />
                              <div className="text-[10px] text-gray-400 mt-1 font-medium">Keyword Weight: {projectSettings.keyword_weight}</div>
                            </div>
                          </section>
                        </>
                      )}

                      <hr className="border-gray-100" />

                      {/* Advanced Reranking */}
                      <section className="space-y-3">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                          Advanced
                        </h3>
                        <label className="flex items-center gap-3 cursor-pointer bg-white border border-gray-200 p-3 rounded-xl hover:bg-gray-50 transition-all shadow-sm">
                          <input
                            type="checkbox"
                            checked={projectSettings.reranking_enabled}
                            onChange={(e) => handleUpdateSettings({ reranking_enabled: e.target.checked })}
                            disabled={settingsLoading}
                            className="w-4 h-4 text-brand-purple bg-white border-gray-300 rounded focus:ring-brand-purple focus:ring-offset-0"
                          />
                          <div className="flex-1">
                            <span className="text-xs font-bold text-gray-800">
                              Enable Reranking
                            </span>
                            <p className="text-[10px] text-gray-500 font-medium">Prioritize relevance</p>
                          </div>
                        </label>

                        {projectSettings.reranking_enabled && (
                          <div className="space-y-1.5 pl-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Model</label>
                            <select
                              value={projectSettings.reranking_model}
                              onChange={(e) => handleUpdateSettings({ reranking_model: e.target.value })}
                              disabled={settingsLoading}
                              className="w-full p-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-purple text-xs font-bold text-gray-800 shadow-sm appearance-none"
                            >
                              {RERANKING_MODELS.map((model) => (
                                <option key={model.value} value={model.value}>
                                  {model.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </section>

                      <hr className="border-gray-100" />

                      {/* Agent Mode */}
                      <section className="space-y-3">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                          Bot Behavior
                        </h3>
                        <div className="space-y-2">
                          {AGENT_MODE_OPTIONS.map((mode) => (
                            <label
                              key={mode.value}
                              className={`block p-3 rounded-xl border cursor-pointer transition-all ${projectSettings.agent_type === mode.value
                                  ? "border-brand-purple bg-brand-purple/5 shadow-sm"
                                  : "border-gray-200 bg-white hover:border-brand-purple/20"
                                }`}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="radio"
                                  name="agentMode"
                                  value={mode.value}
                                  checked={projectSettings.agent_type === mode.value}
                                  onChange={(e) => handleUpdateSettings({ agent_type: e.target.value })}
                                  disabled={settingsLoading}
                                  className="w-4 h-4 text-brand-purple bg-white border-gray-300 focus:ring-brand-purple focus:ring-offset-0"
                                />
                                <div className="flex-1">
                                  <div className="text-xs font-bold text-gray-800">
                                    {mode.label}
                                  </div>
                                  <div className="text-[10px] text-gray-500 font-medium mt-0.5">
                                    {mode.description}
                                  </div>
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </section>

                      <hr className="border-gray-100" />

                      {/* System Impact */}
                      <section className="space-y-3">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                          System Impact
                        </h3>
                        <div className="bg-gray-50 border border-gray-100 shadow-inner rounded-xl p-4">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="text-center">
                              <div className="text-xl font-black text-brand-purple">
                                {getPerformanceMetrics().totalChunks}
                              </div>
                              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mt-1">
                                Chunks
                              </div>
                            </div>
                            <div className="text-center border-l border-gray-200">
                              <div className="text-xl font-black text-gray-800">
                                {getPerformanceMetrics().latency}
                                <span className="text-xs font-normal ml-0.5">ms</span>
                              </div>
                              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mt-1">
                                Latency
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* Save Button */}
                      <button
                        onClick={handleApplySettings}
                        disabled={settingsLoading}
                        className="w-full bg-brand-purple hover:bg-brand-purple-dark disabled:bg-gray-200 text-white disabled:text-gray-400 py-3 px-4 rounded-xl transition-all font-bold uppercase tracking-wider text-xs shadow-md flex items-center justify-center gap-2"
                      >
                        <Settings size={14} className={settingsLoading ? 'animate-spin' : ''} />
                        {settingsLoading ? "Saving..." : "Save Config"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <Loader2 size={24} className="animate-spin text-brand-purple" />
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Loading Config...</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {pipelineDocument && (
        <ProcessingPipelineModal
          document={pipelineDocument}
          onClose={() => setPipelineDocument(null)}
        />
      )}
    </div>
  );
};

export default RAGChat;
