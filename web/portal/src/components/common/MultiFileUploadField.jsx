import React, { useState, useEffect } from 'react';
import { Upload, X, CheckCircle, AlertCircle, FileText, Plus, Eye } from 'lucide-react';
import { pspAPI } from '../../services/api';

const MultiFileUploadField = ({ label, onUpload, onDelete, category, existingFiles = [] }) => {
    // pendingFiles: files selected but not yet uploaded to server (base64)
    const [pendingFiles, setPendingFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');

    const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit as requested

    // Auto-clear pending files if they appear in existingFiles (e.g. after a save)
    useEffect(() => {
        if (existingFiles.length > 0 && pendingFiles.length > 0) {
            const existingNames = new Set(existingFiles.map(f => f.name));
            const stillPending = pendingFiles.filter(f => !existingNames.has(f.name));
            if (stillPending.length !== pendingFiles.length) {
                setPendingFiles(stillPending);
            }
        }
    }, [existingFiles]);

    const handleFileChange = async (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length === 0) return;

        setError('');
        setIsUploading(true);

        const newPending = [];
        for (const file of selectedFiles) {
            if (file.size > MAX_SIZE) {
                setError(`File ${file.name} exceeds 5MB limit`);
                continue;
            }

            try {
                const base64 = await convertToBase64(file);
                const fileData = {
                    category,
                    documentType: label.replace(/\s*\*$/, '').replace(' (if applicable)', ''),
                    name: file.name,
                    fileContent: base64,
                    fileType: file.type,
                    fileSize: file.size
                };
                newPending.push(fileData);
            } catch (err) {
                console.error('File conversion error:', err);
                setError('Failed to process some files');
            }
        }

        const updatedPending = [...pendingFiles, ...newPending];
        setPendingFiles(updatedPending);
        onUpload(updatedPending);
        setIsUploading(false);
        // Clear input
        e.target.value = '';
    };

    const convertToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
        });
    };

    const handleView = async (file) => {
        const content = file?.fileContent || file?.url;
        if (!content) return;

        // Ensure we have a filename
        const fileName = file.name || 'document';

        if (content.startsWith('http') || content.startsWith('blob:')) {
            // Use backend proxy to download with correct filename (avoids .sheet extension from Azure)
            if (file?._id) {
                try {
                    const response = await pspAPI.downloadDocument(file._id);
                    const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
                    const blobUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(blobUrl);
                } catch (err) {
                    console.error('Download failed:', err);
                    window.open(content, '_blank');
                }
            } else {
                window.open(content, '_blank');
            }
        } else if (content.startsWith('data:')) {
            // For base64 data, trigger a direct download instead of opening a blank window
            try {
                const a = document.createElement('a');
                a.href = content;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch (err) {
                console.error('Base64 download failed:', err);
                const win = window.open();
                if (win) {
                    win.document.write('<iframe src="' + content + '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>');
                }
            }
        }
    };

    const removePendingFile = (index) => {
        const updated = pendingFiles.filter((_, i) => i !== index);
        setPendingFiles(updated);
        onUpload(updated);
    };

    return (
        <div className="space-y-3">
            <label className="input-label flex justify-between items-center text-gray-700 font-semibold">
                {label}
                {pendingFiles.length > 0 && (
                    <span className="text-xs text-brand-purple flex items-center gap-1 bg-brand-purple/10 px-2 py-0.5 rounded-full">
                        {pendingFiles.length} new added
                    </span>
                )}
            </label>

            <div className="space-y-2">
                {/* Existing Files List */}
                {existingFiles && existingFiles.length > 0 && (
                    <div className="space-y-2">
                        {existingFiles.map((file, idx) => (
                            <div key={`existing-${idx}`} className="flex items-center justify-between p-3 bg-green-50 border border-green-100 rounded-lg group">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="w-8 h-8 bg-white rounded flex items-center justify-center shadow-sm shrink-0">
                                        <FileText className="w-4 h-4 text-green-600" />
                                    </div>
                                    <div className="overflow-hidden">
                                        <p className="text-xs font-medium text-gray-700 truncate" title={file.name}>{file.name}</p>
                                        <p className="text-[10px] text-green-600 flex items-center gap-1">
                                            <CheckCircle className="w-2.5 h-2.5" /> Already Uploaded
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleView(file)}
                                        type="button"
                                        className="p-1.5 hover:bg-green-100 rounded-lg text-green-700 transition-colors"
                                        title="View Document"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => onDelete && onDelete(file._id, label.replace(/\s*\*$/, '').replace(' (if applicable)', ''))}
                                        type="button"
                                        className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                        title="Delete Document"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pending Files List */}
                {pendingFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100 hover:border-green-200 transition-all group">
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-8 h-8 rounded bg-white flex items-center justify-center border border-green-100 shrink-0 text-green-500">
                                <FileText className="w-4 h-4" />
                            </div>
                            <div className="overflow-hidden">
                                <p className="text-xs font-medium text-gray-700 truncate" title={file.name}>{file.name}</p>
                                <div className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                                    <Upload className="w-3 h-3" />
                                    Ready to upload
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => handleView(file)}
                                className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors shrink-0"
                                title="View Document"
                            >
                                <Eye className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => removePendingFile(index)}
                                className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                                title="Remove"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}

                {/* Upload Action */}
                <label className={`cursor-pointer flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg transition-all ${
                    isUploading ? 'bg-gray-50 border-gray-200' : 'hover:bg-brand-purple/5 border-gray-200 hover:border-brand-purple/40'
                }`}>
                    <div className="flex items-center gap-2">
                        {isUploading ? (
                            <div className="w-5 h-5 border-2 border-brand-purple border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Upload className="w-5 h-5 text-gray-400" />
                        )}
                        <span className="text-sm text-gray-600 font-medium">
                            {isUploading ? 'Processing...' : 'Add document'}
                        </span>
                    </div>
                    {!isUploading && (
                        <p className="text-[10px] text-gray-400 mt-1">
                            PDF, JPG, PNG, Excel or Word (Max. 5MB per file)
                        </p>
                    )}
                    <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
                        onChange={handleFileChange}
                        disabled={isUploading}
                        multiple
                    />
                </label>
            </div>

            {error && (
                <p className="text-xs text-red-500 flex items-center gap-1 animate-fade-in">
                    <AlertCircle className="w-3 h-3" /> {error}
                </p>
            )}
        </div>
    );
};

export default MultiFileUploadField;
