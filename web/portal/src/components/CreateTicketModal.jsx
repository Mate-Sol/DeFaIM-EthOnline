import { useState } from 'react';
import { X, MessageSquare, AlertCircle, Loader2 } from 'lucide-react';
import { supportAPI } from '../services/api';
import { toast } from 'react-hot-toast';

const CreateTicketModal = ({ isOpen, onClose, onSuccess }) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!subject.trim() || !message.trim()) {
      setError('Both subject and message are required');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await supportAPI.createTicket({ subject, message });
      toast.success('Ticket created successfully');
      onSuccess(response.data);
      handleClose();
    } catch (err) {
      setError(err.message || 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSubject('');
    setMessage('');
    setError('');
    onClose();
  };

  return (
    <div className="modal-overlay z-50 fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center" onClick={handleClose}>
      <div className="modal-content bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-purple/10 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-brand-purple" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Create New Ticket</h2>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="input-label mb-1 block text-sm font-medium text-gray-700">Subject *</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input-field w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-purple outline-none"
              placeholder="What's this about?"
              required
            />
          </div>

          <div>
            <label className="input-label mb-1 block text-sm font-medium text-gray-700">Message *</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input-field w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-purple outline-none h-32 resize-none"
              placeholder="Explain your issue in detail..."
              required
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={handleClose} className="flex-1 px-4 py-2 border border-brand-purple text-brand-purple font-semibold rounded-lg hover:bg-brand-purple hover:text-white transition-all duration-300">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !subject.trim() || !message.trim()}
              className="btn-primary flex-1 bg-brand-purple text-white px-4 py-2 rounded-lg hover:bg-brand-purple-dark transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Ticket'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTicketModal;
