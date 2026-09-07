import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { ragAPI } from '../../services/api';
import axios from 'axios';
import { X, Upload, File, Loader2, Globe, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

const DocumentUpload = ({ projectId, onClose, onSuccess, onUrlAdd }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback((acceptedFiles) => {
    // Filter and add files based on extension for 100% reliable validation
    const allowedExtensions = ['.pdf', '.txt', '.csv', '.docx', '.xlsx', '.xls'];
    const newFiles = acceptedFiles.filter(file => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        toast.error(`${file.name} is not supported. Please upload PDF, DOCX, XLSX, XLS, TXT, or CSV.`, { id: 'rejection' });
        return false;
      }
      return true;
    });

    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop
  });

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const [urlInput, setUrlInput] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error('Please select files to upload');
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        // 1. Get pre-signed URL
        const response = await ragAPI.getUploadUrl(projectId, {
          filename: file.name,
          file_size: file.size,
          file_type: file.type || 'application/octet-stream'
        });

        const uploadUrl = response.data?.data?.upload_url;
        const s3Key = response.data?.data?.s3_key;

        if (!uploadUrl || !s3Key) {
          throw new Error('Failed to get upload URL or S3 key');
        }

        // 2. Upload file to pre-signed URL
        await axios.put(uploadUrl, file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream'
          }
        });

        // 3. Confirm upload
        await ragAPI.confirmUpload(projectId, { s3_key: s3Key });
      }
      toast.success(`${files.length} file${files.length !== 1 ? 's' : ''} uploaded successfully`);
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!urlInput.trim() || isAddingUrl) return;
    setIsAddingUrl(true);
    try {
      if (onUrlAdd) {
        await onUrlAdd(urlInput.trim());
        setUrlInput('');
        toast.success('URL added successfully');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add URL');
    } finally {
      setIsAddingUrl(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Upload Documents</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${isDragActive
                ? 'border-brand-purple bg-blue-50'
                : 'border-gray-300 hover:border-brand-purple'
              }`}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            {isDragActive ? (
              <div>
                <p className="font-medium text-brand-purple">Drop files here...</p>
              </div>
            ) : (
              <div>
                <p className="font-medium text-gray-900">Drag files here or click to select</p>
                <p className="text-sm text-gray-600 mt-1">Supported: PDF, TXT, CSV, DOCX, XLSX, XLS</p>
              </div>
            )}
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <File className="w-4 h-4 text-brand-purple" />
                      <span className="text-sm text-gray-900 truncate">{file.name}</span>
                      <span className="text-xs text-gray-500">({(file.size / 1024).toFixed(2)} KB)</span>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* URL Input Section */}
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-300"></span>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest italic">or insert link</span>
            </div>
          </div>

          <form onSubmit={handleUrlSubmit} className="space-y-3">
            <div className="relative group">
              <Globe
                size={16}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 group-focus-within:text-brand-purple transition-colors"
              />
              <input
                type="text"
                placeholder="Website URL"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={isAddingUrl}
                className="w-full pl-12 pr-4 py-3 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-purple shadow-sm text-sm text-gray-900 font-medium placeholder:text-gray-400/60 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!urlInput.trim() || isAddingUrl}
              className="w-full px-4 py-3 bg-brand-purple hover:bg-brand-purple-dark disabled:bg-gray-300 text-white disabled:text-gray-600 rounded-xl transition-all text-sm font-medium flex items-center justify-center gap-2 shadow-sm"
            >
              {isAddingUrl ? (
                <>
                  <Loader2 size={16} className="animate-spin text-white" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus size={18} />
                  Add Link
                </>
              )}
            </button>
          </form>

          {/* Help Text */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-900">
              <strong>Tip:</strong> Supported formats are PDF, TXT, CSV, DOCX, XLSX, and XLS. Files will be processed for faster search and retrieval.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="flex-1 px-4 py-2 bg-brand-purple hover:bg-brand-purple-dark text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading && <Loader2 size={16} className="animate-spin" />}
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentUpload;
