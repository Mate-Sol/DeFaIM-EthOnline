import { useState, useEffect } from 'react';
import { ragAPI } from '../../services/api';
import { Loader2, Plus, Trash2, Search, Grid3X3, List, Folder } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import CreateProjectModal from '../../components/rag/CreateProjectModal';
import Sidebar from '../../components/Sidebar';
import { useAuth } from '../../context/AuthContext';

const RAGProjects = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // UI States
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");

  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const userId = user?._id || user?.id;
    if (userId) {
      ragAPI.createUser(userId).catch(err => console.error('Failed to register user in RAG system:', err));
    }
    fetchProjects();
  }, [user]);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await ragAPI.getProjects();
      setProjects(response.data?.data || []);
    } catch (error) {
      toast.error('Failed to fetch projects');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!window.confirm('Are you sure you want to delete this workspace?')) return;
    try {
      await ragAPI.deleteProject(projectId);
      setProjects(projects.filter(p => p.id !== projectId));
      toast.success('Workspace deleted successfully');
    } catch (error) {
      toast.error('Failed to delete workspace');
    }
  };

  const filteredProjects = projects.filter(
    (project) =>
      project.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex overflow-hidden">
        <Sidebar />
        <main className="ml-64 flex-1 flex flex-col h-screen p-4">
          <div className="max-w-7xl mx-auto h-[85vh] p-4 w-full flex-1">
            <div className="card h-full flex flex-col relative overflow-hidden bg-white border border-gray-200 rounded-xl items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-brand-purple mb-3" />
              <p className="text-gray-600 font-medium">Loading workspaces...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-hidden">
      <Sidebar />
      <main className="ml-64 flex-1 flex flex-col h-screen overflow-y-auto bg-white">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-8">
            {/* Top Row */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
                  Workspaces
                </h1>
                <p className="text-gray-500 text-sm mt-1 font-medium">
                  {projects.length} workspace{projects.length !== 1 ? "s" : ""}
                </p>
              </div>

              <button
                onClick={() => setShowCreateModal(true)}
                disabled={loading}
                className="bg-brand-purple hover:bg-brand-purple-dark disabled:bg-gray-300 text-white px-6 py-2.5 rounded-lg flex items-center gap-2 transition-all duration-200 font-bold text-sm shadow-sm"
              >
                <Plus size={20} />
                New Workspace
              </button>
            </div>

            {/* Controls Row */}
            <div className="flex items-center justify-between gap-4">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search
                  size={18}
                  className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500"
                />
                <input
                  type="text"
                  placeholder="Search workspaces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={loading}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-purple placeholder-gray-500 text-gray-900 text-sm disabled:opacity-50 transition-all duration-200 shadow-sm"
                />
              </div>

              {/* View Controls */}
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-gray-100 border border-gray-200 rounded-lg p-1">
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`p-2 rounded-md transition-all duration-200 ${
                      viewMode === "grid"
                        ? "bg-white shadow-sm text-brand-purple"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    <Grid3X3 size={18} />
                  </button>
                  <button
                    onClick={() => setViewMode("list")}
                    className={`p-2 rounded-md transition-all duration-200 ${
                      viewMode === "list"
                        ? "bg-white shadow-sm text-brand-purple"
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    <List size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-7xl mx-auto px-6 py-10 w-full flex-1">
          {filteredProjects.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm">
              {searchQuery ? (
                <div className="max-w-md mx-auto">
                  <div className="w-16 h-16 bg-gray-100 rounded-full mx-auto mb-6 flex items-center justify-center">
                    <Search size={24} className="text-gray-500" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3">No workspaces found</h3>
                  <p className="text-gray-500 mb-6">Try adjusting your search terms</p>
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-brand-purple hover:underline font-bold text-sm"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="max-w-md mx-auto">
                  <div className="w-20 h-20 bg-gray-50 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-sm">
                    <Plus size={32} className="text-brand-purple" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-3">Create your first workspace</h3>
                  <p className="text-gray-500 mb-8 leading-relaxed">
                    Organize your documents and start intelligent conversations.
                  </p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-brand-purple hover:bg-brand-purple-dark text-white px-8 py-3 rounded-lg transition-all font-bold shadow-sm"
                  >
                    Get Started
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Folder size={20} className="text-brand-purple" />
                Recent Workspaces
              </h2>

              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {filteredProjects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => navigate(`/rag/projects/${project.id}`)}
                      className="group bg-white hover:bg-gray-50/50 border border-gray-200 hover:border-brand-purple/20 rounded-2xl p-6 cursor-pointer transition-all duration-300 shadow-sm hover:shadow-xl relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-32 h-32 bg-brand-purple/5 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
                      
                      <div className="w-12 h-12 bg-gray-50 rounded-xl mb-5 flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                        <Folder size={24} className="text-brand-purple" />
                      </div>

                      <div className="space-y-2 relative">
                        <h3 className="font-bold text-gray-900 text-lg line-clamp-1 group-hover:text-brand-purple transition-colors">
                          {project.name}
                        </h3>
                        {project.description && (
                          <p className="text-gray-500 text-sm line-clamp-2 leading-relaxed">
                            {project.description}
                          </p>
                        )}
                        <div className="pt-4 flex items-center justify-between border-t border-gray-200 mt-4">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            {new Date(project.created_at || project.createdAt || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id);
                        }}
                        className="absolute top-4 right-4 p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-200 shadow-sm">
                  {filteredProjects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => navigate(`/rag/projects/${project.id}`)}
                      className="group flex items-center gap-6 p-5 hover:bg-gray-50/50 cursor-pointer transition-all"
                    >
                      <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <Folder size={20} className="text-brand-purple" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-gray-900 truncate group-hover:text-brand-purple transition-colors">
                          {project.name}
                        </h3>
                        {project.description && (
                          <p className="text-gray-500 text-xs truncate mt-1">
                            {project.description}
                          </p>
                        )}
                      </div>

                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex-shrink-0">
                        {new Date(project.created_at || project.createdAt || Date.now()).toLocaleDateString()}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id);
                        }}
                        className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Create Project Modal */}
        {showCreateModal && (
          <CreateProjectModal
            onClose={() => setShowCreateModal(false)}
            onSuccess={() => {
              setShowCreateModal(false);
              fetchProjects();
            }}
          />
        )}
      </main>
    </div>
  );
};

export default RAGProjects;
