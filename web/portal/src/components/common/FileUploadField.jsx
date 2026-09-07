import React, { useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { pspAPI } from '../../services/api';

const FileUploadField = ({ label, onUpload, category, existingFile }) => {
    // existingFile can be a string (name) or an object { name, fileContent, ... }
    const [fileObj, setFileObj] = useState(existingFile || null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');

    // Sync state when prop changes from parent
    React.useEffect(() => {
        setFileObj(existingFile || null);
    }, [existingFile]);

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    const handleFileChange = async (e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        if (selectedFile.size > MAX_SIZE) {
            setError('File size exceeds 5MB limit');
            return;
        }

        setError('');
        setIsUploading(true);

        try {
            const base64 = await convertToBase64(selectedFile);
            const fileData = {
                category,
                documentType: label.replace(/\s*\*$/, '').replace(' (if applicable)', ''), // Clean label for storage
                name: selectedFile.name,
                fileContent: base64,
                fileType: selectedFile.type,
                fileSize: selectedFile.size
            };

            setFileObj({ name: selectedFile.name, fileContent: base64 });
            onUpload(fileData);
        } catch (err) {
            console.error('File conversion error:', err);
            setError('Failed to process file');
        } finally {
            setIsUploading(false);
        }
    };

    const convertToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
        });
    };

    const handleView = async () => {
        const content = fileObj?.fileContent;
        if (!content) return;

        if (content.startsWith('http') || content.startsWith('blob:')) {
            if (fileObj?._id) {
                try {
                    const response = await pspAPI.downloadDocument(fileObj._id);
                    const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
                    const blobUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = fileObj.name || 'download';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(blobUrl);
                } catch {
                    window.open(content, '_blank');
                }
            } else {
                window.open(content, '_blank');
            }
        } else if (content.startsWith('data:')) {
            const win = window.open();
            win.document.write('<iframe src="' + content + '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>');
        }
    };

    const clearFile = () => {
        setFileObj(null);
        onUpload(null);
    };

    const fileName = typeof fileObj === 'string' ? fileObj : fileObj?.name;

    return (
        <div className="space-y-2">
            <label className="input-label flex justify-between items-center">
                {label}
                {fileObj && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Ready</span>}
            </label>

            <div className={`relative border-2 border-dashed rounded-lg p-4 transition-all ${fileObj ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-brand-purple/50 bg-gray-50'
                }`}>
                {fileObj ? (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white rounded flex items-center justify-center shadow-sm">
                                <FileText className="w-5 h-5 text-brand-purple" />
                            </div>
                            <div className="overflow-hidden">
                                <p className="text-sm font-medium text-gray-700 truncate max-w-[150px]">{fileName}</p>
                                <p className="text-xs text-gray-500">Document attached</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleView}
                                className="px-2 py-1 text-xs font-semibold text-brand-purple hover:bg-brand-purple/10 rounded transition-colors"
                            >
                                View
                            </button>
                            <button
                                onClick={clearFile}
                                className="p-1 hover:bg-gray-200 rounded-full text-gray-400 hover:text-red-500 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <label className="cursor-pointer flex flex-col items-center justify-center py-2">
                        <Upload className={`w-8 h-8 mb-2 ${isUploading ? 'text-brand-purple animate-bounce' : 'text-gray-400'}`} />
                        <p className="text-sm text-gray-600 font-medium">Click to upload or drag & drop</p>
                        <p className="text-xs text-gray-400 mt-1">PDF, JPG or PNG, Excel, Word (Max. 10MB)</p>
                        <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
                            onChange={handleFileChange}
                            disabled={isUploading}
                        />
                    </label>
                )}
            </div>
            {error && (
                <p className="text-xs text-red-500 flex items-center gap-1 animate-fade-in">
                    <AlertCircle className="w-3 h-3" /> {error}
                </p>
            )}
        </div>
    );
};

export default FileUploadField;
