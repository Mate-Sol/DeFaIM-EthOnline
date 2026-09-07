import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ragAPI } from '../../services/api';
import { Loader2, ArrowLeft, Upload, Trash2, File, MessageSquare, Plus, Globe, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDropzone } from 'react-dropzone';
import ProcessingPipelineModal from '../../components/rag/ProcessingPipelineModal';
import Sidebar from '../../components/Sidebar';
import axios from 'axios';

const RAGProjectDetail = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [pipelineDocument, setPipelineDocument] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);

  useEffect(() => {
    fetchProjectDetails();
  }, [projectId]);

  const fetchProjectDetails = async () => {
    try {
      setLoading(true);
      const [projectRes, docsRes, chatsRes] = await Promise.all([
        ragAPI.getProject(projectId),
        ragAPI.getDocuments(projectId),
        ragAPI.getChats(projectId)
      ]);
      setProject(projectRes.data?.data);
      setDocuments(docsRes.data?.data || []);
      setChats(chatsRes.data?.data || []);
    } catch (error) {
      toast.error('Failed to fetch workspace details');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Poll for document status updates
  useEffect(() => {
    const hasProcessing = documents.some(doc => !['completed', 'failed'].includes(doc.processing_status));
    if (!hasProcessing) return;

    const interval = setInterval(async () => {
      try {
        const res = await ragAPI.getDocuments(projectId);
        const updatedDocs = res.data?.data || [];
        setDocuments(updatedDocs);

        // Also update the pipeline document if it's currently open
        setPipelineDocument(prev => {
          if (!prev) return prev;
          const updated = updatedDocs.find(d => d.id === prev.id);
          return updated || prev;
        });
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [projectId, documents]);

  const handleCreateNewChat = async () => {
    try {
      setIsCreatingChat(true);
      const chatNumber = Date.now() % 10000;
      const result = await ragAPI.createChat({
        title: `Chat #${chatNumber}`,
        project_id: projectId,
      });
      const savedChat = result.data?.data || result.data;
      navigate(`/rag/chat/${projectId}?chatId=${savedChat.id || savedChat._id}`);
      toast.success("Chat Created successfully");
    } catch (err) {
      console.error("Failed to create chat", err);
      toast.error("Failed to create chat");
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleDeleteChat = async (chatId) => {
    try {
      await ragAPI.deleteChat(chatId);
      setChats(chats.filter(c => (c.id || c._id) !== chatId));
      toast.success("Chat deleted successfully");
    } catch (err) {
      toast.error("Failed to delete chat");
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
      if (!allowedExtensions.includes(ext)) {
        toast.error(`${file.name} is not supported. Please upload PDF, DOCX, PPT, XLSX, XLS, TXT, or CSV.`, { id: 'rejection' });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;
    try {
      toast.loading(`Uploading ${validFiles.length} file(s)...`, { id: 'upload' });
      for (const file of validFiles) {
        const response = await ragAPI.getUploadUrl(projectId, {
          filename: file.name,
          file_size: file.size,
          file_type: file.type || 'application/octet-stream'
        });
        const uploadUrl = response.data?.data?.upload_url;
        const s3Key = response.data?.data?.s3_key;

        if (!uploadUrl || !s3Key) throw new Error('Failed to get upload URL');

        await axios.put(uploadUrl, file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream' }
        });
        await ragAPI.confirmUpload(projectId, { s3_key: s3Key });
      }
      toast.success('Upload complete!', { id: 'upload' });
      fetchProjectDetails();
    } catch (err) {
      toast.error('Upload failed', { id: 'upload' });
      console.error(err);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDocumentUpload,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xls'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'text/csv': ['.csv'],
      'text/plain': ['.txt'],

    }
  });

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!urlInput.trim() || isAddingUrl) return;
    setIsAddingUrl(true);
    try {
      await ragAPI.scrapeUrl(projectId, { url: urlInput.trim() });
      setUrlInput('');
      toast.success('URL added successfully');
      fetchProjectDetails();
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

          {/* Left Column: Conversations List */}
          <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm h-full">
            <div className="flex-1 p-8 overflow-y-auto scrollbar-thin">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-10 pb-6 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-4 mb-2">
                      <button onClick={() => navigate('/rag/projects')} className="text-gray-400 hover:text-brand-purple transition-colors">
                        <ArrowLeft size={24} />
                      </button>
                      <h1 className="text-3xl font-bold text-gray-800">{project.name}</h1>
                    </div>
                    {project.description && (
                      <p className="text-gray-500 text-sm font-medium italic ml-10">{project.description}</p>
                    )}
                  </div>
                  <button
                    onClick={handleCreateNewChat}
                    disabled={isCreatingChat}
                    className="bg-brand-purple hover:bg-brand-purple-dark disabled:opacity-50 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 transition-all font-bold text-sm shadow-sm"
                  >
                    {isCreatingChat ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                    New Chat
                  </button>
                </div>

                <section className="space-y-6">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-sm font-bold text-gray-800 uppercase tracking-widest flex items-center gap-2">
                      <MessageSquare size={16} className="text-brand-purple" />
                      Conversations
                    </h2>
                    <span className="text-xs font-bold text-brand-purple bg-brand-purple/10 px-3 py-1 rounded-full">
                      {chats.length}
                    </span>
                  </div>

                  {chats.length === 0 ? (
                    <div className="text-center py-20 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                      <div className="w-16 h-16 bg-white border border-gray-100 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-sm">
                        <MessageSquare size={24} className="text-brand-purple" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-800 mb-3">No conversations yet</h3>
                      <p className="text-gray-500 mb-8 max-w-sm mx-auto leading-relaxed text-sm">
                        Start your first conversation to analyze documents and get AI insights.
                      </p>
                      <button
                        onClick={handleCreateNewChat}
                        disabled={isCreatingChat}
                        className="bg-brand-purple hover:bg-brand-purple-dark text-white px-8 py-3 rounded-lg transition-all font-bold shadow-sm"
                      >
                        Start First Chat
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {chats.map((chat) => (
                        <div
                          key={chat.id || chat._id}
                          onClick={() => navigate(`/rag/chat/${projectId}?chatId=${chat.id || chat._id}`)}
                          className="group bg-white hover:bg-brand-purple/5 border border-gray-100 hover:border-brand-purple/20 rounded-xl p-5 transition-all cursor-pointer shadow-sm hover:shadow-md"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                              <MessageSquare size={18} className="text-brand-purple" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-gray-800 group-hover:text-brand-purple truncate transition-colors">
                                {chat.title}
                              </h3>
                              <p className="text-xs text-gray-400 mt-1">
                                {new Date(chat.created_at || chat.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteChat(chat.id || chat._id);
                              }}
                              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              title="Delete chat"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>

          {/* Right Column: Knowledge Base Sidebar */}
          <div className="w-80 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col h-full overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-white">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <div className="w-8 h-8 bg-brand-purple/10 rounded-lg flex items-center justify-center">
                  <FileText size={16} className="text-brand-purple" />
                </div>
                Knowledge Base
              </h2>
            </div>

            <div className="p-5 space-y-6 overflow-y-auto flex-1 scrollbar-thin">
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

export default RAGProjectDetail;
