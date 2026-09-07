import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import moment from 'moment';
import toast from 'react-hot-toast';
import { Clock, FileText, CheckCircle, MessageSquare, X, ClipboardList } from 'lucide-react';
import { pspAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import Sidebar from '../../components/Sidebar';

const AgreementOnboarding = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNegotiation, setShowNegotiation] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await pspAPI.getProfile();
        setProfile(response.data);
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  if (loading || !profile?.creditLineStatus) {
    return (
      <div className="min-h-screen">
        <Sidebar />
        <div className="main-content">
          <div className="card">Loading...</div>
        </div>
      </div>
    );
  }

  const workflowSteps = [
    { step: 'KAM_REVIEW', label: 'Relationship Review', icon: <Clock className="w-5 h-5" /> },
    { step: 'TERM_SHEET_STAGE', label: 'Term Sheet', icon: <FileText className="w-5 h-5" /> },
    { step: 'TECH_INTEGRATION_STAGE', label: 'Tech Integration', icon: <CheckCircle className="w-5 h-5" /> },
    { step: 'CRO_REVIEW', label: 'CRO Review', icon: <CheckCircle className="w-5 h-5" /> },
    { step: 'LEGAL_REVIEW', label: 'Legal Review', icon: <CheckCircle className="w-5 h-5" /> },
    { step: 'CAD_FACILITY_REVIEW', label: 'Risk Review', icon: <CheckCircle className="w-5 h-5" /> },
    { step: 'PSP_FACILITY_APPROVAL', label: 'Agreement Signing', icon: <CheckCircle className="w-5 h-5" /> },
    { step: 'CAD_FINAL_APPROVAL', label: 'CAD Final', icon: <CheckCircle className="w-5 h-5" /> },
    { step: 'CRO_FINAL_CONFIRMATION', label: 'CRO Final', icon: <CheckCircle className="w-5 h-5" /> },
    { step: 'FINALIZED', label: 'Finalized', icon: <CheckCircle className="w-5 h-5" /> }
  ];

  const currentStepIdx = workflowSteps.findIndex(s => s.step === profile?.workflowStep);

  return (
    <div className="min-h-screen ">
      <Sidebar />

      {/* Floating Toggle Button (Visible when sidebar is closed) */}
      {!showNegotiation && (
        <button
          onClick={() => setShowNegotiation(true)}
          className="fixed right-6 bottom-6 w-14 h-14 bg-brand-purple text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-all z-50 group"
        >
          <MessageSquare className="w-6 h-6" />
          <span className="absolute right-full mr-4 px-3 py-1 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Open Negotiation
          </span>
        </button>
      )}

      {/* Negotiation & Notes Panel (Sidebar) */}
      <div className={`fixed right-0 top-0 w-80 h-full bg-white shadow-2xl border-l border-gray-100 z-50 transition-transform duration-300 ease-in-out ${showNegotiation ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-brand-purple" />
              <h3 className="font-bold text-gray-900">Relationship Manager</h3>
            </div>
            <button
              onClick={() => setShowNegotiation(false)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {!profile?.agreementNotes || profile.agreementNotes.filter(n => !n.isHiddenFromPSP).length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No message yet.<br />Start a conversation with your PayMate<br />Relationship Manager</p>
              </div>
            ) : (
              profile.agreementNotes.filter(n => !n.isHiddenFromPSP).map((note, idx) => (
                <div key={idx} className={`p-3 rounded-xl border ${note.role === 'PSP' ? 'bg-brand-purple/5 border-brand-purple/10 ml-4' : 'bg-gray-50 border-gray-100 mr-4'}`}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-bold text-gray-900">{note.role === 'PSP' ? 'You' : note.role}</span>
                    <span className="text-[9px] text-gray-400">{moment(note.timestamp).fromNow()}</span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{note.text}</p>
                </div>
              ))
            )}
          </div>

          <div className="p-6 border-t border-gray-100 bg-gray-50/50">
            <textarea
              id="negotiation-note-psp-cl"
              placeholder="Message your Relationship Manager"
              className="w-full p-3 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple transition-all min-h-[80px]"
            />
            <button
              onClick={async () => {
                const text = document.getElementById('negotiation-note-psp-cl').value;
                if (!text) return;
                let agrementArr = [{ key: 'termSheet', label: 'Term sheet', data: profile?.termSheet },
                { key: 'techAgreement', label: 'Technical integration agreement', data: profile?.techAgreement },
                { key: 'facilityAgreement', label: 'Facility agreement', data: profile?.facilityAgreement }]
                try {
                  await pspAPI.clAction({
                    action: 'NEGOTIATE',
                    additionalDetails: text,
                    type: agrementArr.find(agremet => agremet?.data?.status === "Shared")?.key
                  });
                  toast.success('Note sent');
                  document.getElementById('negotiation-note-psp-cl').value = '';
                  // Re-fetch profile to show the new note
                  const response = await pspAPI.getProfile();
                  setProfile(response.data);
                } catch (err) {
                  toast.error('Failed to add note');
                }
              }}
              className="w-full mt-3 py-2 bg-brand-purple text-white text-xs font-bold rounded-lg hover:bg-brand-purple/90 transition-all"
            >
              Send
            </button>
          </div>
        </div>
      </div>
      <main className={`ml-64 transition-all duration-300 p-8 ${showNegotiation ? 'mr-80' : 'mr-0'}`}>
        <div className="max-w-4xl mx-auto">
          <div className="card text-center py-8 mb-8 border-t-4 border-t-brand-purple">
            <div className="w-16 h-16 bg-brand-purple/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-brand-purple" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Pre-Funding Application Progress</h1>
            <p className="text-gray-600 mb-6">Track your pre-funding application as it moves through our approval pipeline.</p>

            <div className="w-full overflow-x-auto py-6 px-4 scrollbar-thin scrollbar-thumb-gray-200">
              <div className="flex items-center justify-start gap-0 min-w-max mx-auto">
                {workflowSteps.map((s, idx) => (
                  <div key={s.step} className="flex items-center">
                    <div className="flex flex-col items-center gap-2 px-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${idx < currentStepIdx ? 'bg-green-500 text-white' :
                        idx === currentStepIdx ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/20 scale-110' :
                          'bg-gray-100 text-gray-400'
                        }`}>
                        {idx < currentStepIdx ? <CheckCircle className="w-5 h-5" /> : s.icon}
                      </div>
                      <span className={`text-[9px] font-bold uppercase tracking-tighter text-center leading-tight max-w-[80px] ${idx === currentStepIdx ? 'text-brand-purple' : 'text-gray-400'
                        }`}>
                        {s.label}
                      </span>
                    </div>
                    {idx < workflowSteps.length - 1 && (
                      <div className={`w-12 h-0.5 mb-6 ${idx < currentStepIdx ? 'bg-green-500' : 'bg-gray-200'}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="inline-flex items-center gap-2 px-4 py-2 mt-5 bg-amber-50 text-amber-700 rounded-full text-sm font-bold border border-amber-100">
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              Current Status: {workflowSteps.find(s => s.step === profile?.workflowStep)?.label.toUpperCase() || 'UNDER REVIEW'}
            </div>
          </div>

          {/* Agreement Actions */}
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-brand-purple" />
              Onboarding Documents
            </h2>

            {[
              { key: 'termSheet', label: 'Pre-Funding Term Sheet', data: profile?.termSheet },
              { key: 'techAgreement', label: 'Technical Integration Agreement', data: profile?.techAgreement },
              { key: 'facilityAgreement', label: 'Facility agreement', data: profile?.facilityAgreement }
            ].filter(a => a.data?.status).map((agreement) => (
              <div key={agreement.key} className="card border-l-4 border-l-blue-500 bg-blue-50/30">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-gray-900">{agreement.label}</h3>
                    <p className="text-xs text-gray-500 mt-1">Status: <span className="font-bold text-blue-600">{agreement.data.status}</span> • Shared on {moment(agreement.data.sharedAt).format('lll')}</p>
                  </div>
                  <span className="badge badge-info uppercase text-[10px] tracking-widest">{agreement.data.status}</span>
                </div>

                <div className="flex flex-wrap gap-3">
                  {['Shared', 'Accepted'].includes(agreement.data.status) ? (
                    <a
                      href={agreement.data.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-white border border-blue-200 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-600 hover:text-white transition-all flex items-center gap-2 shadow-sm"
                    >
                      <FileText className="w-4 h-4" />
                      View Document
                    </a>
                  ) : (
                    <span className="px-4 py-2 bg-gray-100 border border-gray-200 text-gray-500 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm">
                      <FileText className="w-4 h-4" />
                      Awaiting Document
                    </span>
                  )}

                  {agreement.data.status !== 'Accepted' && (
                    <>
                      <button
                        onClick={async () => {
                          const result = await Swal.fire({
                            title: 'Accept Agreement',
                            text: `Are you sure you want to accept the ${agreement.label}?`,
                            icon: 'question',
                            showCancelButton: true,
                            confirmButtonColor: '#10b981',
                            cancelButtonColor: '#6b7280',
                            confirmButtonText: 'Yes, Accept it',
                            cancelButtonText: 'Review again'
                          });

                          if (result.isConfirmed) {
                            try {
                              await pspAPI.clAction({ action: 'ACCEPT', type: agreement.key });
                              toast.success(`${agreement.label} Accepted!`);
                              window.location.reload();
                            } catch (err) { toast.error('Action failed'); }
                          }
                        }}
                        disabled={agreement.data.status !== 'Shared'}
                        className={`px-4 py-2  text-white rounded-lg text-sm font-bold transition-all shadow-sm shadow-green-100 flex items-center gap-2 ${agreement.data.status === 'Shared'
                          ? 'bg-green-600 hover:bg-green-700 cursor-pointer'
                          : 'bg-gray-300 cursor-not-allowed'
                          }`}
                      >
                        <CheckCircle className="w-4 h-4" />
                        Accept & Proceed
                      </button>

                      <button
                        onClick={() => {
                          setShowNegotiation(true);
                          setTimeout(() => {
                            document.getElementById('negotiation-note-psp-cl')?.focus();
                            document.getElementById('negotiation-note-psp-cl')?.scrollIntoView({ behavior: 'smooth' });
                          }, 300);
                        }}
                        disabled={agreement.data.status !== 'Shared'}
                        className={`px-4 py-2 bg-white border   rounded-lg text-sm font-bold   transition-all shadow-sm ${agreement.data.status === 'Shared'
                          ? 'bg-amber-600 hover:bg-amber-700 cursor-pointer text-amber-600 border-amber-200 hover:text-white '
                          : 'bg-gray-300 cursor-not-allowed'
                          }`}
                      >
                        <Clock className="w-4 h-4" />
                        Request Agreement Revision
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

        </div>
      </main>
    </div>
  );
};

export default AgreementOnboarding;
