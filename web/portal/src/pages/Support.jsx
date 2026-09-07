import { useState, useEffect, useRef } from 'react';
import { 
  Users, MessageSquare, Plus, Send, Clock, 
  CheckCircle, XCircle, Search, Copy, ExternalLink,
  User as UserIcon, Shield, ChevronRight
} from 'lucide-react';
import { supportAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import CreateTicketModal from '../components/CreateTicketModal';
import { toast } from 'react-hot-toast';

const Support = () => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const pollingInterval = useRef(null);

  const isAdmin = ['KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN'].includes(user?.role);

  // Initial fetch
  useEffect(() => {
    fetchTickets();
    return () => clearInterval(pollingInterval.current);
  }, []);

  // Poll for messages when a ticket is selected
  useEffect(() => {
    if (selectedTicket) {
      fetchTicketDetail(selectedTicket._id);
      
      // Clear existing interval
      if (pollingInterval.current) clearInterval(pollingInterval.current);
      
      // Start polling
      pollingInterval.current = setInterval(() => {
        fetchTicketDetail(selectedTicket._id, true);
      }, 5000);
    } else {
      if (pollingInterval.current) clearInterval(pollingInterval.current);
    }
    
    return () => {
      if (pollingInterval.current) clearInterval(pollingInterval.current);
    };
  }, [selectedTicket?._id]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchTickets = async () => {
    try {
      const response = await supportAPI.getTickets();
      setTickets(response.data);
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
      toast.error('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  const fetchTicketDetail = async (id, isPolling = false) => {
    try {
      const response = await supportAPI.getTicket(id);
      setMessages(response.data.messages || []);
      // Update selected ticket data too (like status)
      if (!isPolling) {
        setSelectedTicket(response.data);
      } else {
        // Just update status if it changed
        if (selectedTicket.status !== response.data.status) {
          setSelectedTicket(prev => ({ ...prev, status: response.data.status }));
        }
      }
    } catch (error) {
      console.error('Failed to fetch ticket detail:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedTicket || selectedTicket.status === 'closed') return;

    const messageContent = newMessage.trim();
    setNewMessage('');

    // Optimistic UI
    const tempMessage = {
      _id: Date.now().toString(),
      senderId: user.id,
      senderType: isAdmin ? 'admin' : 'user',
      message: messageContent,
      timestamp: new Date().toISOString()
    };
    setMessages([...messages, tempMessage]);

    try {
      await supportAPI.addMessage(selectedTicket._id, { message: messageContent });
      fetchTicketDetail(selectedTicket._id, true);
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Failed to send message');
      // Revert optimistic update? For now just re-fetch
      fetchTicketDetail(selectedTicket._id);
    }
  };

  const handleCloseTicket = async () => {
    if (!selectedTicket || !window.confirm('Are you sure you want to close this ticket?')) return;
    
    try {
      await supportAPI.closeTicket(selectedTicket._id);
      toast.success('Ticket closed successfully');
      fetchTickets();
      fetchTicketDetail(selectedTicket._id);
    } catch (error) {
      console.error('Failed to close ticket:', error);
      toast.error('Failed to close ticket');
    }
  };

  const copyTicketUrl = () => {
    const url = `${window.location.origin}/customer-support?id=${selectedTicket._id}`;
    navigator.clipboard.writeText(url);
    toast.success('Ticket URL copied to clipboard');
  };

  const filteredTickets = tickets.filter(t => 
    t.ticketId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.creatorId?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + ' ' + 
           date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <main className="ml-64 flex-1 flex h-screen overflow-hidden">
        
        {/* Left: Ticket List */}
        <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-brand-purple" />
              Support Tickets
            </h2>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field pl-10"
              />
            </div>
            {!isAdmin && (
              <button 
                onClick={() => setIsModalOpen(true)}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Create New Ticket
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center"><div className="w-6 h-6 border-2 border-brand-purple border-t-transparent rounded-full animate-spin mx-auto"></div></div>
            ) : filteredTickets.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No tickets found</div>
            ) : (
              filteredTickets.map(ticket => (
                <button
                  key={ticket._id}
                  onClick={() => setSelectedTicket(ticket)}
                  className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedTicket?._id === ticket._id ? 'bg-purple-50 border-l-4 border-l-brand-purple' : ''}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-mono text-gray-500">{ticket.ticketId}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${ticket.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {ticket.status}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 truncate mb-1">{ticket.subject}</h3>
                  <div className="flex justify-between items-center text-[10px] text-gray-400">
                    <span className="truncate">{isAdmin ? ticket.creatorId?.name : 'Me'}</span>
                    <span>{new Date(ticket.updatedAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Chat Panel */}
        <div className="flex-1 flex flex-col bg-gray-50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-opacity-5">
          {selectedTicket ? (
            <>
              {/* Chat Header */}
              <div className="bg-white p-4 border-b border-gray-200 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedTicket.status === 'open' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}>
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900">{selectedTicket.subject}</h3>
                      <span className="text-xs font-mono text-gray-400">{selectedTicket.ticketId}</span>
                    </div>
                    {isAdmin && (
                      <p className="text-xs text-gray-500">
                        User: <span className="font-medium text-gray-700">{selectedTicket.creatorId?.name}</span> ({selectedTicket.creatorId?.companyName})
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={copyTicketUrl}
                    className="p-2 text-gray-500 hover:text-brand-purple hover:bg-gray-100 rounded-lg transition-all"
                    title="Copy Ticket URL"
                  >
                    <Copy className="w-5 h-5" />
                  </button>
                  {selectedTicket.status === 'open' && (
                    <button 
                      onClick={handleCloseTicket}
                      className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 flex items-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Close Ticket
                    </button>
                  )}
                </div>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="flex justify-center mb-6">
                  <div className="bg-gray-200 text-gray-600 text-[10px] px-3 py-1 rounded-full uppercase font-bold tracking-wider">
                    Ticket Created: {formatDate(selectedTicket.createdAt)}
                  </div>
                </div>

                {messages.map((msg, index) => {
                  const isMe = msg.senderId === user.id || (msg.senderId?._id === user.id);
                  return (
                    <div key={msg._id || index} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] group`}>
                        <div className={`flex items-center gap-2 mb-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                          <span className="text-[10px] font-bold text-gray-400">
                            {msg.senderType === 'admin' ? 'Support Agent' : (isAdmin ? selectedTicket.creatorId?.name : 'You')}
                          </span>
                          <span className="text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={`px-4 py-2 rounded-2xl shadow-sm text-sm ${
                          isMe 
                            ? 'bg-brand-purple text-white rounded-tr-none' 
                            : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
                        }`}>
                          {msg.message}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="bg-white p-4 border-t border-gray-200">
                {selectedTicket.status === 'open' ? (
                  <form onSubmit={handleSendMessage} className="flex gap-3">
                    <input
                      type="text"
                      placeholder="Type your message here..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      className="input-field flex-1"
                    />
                    <button 
                      type="submit" 
                      disabled={!newMessage.trim()}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      Send
                    </button>
                  </form>
                ) : (
                  <div className="bg-gray-100 p-3 rounded-lg text-center text-gray-500 text-sm flex items-center justify-center gap-2">
                    <XCircle className="w-4 h-4" />
                    This ticket is closed. You cannot send further messages.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <MessageSquare className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-gray-600 mb-2">Select a ticket to view conversation</h3>
              <p className="max-w-xs text-center">Your support history and active conversations will appear here.</p>
            </div>
          )}
        </div>

        {/* Modal */}
        <CreateTicketModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)}
          onSuccess={(ticket) => {
            fetchTickets();
            setSelectedTicket(ticket);
            setIsModalOpen(false);
          }}
        />
      </main>
    </div>
  );
};

export default Support;
