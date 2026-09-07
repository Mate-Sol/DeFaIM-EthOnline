import { useState, useRef } from 'react';
import { X, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { pspAPI } from '../services/api';

const UploadReceiptModal = ({ isOpen, onClose, order, onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      // Validate file type
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      if (!allowedTypes.includes(selectedFile.type)) {
        setError('Invalid file type. Please upload a PDF or Image (JPEG/PNG).');
        return;
      }

      // Validate file size (5MB)
      if (selectedFile.size > 5 * 1024 * 1024) {
        setError('File size too large. Max limit is 5MB.');
        return;
      }

      setFile(selectedFile);
      setError(null);
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

  const handleUpload = async () => {
    if (!file || !order) return;

    setUploading(true);
    setError(null);

    try {
      const base64Content = await convertToBase64(file);
      
      // 1. Upload to Blob storage
      const uploadRes = await pspAPI.uploadDocument({
        category: 'Operational Settlement Data',
        documentType: 'Receipt',
        name: `Receipt_${order.referenceId}`,
        fileContent: base64Content,
        fileType: file.type,
        fileSize: file.size,
      });

      if (!uploadRes.data.success) {
        throw new Error('Failed to upload document to storage.');
      }

      const fileURL = uploadRes.data.document.fileContent;

      // 2. Associate with Financing Request
      await pspAPI.updateFinancingReceipt({
        orderReference: order.referenceId,
        receiptUrl: fileURL,
      });

      setSuccess(true);
      setTimeout(() => {
        onUploadSuccess();
        handleClose();
      }, 2000);
    } catch (err) {
      console.error('Upload failed:', err);
      setError(err.response?.data?.message || 'Something went wrong during upload.');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setError(null);
    setSuccess(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform animate-in zoom-in-95 duration-200">
        <div className="relative p-6">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-full hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">Upload Receipt</h2>
            <p className="text-gray-500 text-sm mt-1">
              Select a receipt image or PDF for order <span className="font-mono text-brand-purple">#{order?.referenceId}</span>
            </p>
          </div>

          {!success ? (
            <div className="space-y-6">
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
                  file ? 'border-brand-purple bg-brand-purple/5' : 'border-gray-200 hover:border-brand-purple/50 bg-gray-50'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                />
                <div className="flex flex-col items-center">
                  <div className={`p-3 rounded-full mb-3 ${file ? 'bg-brand-purple text-white' : 'bg-white text-gray-400 shadow-sm'}`}>
                    <Upload className="w-6 h-6" />
                  </div>
                  {file ? (
                    <div>
                      <p className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">{file.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-gray-900">Click to select file</p>
                      <p className="text-xs text-gray-500 mt-1">PDF, JPG or PNG up to 5MB</p>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 border border-red-100 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                disabled={!file || uploading}
                onClick={handleUpload}
                className="w-full py-3 px-4 bg-brand-purple text-white rounded-xl font-semibold shadow-lg shadow-brand-purple/20 hover:bg-brand-purple/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Upload Receipt'
                )}
              </button>
            </div>
          ) : (
            <div className="py-8 text-center animate-in zoom-in-95 duration-500">
              <div className="inline-flex p-4 rounded-full bg-green-100 text-green-600 mb-4 scale-110">
                <CheckCircle className="w-12 h-12" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Upload Successful!</h3>
              <p className="text-gray-500 mt-2">The receipt has been associated with this order.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadReceiptModal;
