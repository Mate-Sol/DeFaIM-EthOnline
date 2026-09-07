import axios from 'axios';
import { AlertCircle, AlertTriangle, ArrowLeft, ArrowUpRight, Building, Calendar, CheckCircle, ClipboardList, Clock, CreditCard, DollarSign, Download, FileText, Globe, Landmark, Loader2, MessageSquare, Package, RotateCcw, Scale, ShieldCheck, ShieldCheckIcon, TrendingUp, Upload, Users, X, XCircle } from 'lucide-react';
import moment from 'moment';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import ActivePoolTab from '../../../components/ActivePoolTab';
import Sidebar from '../../../components/Sidebar';
import { useAuth } from '../../../context/AuthContext';
import { adminAPI, notificationAPI } from '../../../services/api';
import { countries } from '../../../services/countries';

const getCountryName = (codeOrName) => {
  if (!codeOrName) return "N/A";
  const country = countries.find(c => c.code === codeOrName || c.label === codeOrName);
  return country ? country.label : codeOrName;
};

const ApplicationReview = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [decision, setDecision] = useState(null);
  console.log("🚀 ~ ApplicationReview ~ decision:", decision)
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [application, setApplication] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [segments, setSegments] = useState([]);

  useEffect(() => {
    const fetchSegments = async () => {
      try {
        const response = await adminAPI.getSegments();
        setSegments(response.data);
      } catch (err) {
        console.error('Failed to load segments:', err);
      }
    };
    fetchSegments();
  }, []);
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [isNegotiatingLegal, setIsNegotiatingLegal] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const [expandedDocTypes, setExpandedDocTypes] = useState({});

  const toggleDocType = (type) => {
    setExpandedDocTypes(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };
  const [decisionData, setDecisionData] = useState({
    creditLine: '',          // Replaced approvedAmount
    creditReserve: '0',
    approvedDuration: '',
    requestedAmount: '',
    requestedDuration: '',
    walletAddress: '',
    notes: '',
    reportFile: null,
    utilizedBips: 5,
    unutilizedBips: 1,
    penaltyBips: 10,
    penaltyGracePeriodHours: 24,
    pauseAfterDays: 3,
    drawdown_limit: '',
    facility_tenure: '',
    drawdown_tenor: '',
    penalty_rate: '',
    requested_Apy: '',
    psp_identifie: ''
  });
  useEffect(() => {
    fetchApplication();
  }, [id]);

  const fetchApplication = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getApplication(id);
      const appData = response.data;
      const draft = appData.draftApproval || {};
      setApplication(appData);

      setDecisionData(prev => ({
        ...prev,
        // Use draft values if available, otherwise fallback to defaults
        creditLine: draft.creditLine || '',
        creditReserve: draft.creditReserve || '0',
        requestedAmount: appData.requestedAmount || '',
        requestedDuration: appData.requestedDuration || '',
        approvedDuration: draft.approvedDuration || appData.requestedDuration || '',
        utilizedBips: draft.utilizedBips || '',
        unutilizedBips: draft.unutilizedBips || '',
        penaltyBips: draft.penaltyBips || '',
        penaltyGracePeriodHours: draft.penaltyGracePeriodHours || '24',
        pauseAfterDays: draft.pauseAfterDays || '3',
        drawdown_tenor: draft.drawdown_tenor || '',
        psp_identifie: draft.psp_identifie || appData.companyName || '',
        minUtilizationRate: draft.minUtilizationRate || '',

        walletAddress: Array.isArray(appData.walletAddress) && appData.walletAddress.length > 0
          ? appData.walletAddress[0].address
          : (typeof appData.walletAddress === 'string' ? appData.walletAddress : ''),
        notes: draft.notes || ''
      }));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load application');
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      setLoadingLogs(true);
      const response = await adminAPI.getAuditLogs(id);
      setAuditLogs(response.data);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'audit-log') {
      fetchAuditLogs();
    }
  }, [activeTab]);

  const handleDownloadDocument = async (docId, fileName) => {
    try {
      // Use backend proxy — server fetches from Azure and forces correct filename via Content-Disposition
      const response = await adminAPI.downloadDocument(docId);
      const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      // fileName (doc.name) is the user-provided name — always clean and correct
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error('Failed to download document: ' + (err.response?.data?.message || err.message));
    }
  };

  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const adminReviewDocuments = (application?.documents || []).filter(
    (doc) => doc.category === 'Credit Report' || doc.isAdminUpload || doc.uploadedByRole
  );

  const hasForwardedToCRO = ['CRO_REVIEW', 'FINALIZED'].includes(application?.workflowStep) || Boolean(application?.draftApproval);

  const handleDecision = (type) => {
    setDecision(type);
    setShowDecisionModal(true);
  };

  const submitDecision = async () => {
    try {
      const isCroFinalStep = application.workflowStep === 'CRO_FINAL_CONFIRMATION';

      setSubmitting(true);
      setError(null);

      // Validation logic for parameters
      if (decision === 'approve' || decision === 'forward-to-cro') {
        const minUtil = parseFloat(decisionData.minUtilizationRate || 0);
        const duration = parseInt(decisionData.approvedDuration || 0);
        const drawdownTenor = parseInt(decisionData.drawdown_tenor || 0);
        const pauseAfter = parseInt(decisionData.pauseAfterDays || 0);
        const graceHours = parseInt(decisionData.penaltyGracePeriodHours || 0);

        let maxCredit = 0;
        const clStr = String(decisionData.creditLine || '');
        if (clStr === '100K to 1M') maxCredit = 1000000;
        else if (clStr === '1M to 3M') maxCredit = 3000000;
        else if (clStr === '3M to 5M') maxCredit = 5000000;
        else if (clStr === '5M to 7M') maxCredit = 7000000;
        else if (clStr === '7M to 10M') maxCredit = 10000000;
        else if (!isNaN(parseFloat(clStr))) maxCredit = parseFloat(clStr);

        if (maxCredit > 0 && minUtil > maxCredit) {
          setError('Min Utilization limit should not exceed the approved credit limit.');
          setSubmitting(false);
          return;
        }

        if (duration > 0) {
          if (drawdownTenor > duration) {
            setError('Drawdown tenure should not exceed the CL expiry duration.');
            setSubmitting(false);
            return;
          }

          if (pauseAfter > duration) {
            setError('Pause After tenure should not exceed the CL expiry duration.');
            setSubmitting(false);
            return;
          }

          if (graceHours > duration * 24) {
            setError(`Penalty grace tenure should not exceed total hours of the CL expiry duration (${duration * 24} hours).`);
            setSubmitting(false);
            return;
          }
        }
      }

      if (decision === 'approve') {
        // Only CRO can approve
        if (decisionData.reportFile) {
          try {
            await adminAPI.uploadApplicationDocument(id, {
              category: 'Credit Report',
              documentType: 'Review Report & Contract',
              uploadedBy: user?.name || user?.email || user?.role,
              uploadedByRole: user?.role,
              ...decisionData.reportFile
            });
          } catch (uploadErr) {
            console.error('Report upload failed:', uploadErr);
            toast.error('Application approved, but the credit report upload failed.');
          }
        }

        // Parse creditLine string to number for backend
        let finalCreditLine = 0;
        const clStr = String(decisionData.creditLine || '');
        if (clStr === '100K to 1M') finalCreditLine = 1000000;
        else if (clStr === '1M to 3M') finalCreditLine = 3000000;
        else if (clStr === '3M to 5M') finalCreditLine = 5000000;
        else if (clStr === '5M to 7M') finalCreditLine = 7000000;
        else if (clStr === '7M to 10M') finalCreditLine = 10000000;
        else finalCreditLine = parseFloat(clStr) || 0;

        await adminAPI.approveApplication(id, {
          creditLine: finalCreditLine,
          creditReserve: parseFloat(decisionData.creditReserve || 0),
          approvedDuration: parseInt(decisionData.approvedDuration),
          notes: decisionData.notes,
          utilizedBips: parseFloat(decisionData.utilizedBips),
          unutilizedBips: parseFloat(decisionData.unutilizedBips),
          penaltyBips: parseFloat(decisionData.penaltyBips || 0),
          penaltyGracePeriodHours: parseInt(decisionData.penaltyGracePeriodHours || 24),
          pauseAfterDays: parseInt(decisionData.pauseAfterDays || 3),
          // Defa Fields (Computed)
          drawdown_limit: (finalCreditLine - parseFloat(decisionData.creditReserve || 0)).toString(),
          facility_tenure: decisionData.approvedDuration.toString(),
          penalty_rate: decisionData.penaltyBips.toString(),
          // Defa Fields (Manual)
          drawdown_tenor: decisionData.drawdown_tenor,
          // requested_Apy: decisionData.requested_Apy,
          psp_identifie: decisionData.psp_identifie,
          minUtilizationRate: parseInt(decisionData.minUtilizationRate || 0)
        });
        toast.success(isCroFinalStep ? 'Application Finalized & Pool Deployed!' : 'Application approved!');
        const redirectPath = user.role === 'KAM' ? '/admin/kam' : (user.role === 'CAD' ? '/admin/cad' : '/admin/cro');
        navigate(redirectPath);
      } else if (decision === 'approve-cad-to-kam') {
        await adminAPI.moveStep(id, { nextStep: 'KAM_FACILITY_REVIEW', notes: decisionData.notes });
        toast.success('Approved and forwarded to KAM.');
        navigate('/admin/cad');
      } else if (decision === 'kam-approve-to-psp') {
        await adminAPI.moveStep(id, { nextStep: 'PSP_FACILITY_APPROVAL', notes: decisionData.notes });
        toast.success('Approved and shared with PSP.');
        navigate('/admin/kam');
      } else if (decision === 'reject') {
        // Only CRO can reject
        await adminAPI.rejectApplication(id, { notes: decisionData.notes });
        toast.success('Application rejected.');
        navigate('/admin/cro');
      } else if (decision === 'request-info') {
        // KAM, CAD, or CRO can request info
        await adminAPI.requestInfo(id, { notes: decisionData.notes });

        toast.success('Additional information requested.');
        navigate(user.role === 'KAM' ? '/admin/kam' : (user.role === 'CAD' ? '/admin/cad' : '/admin/cro'));
      } else if (decision === 'forward-to-cad') {
        await adminAPI.forwardToCAD(id, { notes: decisionData.notes });
        toast.success('Forwarded to CAD.');
        navigate('/admin/kam');
      } else if (decision === 'forward-to-cro') {
        if (hasForwardedToCRO) {
          setError('Forward to CRO has already been completed for this application.');
          setSubmitting(false);
          return;
        }

        const draftParams = {
          creditLine: decisionData.creditLine, // Save as string to preserve selection
          creditReserve: parseFloat(decisionData.creditReserve || 0),
          approvedDuration: parseInt(decisionData.approvedDuration),
          utilizedBips: decisionData.utilizedBips,
          unutilizedBips: decisionData.unutilizedBips,
          penaltyBips: decisionData.penaltyBips,
          penaltyGracePeriodHours: parseInt(decisionData.penaltyGracePeriodHours),
          pauseAfterDays: parseInt(decisionData.pauseAfterDays),
          drawdown_tenor: decisionData.drawdown_tenor,
          psp_identifie: decisionData.psp_identifie,
          minUtilizationRate: parseInt(decisionData.minUtilizationRate || 0),
          notes: decisionData.notes
        };

        await adminAPI.forwardToCRO(id, {
          notes: decisionData.notes,
          draftApproval: draftParams,
          // CAD-edited overrides — backend updates the profile so the CRO
          // form (and downstream pool init) sees the corrected values.
          requestedAmount: parseFloat(decisionData.requestedAmount) || undefined,
          requestedDuration: parseInt(decisionData.requestedDuration) || undefined,
        });

        if (decisionData.reportFile) {
          try {
            await adminAPI.uploadApplicationDocument(id, {
              category: 'Credit Report',
              documentType: 'Credit Review Report',
              uploadedBy: user?.name || user?.email || user?.role,
              uploadedByRole: user?.role,
              ...decisionData.reportFile
            });
          } catch (uploadErr) {
            console.error('Report upload failed:', uploadErr);
            toast.error('Forwarded to CRO, but the review report upload failed.');
          }
        }

        toast.success('Forwarded to CRO with draft parameters.');
        navigate('/admin/cad');
      } else if (decision === 'return-to-kam') {
        await adminAPI.returnToKAM(id, { notes: decisionData.notes });
        toast.success('Returned to KAM.');
        navigate('/admin/cad');
      } else if (decision === 'forward-to-term-sheet') {
        await adminAPI.forwardToTermSheet(id);
        toast.success('Proceeded to Term Sheet stage.');
        fetchApplication();
      } else if (decision.startsWith('share-')) {
        const type = decision.split('-')[1] === 'term' ? 'termSheet' :
          (decision.split('-')[1] === 'tech' ? 'techAgreement' : 'facilityAgreement');
        await adminAPI.shareAgreement(id, { 
          type, 
          url: decisionData.agreementUrl, 
          notes: decisionData.notes,
          segmentId: decisionData.segmentId
        });
        toast.success(`${type} shared successfully.`);
        fetchApplication();
      } else if (decision === 'cro-approve-to-legal') {
        await adminAPI.moveStep(id, { nextStep: 'LEGAL_REVIEW', notes: decisionData.notes });

        if (decisionData.reportFile) {
          try {
            await adminAPI.uploadApplicationDocument(id, {
              category: 'Credit Report',
              documentType: 'Credit Review Report',
              uploadedBy: user?.name || user?.email || user?.role,
              uploadedByRole: user?.role,
              ...decisionData.reportFile
            });
          } catch (uploadErr) {
            console.error('Report upload failed:', uploadErr);
            toast.error('Approved by CRO, but the credit report upload failed.');
          }
        }

        toast.success('Approved by CRO. Moved to Legal Review.');
        fetchApplication();
      }
      setShowDecisionModal(false);

    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit decision');
      setSubmitting(false);
    }
  };

  const handleApproveOnboarding = async () => {
    try {
      setSubmitting(true);
      await adminAPI.approveOnboarding(id);
      toast.success('Approved for onboarding. The PSP can now complete their profile.');
      fetchApplication(); // Refresh data
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve onboarding');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestOnDefa = async () => {
    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        userId: application.userId || application._id,
        companyName: application.companyName,
        registrationNo: application.registrationNo,
        country: application.country,
        yearEstablished: application.yearEstablished,
        keyContact: {
          name: application.keyContact?.name || '',
          email: application.keyContact?.email || '',
          phone: application.keyContact?.phone || ''
        },
        uboDetails: application.uboDetails || '',
        pepExposure: !!application.pepExposure,
        walletAddress: Array.isArray(application.walletAddress) ? application.walletAddress : [{ name: 'Default', address: application.walletAddress }],
        // Computed Defa fields
        drawdown_limit: (parseFloat(decisionData.creditLine) - parseFloat(decisionData.creditReserve || 0)).toString(),
        facility_tenure: decisionData.approvedDuration.toString(),
        penalty_rate: decisionData.penaltyBips.toString(),
        // Manual Defa fields
        drawdown_tenor: decisionData.drawdown_tenor,
        // requested_Apy: decisionData.requested_Apy,
        psp_identifie: decisionData.psp_identifie,
        sector: application.sector || '',
        keyProducts: application.keyProducts || [],
        topCustomers: application.topCustomers || [],
        topSuppliers: application.topSuppliers || [],
        transactionVolume: application.transactionVolume || 0,
        annualRevenue: application.annualRevenue || 0,
        outstandingLoans: application.outstandingLoans || 0,
        rolledOutCreditLines: application.rolledOutCreditLines || 0,
        primaryBank: application.primaryBank || '',
        currentAllocation: application.currentAllocation || 0,
        projectedRevenue: application.projectedRevenue || 0,
        profitMargin: application.profitMargin || 0,
        monthlyCashFlow: application.monthlyCashFlow || 0,
        defaultHistory: !!application.defaultHistory,
        settelmentWindow: parseInt(decisionData.pauseAfterDays) || 0,
        assignedPoolAddress: application.assignedPoolAddress || "",
        approvedAmount: parseFloat(decisionData.creditLine) || 0,
        currentlyUtilized: 0,
        creditLineStatus: "Approved",
        requestedAmount: parseFloat(decisionData.requestedAmount) || 0,
        requestedDuration: parseInt(decisionData.requestedDuration) || 0,
        approvedDuration: parseInt(decisionData.approvedDuration) || 0,
        utilizedBips: parseFloat(decisionData.utilizedBips) || 0,
        unutilizedBips: parseFloat(decisionData.unutilizedBips) || 0,
        cadMessage: decisionData.notes || '',
        maintenanceChargeFrequency: "monthly",
        creditScoring: {
          criteriaScores: application.creditScoring?.criteriaScores || {},
          percentage: application.creditScoring?.percentage || 0,
          rating: application.creditScoring?.rating || "N/A"
        },
        attachments: application.documents
      };

      await axios.post('https://defas3.invoicemate.net/api-v2/psp/newPSPProfile', payload);
      toast.success('Request sent to Defa successfully!');
      setShowDecisionModal(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send request to Defa. ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-brand-purple mx-auto mb-4" />
          <p className="text-gray-600">Loading application...</p>
        </div>
      </div>
    );
  }

  // if (error && !application) {
  //   return (
  //     <div className="min-h-screen bg-gray-50 flex items-center justify-center">
  //       <div className="text-center">
  //         <div className="text-red-500 mb-4">Error loading application</div>
  //         <p className="text-gray-600 mb-4">{error}</p>
  //         <button onClick={() => navigate('/admin/cro')} className="btn-brand">
  //           Back to Dashboard
  //         </button>
  //       </div>
  //     </div>
  //   );
  // }

  return (
    <>
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
            {application?.agreementNotes?.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No message yet.<br />Start a conversation with your PSP `{application.companyName}`</p>
              </div>
            ) : (
              application?.agreementNotes?.map((note, idx) => (
                <div key={idx} className={`p-3 rounded-xl border ${note.role === 'PSP' ? 'bg-brand-purple/5 border-brand-purple/10 ml-4' : 'bg-gray-50 border-gray-100 mr-4'}`}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-bold text-gray-900">
                      {note.adminName || note.role}
                      {note.isHiddenFromPSP && <span className="ml-2 text-[8px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">Internal</span>}
                    </span>
                    <span className="text-[9px] text-gray-400">{moment(note.timestamp).fromNow()}</span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{note.text}</p>
                </div>
              ))
            )}
          </div>

          <div className="p-6 border-t border-gray-100 bg-gray-50/50">
            <textarea
              id="negotiation-note"
              placeholder="Message"
              className="w-full p-3 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple transition-all min-h-[80px]"
            />
            <button
              onClick={async () => {
                const text = document.getElementById('negotiation-note').value;
                if (!text) return;
                try {
                  await adminAPI.addNegotiationNote(id, text, { isHiddenFromPSP: isNegotiatingLegal });

                  if (isNegotiatingLegal) {
                    await adminAPI.moveStep(id, {
                      nextStep: 'LEGAL_REVIEW',
                      facilityAgreementStatus: 'Negotiating'
                    });
                    setIsNegotiatingLegal(false);
                    setShowNegotiation(false);
                    toast.success('Note added and sent back to Legal Admin.');
                  } else {
                    toast.success('Note added (Hidden from PSP)');
                  }

                  document.getElementById('negotiation-note').value = '';
                  fetchApplication();
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

      {/* Main Content (Offset for Sidebar) */}
      <main className={`ml-64 transition-all duration-300 p-8 ${showNegotiation ? 'mr-80' : 'mr-0'}`}>
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
            >
              <ArrowLeft className="w-5 h-5" />
              Back
            </button>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="page-header mb-1">{application.companyName}</h1>
                <p className="text-gray-600">Credit Line Approval Flow - <span className="font-bold text-brand-purple">{application.workflowStep?.replace(/_/g, ' ')}</span></p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="badge badge-warning">{application.creditLineStatus}</span>
                <span className="text-[10px] text-gray-400 font-mono">{application._id}</span>
              </div>
            </div>
          </div>

          {/* Workflow Progress Tracker */}
          <div className="mb-8 overflow-x-auto py-4 px-1">
            <div className="flex items-center min-w-max gap-2">
              {[
                { step: 'KAM_REVIEW', label: 'Relationship' },
                { step: 'TERM_SHEET_STAGE', label: 'Term Sheet' },
                { step: 'TECH_INTEGRATION_STAGE', label: 'Tech Integration' },
                { step: 'CRO_REVIEW', label: 'CRO Review' },
                { step: 'LEGAL_REVIEW', label: 'Legal' },
                { step: 'CAD_FACILITY_REVIEW', label: 'Risk Review' },
                { step: 'KAM_FACILITY_REVIEW', label: 'Relationship Review' },
                { step: 'PSP_FACILITY_APPROVAL', label: 'PSP Sign' },
                { step: 'CAD_FINAL_APPROVAL', label: 'Risk Final' },
                { step: 'CRO_FINAL_CONFIRMATION', label: 'CRO Final' },
                { step: 'FINALIZED', label: 'Finalized' }
              ].map((s, idx, arr) => {
                const isCompleted = arr.findIndex(item => item.step === application.workflowStep) > idx;
                const isActive = application.workflowStep === s.step;
                return (
                  <div key={s.step} className="flex items-center gap-2">
                    <div className={`flex flex-col items-center gap-1 ${isActive ? 'scale-110 transition-transform' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${isCompleted ? 'bg-green-500 border-green-500 text-white' :
                        isActive ? 'bg-brand-purple border-brand-purple text-white shadow-lg shadow-brand-purple/20' :
                          'bg-white border-gray-200 text-gray-400'
                        }`}>
                        {isCompleted ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-tighter ${isActive ? 'text-brand-purple' : 'text-gray-400'}`}>{s.label}</span>
                    </div>
                    {idx < arr.length - 1 && (
                      <div className={`w-8 h-0.5 ${isCompleted ? 'bg-green-500' : 'bg-gray-100'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Status-specific Agreement Actions */}
          {application.workflowStep === 'TERM_SHEET_STAGE' && user.role === 'CAD' && (
            <div className="mb-8 p-6 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Share Term Sheet</h3>
                  <p className="text-sm text-gray-500">The application is approved for a Term Sheet. Please upload and share it with the PSP.</p>
                  {application.termSheet?.status && (
                    <p className="text-xs mt-1">Status: <span className="font-bold text-blue-600">{application.termSheet.status}</span></p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDecision('share-term-sheet')}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Share Term Sheet
              </button>
            </div>
          )}

          {application.workflowStep === 'TECH_INTEGRATION_STAGE' && user.role === 'CAD' && (
            <div className="mb-8 p-6 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                  <Package className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Technical Integration Agreement</h3>
                  <p className="text-sm text-gray-500">Share the technical integration agreement for PSP review.</p>
                  {application.techAgreement?.status && (
                    <p className="text-xs mt-1">Status: <span className="font-bold text-indigo-600">{application.techAgreement.status}</span></p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDecision('share-tech-agreement')}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Share Tech Agreement
              </button>
            </div>
          )}

          {application.workflowStep === 'LEGAL_REVIEW' && user.role === 'LEGAL_ADMIN' && (
            <div className="mb-8 p-6 bg-purple-50 border border-purple-100 rounded-2xl flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                  <Scale className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Add Facility Agreement</h3>
                  <p className="text-sm text-gray-500">Finalize the legal framework and upload the Facility Agreement.</p>
                </div>
              </div>
              <button
                onClick={() => handleDecision('share-facility-agreement')}
                className="px-6 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-all shadow-lg shadow-purple-200 flex items-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Share Facility Agreement
              </button>
            </div>
          )}

          {application.workflowStep === 'CRO_FACILITY_REVIEW' && user.role === 'CRO' && (
            <div className="card p-6 border-l-4 border-l-brand-purple bg-brand-purple/5 mb-8">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">CRO Facility Review</h3>
                  <p className="text-gray-600 text-sm">Review the facility agreement shared by Legal. Approving will move it to CAD for technical parameters review.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDecision('approve')}
                    className="px-6 py-2 bg-brand-purple text-white rounded-lg font-bold hover:bg-brand-purple/90 transition-all flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve to CAD
                  </button>
                  <button
                    onClick={() => handleDecision('reject')}
                    className="px-6 py-2 bg-white border border-red-200 text-red-600 rounded-lg font-bold hover:bg-red-50 transition-all"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )}

          {application.workflowStep === 'CAD_FACILITY_REVIEW' && user.role === 'CAD' && (
            <div className="card p-6 border-l-4 border-l-brand-purple bg-brand-purple/5 mb-8">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Risk Review</h3>
                  <p className="text-gray-600 text-sm">Review the facility agreement. Approving will forward it to the Relationship Manager for final review before sharing with the PSP.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setIsNegotiatingLegal(true);
                      setShowNegotiation(true);
                      setTimeout(() => {
                        document.getElementById('negotiation-note')?.focus();
                      }, 300);
                    }}
                    className="px-6 py-2 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 transition-all flex items-center gap-2"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Negotiate to Legal
                  </button>
                  <button
                    onClick={() => handleDecision('approve-cad-to-kam')}
                    className="px-6 py-2 bg-brand-purple text-white rounded-lg font-bold hover:bg-brand-purple/90 transition-all flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve to KAM
                  </button>
                </div>
              </div>
            </div>
          )}

          {application.workflowStep === 'KAM_FACILITY_REVIEW' && user.role === 'KAM' && (
            <div className="card p-6 border-l-4 border-l-brand-purple bg-brand-purple/5 mb-8">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Relationship Review</h3>
                  <p className="text-gray-600 text-sm">Final review of the facility agreement. Approving will share it with the PSP for their signature.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setIsNegotiatingLegal(true);
                      setShowNegotiation(true);
                      setTimeout(() => {
                        document.getElementById('negotiation-note')?.focus();
                      }, 300);
                    }}
                    className="px-6 py-2 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 transition-all flex items-center gap-2"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Negotiate to Legal
                  </button>
                  <button
                    onClick={() => handleDecision('kam-approve-to-psp')}
                    className="px-6 py-2 bg-brand-purple text-white rounded-lg font-bold hover:bg-brand-purple/90 transition-all flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve to PSP
                  </button>
                </div>
              </div>
            </div>
          )}

          {application.workflowStep === 'PSP_FACILITY_APPROVAL' && (
            <div className="card p-6 border-l-4 border-l-blue-500 bg-blue-50 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-blue-900">Awaiting PSP Signature</h3>
                  <p className="text-blue-700 text-sm">The facility agreement has been approved by CAD/CRO and is now with the PSP for final review and signature.</p>
                </div>
              </div>
            </div>
          )}

          {application.workflowStep === 'CAD_FINAL_APPROVAL' && user.role === 'CAD' && (
            <div className="card p-6 border-l-4 border-l-brand-purple bg-brand-purple/5 mb-8">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Risk Final Approval & Deployment</h3>
                  <p className="text-gray-600 text-sm">The PSP has signed the agreement. Finalize parameters and deploy the liquidity pool.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDecision('forward-to-cro')}
                    className="px-6 py-2 bg-brand-purple text-white rounded-lg font-bold hover:bg-brand-purple/90 transition-all flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve to CRO
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              onClick={() => setActiveTab('profile')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${activeTab === 'profile'
                ? 'border-brand-purple text-brand-purple'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Profile
            </button>
            <button
              onClick={() => setActiveTab('scoring')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${activeTab === 'scoring'
                ? 'border-brand-purple text-brand-purple'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Credit Scoring
            </button>
            <button
              onClick={() => setActiveTab('audit-log')}
              className={`px-6 py-3 font-medium transition-colors border-b-2 ${activeTab === 'audit-log'
                ? 'border-brand-purple text-brand-purple'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Audit Log
            </button>
            {application?.creditLineStatus === 'Approved' && user.role === 'CRO' && (
              <button
                onClick={() => setActiveTab('active-pool')}
                className={`px-6 py-3 font-medium transition-colors border-b-2 ${activeTab === 'active-pool'
                  ? 'border-brand-purple text-brand-purple'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Active Pool Status
              </button>
            )}
          </div>

          {application?.onboardingStatus === 'PRE_QUAL_PENDING' && user.role === 'KAM' && (
            <div className="mb-6 p-6 bg-brand-purple/5 border border-brand-purple/20 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-brand-purple/10 rounded-full flex items-center justify-center">
                  <ClipboardList className="w-6 h-6 text-brand-purple" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">Initial Registration Details Review</h3>
                  <p className="text-sm text-gray-500">This PSP has submitted their initial details and is waiting for approval to proceed with full onboarding.</p>
                </div>
              </div>
              <button
                onClick={handleApproveOnboarding}
                disabled={submitting}
                className="px-6 py-3 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all flex items-center gap-2 shadow-lg shadow-brand-purple/20 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Approve for Onboarding
              </button>
            </div>
          )}

          {activeTab === 'profile' ? (
            <>
              {/* Application Summary and Profile detail blocks are inside here */}
              <div className="grid md:grid-cols-3 gap-6 mb-8">
                <div className="stats-card">
                  <DollarSign className="w-5 h-5 text-brand-purple mb-2" />
                  <span className="stats-label">Requested Amount</span>
                  <span className="stats-value text-gradient">{formatCurrency(application.requestedAmount)}</span>
                </div>
                <div className="stats-card">
                  <Calendar className="w-5 h-5 text-brand-purple mb-2" />
                  <span className="stats-label">Duration</span>
                  <span className="stats-value">{application.requestedDuration} Days</span>
                </div>
                <div className="stats-card">
                  <Building className="w-5 h-5 text-brand-purple mb-2" />
                  <span className="stats-label">Annual Revenue</span>
                  <span className="stats-value">{formatCurrency(application.annualRevenue)}</span>
                </div>
              </div>

              {/* Highlighted Report Section */}
              {adminReviewDocuments.length > 0 && (
                <div className="mb-6 border border-brand-purple/20 rounded-xl overflow-hidden bg-brand-purple/5">
                  <button
                    onClick={() => toggleDocType('__admin_review_reports__')}
                    className={`w-full flex items-center justify-between p-4 transition-colors ${expandedDocTypes.__admin_review_reports__ ? 'bg-brand-purple/10' : 'hover:bg-brand-purple/10'
                      }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-brand-purple/10 rounded-full flex items-center justify-center">
                        <FileText className="w-6 h-6 text-brand-purple" />
                      </div>
                      <div className="text-left">
                        <h3 className="font-bold text-gray-900">Application Review Report</h3>
                        <p className="text-sm text-gray-500">
                          {adminReviewDocuments.length} document{adminReviewDocuments.length > 1 ? 's' : ''} uploaded by admin for this application.
                        </p>
                      </div>
                    </div>
                    <div className={`transform transition-transform duration-200 ${expandedDocTypes.__admin_review_reports__ ? 'rotate-180' : ''}`}>
                      <Package className="w-4 h-4 text-brand-purple" />
                    </div>
                  </button>

                  {expandedDocTypes.__admin_review_reports__ && (
                    <div className="p-4 bg-white border-t border-brand-purple/10 grid md:grid-cols-2 gap-3">
                      {adminReviewDocuments.map((doc) => (
                        <div key={doc._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-brand-purple/20 transition-all group">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-8 h-8 rounded bg-white flex items-center justify-center border border-gray-100 shrink-0 group-hover:text-brand-purple transition-colors">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="overflow-hidden">
                              <p className="font-semibold text-[11px] text-gray-700 truncate" title={doc.name}>
                                {doc.name}
                              </p>
                              <p className="text-[9px] text-gray-400">
                                {(doc.fileSize / (1024 * 1024)).toFixed(2)} MB | {new Date(doc.uploadedAt).toLocaleDateString()} | {doc.uploadedBy || 'Admin'}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDownloadDocument(doc._id, doc.name)}
                            className="p-2 text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-colors shrink-0"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Approved/Draft Terms Highlight */}
              {(application.creditLineStatus === "Approved" || application.draftApproval) && (
                <div className="card mb-6 border-l-4 border-l-green-500 bg-green-50/30">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-green-600" />
                      {application.creditLineStatus === "Approved" ? "Approved Terms" : "Draft Approval Parameters (from CAD)"}
                    </h2>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${application.creditLineStatus === "Approved" ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600"}`}>
                      {application.creditLineStatus === "Approved" ? "FINALIZED" : "DRAFT"}
                    </span>
                  </div>
                  <div className="grid md:grid-cols-4 gap-y-6 gap-x-4">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-wider text-brand-purple">Credit Line</p>
                      <p className="font-bold text-gray-900">{formatCurrency(application.approvedCreditLine || application.draftApproval?.creditLine)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Duration</p>
                      <p className="font-bold text-gray-900">{application.approvedDuration || application.draftApproval?.approvedDuration} Days</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Drawdown Tenor</p>
                      <p className="font-bold text-gray-900">{application.drawdown_tenor || application.draftApproval?.drawdown_tenor || "N/A"} Days</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Min Utilization</p>
                      <p className="font-bold text-green-700">${(application.minUtilizationRate || application.draftApproval?.minUtilizationRate || "0").toString().replace(' Days', '')}</p>
                    </div>

                    {/* Second Row */}
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Utilized Fee (APY)</p>
                      <p className="font-bold text-gray-900">{(application.utilizedBips || application.draftApproval?.utilizedBips || 0)} Bps</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Unutilized Fee</p>
                      <p className="font-bold text-gray-900">{(application.unutilizedBips || application.draftApproval?.unutilizedBips || 0)} Bps</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Penalty Rate</p>
                      <p className="font-bold text-red-600">{(application.penaltyBips || application.draftApproval?.penaltyBips || 0)} Bps</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Settlement Window</p>
                      <p className="font-bold text-gray-900">{application.pauseAfterDays || application.draftApproval?.pauseAfterDays || 0} Days</p>
                    </div>

                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">PSP Identifier</p>
                      <p className="font-bold text-brand-purple">{application.psp_identifie || application.draftApproval?.psp_identifie || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Penalty Grace</p>
                      <p className="font-bold text-gray-900">{application.penaltyGracePeriodHours || application.draftApproval?.penaltyGracePeriodHours || 0} Hours</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Registration Details Section */}
              <div className="card mb-6 border-l-4 border-l-brand-purple bg-brand-purple/5">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-brand-purple" />
                  Registration Details Details
                </h2>
                <div className="grid md:grid-cols-1 gap-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border border-brand-purple/10">
                    <div className="md:col-span-4">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">1. Legal Name of the Entity (Short Answer) *</p>
                      <p className="font-semibold text-gray-900">{application.registeredName || application.companyName || "N/A"}</p>
                    </div>
                    <div className="md:col-span-2 border-t border-gray-100 pt-3">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">1.1. Headquarter Jurisdiction *</p>
                      <p className="font-semibold text-gray-900">{getCountryName(application.jurisdiction || application.country)}</p>
                    </div>
                    <div className="md:col-span-2 border-t border-gray-100 pt-3">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">1.2. Regulatory License *</p>
                      <p className="font-semibold text-gray-900">{application.licenseType || "N/A"}</p>
                    </div>
                    <div className="md:col-span-4 border-t border-gray-100 pt-3">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">2. Business Model (Separate Fields) *</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {application.businessModels?.length > 0 ? (
                          application.businessModels.map((m, i) => (
                            <span key={i} className="px-2 py-1 bg-brand-purple/5 text-brand-purple rounded text-[10px] border border-brand-purple/10 font-medium">{m}</span>
                          ))
                        ) : (
                          <p className="text-sm text-gray-700 leading-relaxed">{application.businessModelDescription || "N/A"}</p>
                        )}
                      </div>
                    </div>
                    <div className="md:col-span-4 border-t border-gray-100 pt-3">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-3">3. Top Active Corridors *</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {(application.top3Corridors || [])
                          .filter(c => c.fromCountry || c.toCountry || c.volume || c.count)
                          .map((c, i) => (
                            <div key={i} className="relative p-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all group">
                              <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-opacity">
                                <Globe className="w-4 h-4 text-brand-purple" />
                              </div>
                              <p className="text-[10px] font-bold text-brand-purple uppercase mb-2 flex items-center gap-1">
                                {getCountryName(c.fromCountry)} <span className="text-gray-300">→</span> {getCountryName(c.toCountry)}
                              </p>
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className="p-2 bg-gray-50 rounded-lg">
                                  <p className="text-[9px] text-gray-400 uppercase font-bold">Vol (USD)</p>
                                  <p className="text-xs font-bold text-gray-900">{formatCurrency(c.volume)}</p>
                                </div>
                                <div className="p-2 bg-gray-50 rounded-lg">
                                  <p className="text-[9px] text-gray-400 uppercase font-bold">Transactions</p>
                                  <p className="text-xs font-bold text-gray-900">{c.count || 0}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        {(!application.top3Corridors || application.top3Corridors.filter(c => c.fromCountry || c.toCountry || c.volume || c.count).length === 0) && (
                          <div className="md:col-span-3 py-6 text-center bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                            <p className="text-xs text-gray-400">No active corridors provided</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="md:col-span-4 border-t border-gray-100 pt-3">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-3">4. Monthly Transaction Statistics (Last 6-7 Months) *</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {(application.monthlyTransactionVolumes || []).map((v, i) => {
                          const countObj = (application.numberOfTransactions || []).find(n => n.month === v.month) || {};
                          return (
                            <div key={i} className="flex flex-col p-2 bg-gray-50/50 rounded-lg border border-gray-100 hover:border-brand-purple/20 transition-all">
                              <span  className="text-[10px] font-bold text-brand-purple uppercase mb-2 flex items-center gap-1">{v.month}</span>
                              <div className="space-y-2">
                                <div className="p-2 bg-white/50 rounded border border-gray-100/50">
                                  <p className="text-[9px] text-gray-400 uppercase font-bold">Vol (USD)</p>
                                  <p className="text-[10px] font-bold text-gray-900">{formatCurrency(v.volume)}</p>
                                </div>
                                <div className="p-2 bg-white/50 rounded border border-gray-100/50">
                                  <p className="text-[9px] text-gray-400 uppercase font-bold">Count</p>
                                  <p className="text-[10px] font-bold text-gray-900">{countObj.count || 0}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="md:col-span-2 border-t border-gray-100 pt-3">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">5. Funding Requirement *</p>
                      <p className="font-semibold text-gray-900">
                        {application.preQualRequestedAmount ? `${application.preQualRequestedAmount} for ${application.preQualRequestedDuration}` : (application.requestedAmount ? `${formatCurrency(application.requestedAmount)} for ${application.requestedDuration} Days` : "N/A")}
                      </p>
                    </div>
                    <div className="md:col-span-2 border-t border-gray-100 pt-3">
                      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">6. Partner/Correspondent Network *</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{application.preQualFundingCounterparties || application.fundingCounterparties || "N/A"}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Credit Line Request Details */}
              <div className="card mb-6 border-l-4 border-l-brand-purple">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-brand-purple" />
                  Credit Line Request Details
                </h2>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-gray-500">Drawdown Tenor</p>
                    <p className="font-medium">{application.drawdown_tenor || "N/A"} Days</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Remittance Corridors</p>
                    <p className="font-medium">{application.remittanceCorridors || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Desired Currency</p>
                    <p className="font-medium">
                      {application.desiredCurrencyValue ? `${application.desiredCurrencyValue} (${application.desiredCurrencyType})` : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Blockchain Network</p>
                    <p className="font-medium text-capitalize">{application.desiredBCNetwork || "N/A"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-gray-500">Counterparties against funding</p>
                    <p className="font-medium">{application.fundingCounterparties || "N/A"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-gray-500">Purpose of Financing</p>
                    <p className="font-medium">{application.purpose || "N/A"}</p>
                  </div>
                </div>
              </div>

              {/* Company Information */}
              <div className="card mb-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Building className="w-5 h-5 text-brand-purple" />
                  Company Information</h2>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-gray-500">Registration Number</p>
                    <p className="font-medium">{application.registrationNo}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Headquarter Jurisdiction</p>
                    <p className="font-medium">{getCountryName(application.jurisdiction || application.country)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Year Established</p>
                    <p className="font-medium">{application.yearEstablished}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Business Models</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {application.businessModels?.length > 0 ? (
                        application.businessModels.map((m, i) => (
                          <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] border border-gray-200">{m}</span>
                        ))
                      ) : (
                        <p className="font-medium">{application.sector || "N/A"}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Transaction Volume</p>
                    <p className="font-medium">{application.transactionVolume}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Submitted Date</p>
                    <p className="font-medium">{new Date(application.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {/* Secondary Companies */}

              {application.secondaryCompanies && application.secondaryCompanies.length > 0 && (
                <div className='card mb-6'>
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Building className="w-5 h-5 text-brand-purple" />
                    Secondary Companies</h2>
                  {application.secondaryCompanies.map((company, index) => (
                    <div className="mb-6">
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <p className="text-sm text-gray-500">Name</p>
                          <p className="font-medium">{company.name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Registration Number</p>
                          <p className="font-medium text-gray-900">{company.registrationNo || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Country</p>
                          <p className="font-medium">{getCountryName(company.country)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Year Established</p>
                          <p className="font-medium">{company.yearEstablished}</p>
                        </div>
                      </div>
                      <div className="mt-4 pb-2">
                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-2">Company Documents</p>
                        <div className="grid md:grid-cols-2 gap-3">
                          {(application.documents || []).filter(doc => doc.secondaryCompanyId === company._id).map((doc) => (
                            <div key={doc._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-brand-purple/20 transition-all group">
                              <div className="flex items-center gap-3 overflow-hidden">
                                <div className="w-8 h-8 rounded bg-white flex items-center justify-center border border-gray-100 shrink-0 group-hover:text-brand-purple transition-colors">
                                  <FileText className="w-4 h-4" />
                                </div>
                                <div className="overflow-hidden">
                                  <p className="font-semibold text-[11px] text-gray-700 truncate" title={doc.name}>
                                    {doc.name}
                                  </p>
                                  <p className="text-[9px] text-gray-400">
                                    {doc.documentType}
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => handleDownloadDocument(doc._id, doc.name)}
                                className="p-2 text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-colors shrink-0"
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          {(application.documents || []).filter(doc => doc.secondaryCompanyId === company._id).length === 0 && (
                            <p className="text-[10px] text-gray-400 italic">No documents uploaded for this company.</p>
                          )}
                        </div>
                      </div>
                      {index !== application.secondaryCompanies.length - 1 && (
                        <hr className="my-4 border-brand-purple/30" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Contact Person */}
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div className="card">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-brand-purple" />
                    Key Contact Person
                  </h2>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Name</p>
                      <p className="font-medium text-gray-900">{application.keyContact?.name || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Designation</p>
                      <p className="font-medium text-gray-900">{application.keyContact?.position || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium text-gray-900">{application.keyContact?.email || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Phone</p>
                      <p className="font-medium text-gray-900">{application.keyContact?.phone || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <ShieldCheckIcon className="w-5 h-5 text-brand-purple" />
                    Ownership & Compliance
                  </h2>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">UBO Details</p>
                      <p className="font-medium text-gray-900">{application.uboDetails || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">PEP Exposure</p>
                      {application.pepExposure ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-600 border border-red-200 inline-flex items-center gap-1 mt-1">
                          <AlertTriangle className="w-3 h-3" />
                          Yes (High Risk)
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-600 border border-green-200 inline-flex items-center gap-1 mt-1">
                          <CheckCircle className="w-3 h-3" />
                          No (Safe)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Business Ecosystem */}
              <div className="card mb-6">
                <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <Package className="w-5 h-5 text-brand-purple" />
                  Business Ecosystem
                </h2>
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Key Products/Services</h3>
                    <div className="flex flex-wrap gap-2">
                      {application.keyProducts?.length > 0 ? (
                        application.keyProducts.map((p, i) => (
                          <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs border border-gray-200">{p}</span>
                        ))
                      ) : <span className="text-gray-400 italic text-xs">No data provided</span>}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Top Counterparties</h3>
                    <div className="flex flex-wrap gap-2">
                      {application.topCustomers?.length > 0 ? (
                        application.topCustomers.map((c, i) => (
                          <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs border border-gray-200">{c}</span>
                        ))
                      ) : <span className="text-gray-400 italic text-xs">No data provided</span>}
                    </div>
                  </div>
                  {/* <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Top Suppliers</h3>
                    <div className="flex flex-wrap gap-2">
                      {application.topSuppliers?.length > 0 ? (
                        application.topSuppliers.map((s, i) => (
                          <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs border border-gray-200">{s}</span>
                        ))
                      ) : <span className="text-gray-400 italic text-xs">No data provided</span>}
                    </div>
                  </div> */}
                </div>
              </div>

              {/* Financial Metrics & Banking */}
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div className="card">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-brand-purple" />
                    Financial Metrics
                  </h2>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b border-gray-50">
                      <span className="text-sm text-gray-500">Annual Revenue (Last Year)</span>
                      <span className="font-bold text-gray-900">{formatCurrency(application.annualRevenue)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-50">
                      <span className="text-sm text-gray-500">Projected Revenue (This Year)</span>
                      <span className="font-bold text-brand-purple">{formatCurrency(application.projectedRevenue)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-50">
                      <span className="text-sm text-gray-500">Net Profit Margin</span>
                      <span className="font-bold text-gray-900">{application.profitMargin}%</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-gray-500">Monthly Cash Flow</span>
                      <span className="font-bold text-gray-900">{formatCurrency(application.monthlyCashFlow)}</span>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Landmark className="w-5 h-5 text-brand-purple" />
                    Banking & Infrastructure
                  </h2>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b border-gray-50">
                      <span className="text-sm text-gray-500">Primary Settlement Bank</span>
                      <span className="font-bold text-gray-900">{application.primaryBank || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-50">
                      <span className="text-sm text-gray-500">Current Facility Allocation</span>
                      <span className="font-bold text-gray-900">{formatCurrency(application.currentAllocation)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-50">
                      <span className="text-sm text-gray-500">Other Rolled-out Credit Lines</span>
                      <span className="font-bold text-gray-900">{formatCurrency(application.rolledOutCreditLines)}</span>
                    </div>
                    <div className="py-2">
                      <p className="text-sm text-gray-500 mb-2">Registered Wallets</p>
                      <div className="space-y-2">
                        {Array.isArray(application.walletAddress) && application.walletAddress.length > 0 ? (
                          application.walletAddress.map((w, i) => (
                            <div key={i} className="bg-gray-50 p-2 rounded border border-gray-100">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold text-gray-400 uppercase">{w.name || `Wallet ${i + 1}`}</span>
                                {i === 0 && <span className="text-[8px] bg-brand-purple/10 text-brand-purple px-1 rounded">PRIMARY</span>}
                              </div>
                              <p className="text-[10px] font-mono break-all text-gray-600">{w.address}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-[11px] font-mono bg-gray-50 p-2 rounded border border-gray-100 break-all text-gray-600">
                            {typeof application.walletAddress === 'string' ? application.walletAddress : 'N/A'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk Profile */}
              <div className="card mb-6 border-l-4 border-l-brand-purple">
                <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-brand-purple" />
                  Risk Profile & History
                </h2>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">Default / Restructuring History</p>
                  <p className="text-sm font-medium text-gray-900">
                    {application.defaultHistory || 'No history reported.'}
                  </p>
                </div>
              </div>

              {/* Agreement Status (Shared Agreements) */}
              {(application?.termSheet?.status || application?.techAgreement?.status || application?.facilityAgreement?.status) && (
                <div className="card mb-6 border-l-4 border-l-blue-500 bg-blue-50/30">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <FileText className="w-5 h-5 text-brand-purple" />
                    Shared Agreements Status
                  </h2>

                  <div className="space-y-4">
                    {[
                      { key: 'termSheet', label: 'Term Sheet', data: application?.termSheet },
                      { key: 'techAgreement', label: 'Technical Integration Agreement', data: application?.techAgreement },
                      { key: 'facilityAgreement', label: 'Facility Agreement', data: application?.facilityAgreement }
                    ].filter(a => a.data?.status).map((agreement) => (
                      <div key={agreement.key} className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h3 className="font-bold text-sm text-gray-900">{agreement.label}</h3>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              Status: <span className="font-bold text-blue-600">{agreement.data.status}</span>
                              {agreement.data.sharedAt && ` • Shared on ${moment(agreement.data.sharedAt).format('lll')}`}
                              {agreement.data.acceptedAt && ` • Accepted on ${moment(agreement.data.acceptedAt).format('lll')}`}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase ${agreement.data.status === 'Accepted' ? 'bg-green-100 text-green-600' :
                            agreement.data.status === 'Negotiating' ? 'bg-amber-100 text-amber-600' :
                              'bg-blue-100 text-blue-600'
                            }`}>
                            {agreement.data.status}
                          </span>
                        </div>

                        <div className="flex gap-2">
                          {['Shared', 'Accepted'].includes(agreement.data.status) ?
                            <a
                              href={agreement.data.url}
                              target="_blank"

                              rel="noopener noreferrer"
                              className={`px-3 py-1.5 ${['Shared', 'Accepted'].includes(agreement.data.status) ? 'bg-green-100 text-green-600 cursor-pointer' : 'bg-gray-50 text-gray-600 cursor-not-allowed'} rounded-lg text-xs font-bold hover:bg-blue-600 hover:text-white transition-all flex items-center gap-2`}
                            >
                              <Download className="w-3.5 h-3.5" />
                              View Document
                            </a> :
                            <span
                              className='px-3 py-1.5 bg-gray-50 text-gray-600 cursor-not-allowed rounded-lg text-xs font-bold hover:bg-blue-600 hover:text-white transition-all flex items-center gap-2'
                            >
                              <Download className="w-3.5 h-3.5" />
                              View Document
                            </span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grouped Documents */}
              <div className="card mb-8">
                <h2 className="text-lg font-semibold mb-6">Submitted Documents</h2>

                {['Company Identity & Legal', 'Operational Settlement Data', 'Financials & Banking', 'Risk & Legal'].map((category) => {
                  const categoryDocs = application?.documents?.filter(doc =>
                    doc.category === category &&
                    !doc.isAdminUpload &&
                    !doc.uploadedByRole &&
                    !doc.secondaryCompanyId &&
                    !['Credit Review Report', 'Review Report & Contract'].includes(doc.documentType)
                  ) || [];
                  if (categoryDocs.length === 0) return null;

                  // Group documents by documentType (with normalization to merge duplicates)
                  const groupedDocs = categoryDocs.reduce((acc, doc) => {
                    let type = doc.documentType || 'Other';
                    
                    // Normalize for grouping
                    const normalizedType = type.replace(/\s*\*$/, '').replace(' (if applicable)', '').trim();

                    if (normalizedType.toLowerCase().includes('organogram')) {
                      type = 'Organogram (Attach a picture of your holding and subsidiary companies)';
                    } else if (normalizedType.toLowerCase().includes('passport/id card of all ubo')) {
                      type = 'Passport/ID card of all ubos';
                    } else if (normalizedType.toLowerCase().includes('flow of funds') || normalizedType.toLowerCase().includes('flowoffunds')) {
                      type = 'Flow of Funds';
                    } else {
                      type = normalizedType;
                    }

                    if (!acc[type]) acc[type] = [];
                    acc[type].push(doc);
                    return acc;
                  }, {});

                  return (
                    <div key={category} className="mb-6 last:mb-0">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 px-1">{category}</h3>
                      <div className="space-y-3">
                        {Object.entries(groupedDocs).map(([docType, docs]) => {
                          const isExpanded = !!expandedDocTypes[docType];
                          return (
                            <div key={docType} className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                              {/* Header */}
                              <button
                                onClick={() => toggleDocType(docType)}
                                className={`w-full flex items-center justify-between p-4 transition-colors ${isExpanded ? 'bg-brand-purple/5' : 'bg-white hover:bg-gray-50'
                                  }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`p-2 rounded-lg ${isExpanded ? 'bg-brand-purple/10 text-brand-purple' : 'bg-gray-100 text-gray-400'}`}>
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div className="text-left">
                                    <p className="font-bold text-sm text-gray-900">{docType}</p>
                                    <p className="text-[10px] text-gray-500">{docs.length} document{docs.length > 1 ? 's' : ''} submitted</p>
                                  </div>
                                </div>
                                <div className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                                  <Package className="w-4 h-4 text-gray-400" />
                                </div>
                              </button>

                              {/* Document List */}
                              {isExpanded && (
                                <div className="p-4 bg-white grid md:grid-cols-2 gap-3 border-t border-gray-50 animate-fade-in">
                                  {docs.map((doc) => (
                                    <div key={doc._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-brand-purple/20 transition-all group">
                                      <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-8 h-8 rounded bg-white flex items-center justify-center border border-gray-100 shrink-0 group-hover:text-brand-purple transition-colors">
                                          <FileText className="w-4 h-4" />
                                        </div>
                                        <div className="overflow-hidden">
                                          <p className="font-semibold text-[11px] text-gray-700 truncate" title={doc.name}>
                                            {doc.name}
                                          </p>
                                          <p className="text-[9px] text-gray-400">
                                            {(doc.fileSize / (1024 * 1024)).toFixed(2)} MB • {new Date(doc.uploadedAt).toLocaleDateString()}
                                          </p>
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => handleDownloadDocument(doc._id, doc.name)}
                                        className="p-2 text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-colors shrink-0"
                                        title="Download"
                                      >
                                        <Download className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {(!application?.documents || application.documents.length === 0) && (
                  <div className="text-center py-8 text-gray-500 italic bg-gray-50 rounded-lg">
                    No documents submitted with this application.
                  </div>
                )}
              </div>
            </>
          ) : activeTab === 'scoring' ? (
            <CreditScoringTab
              application={application}
              onUpdate={fetchApplication}
              isEditable={user.role === 'CAD'}
            />
          ) : activeTab === 'audit-log' ? (
            <AuditLogTab logs={auditLogs} loading={loadingLogs} />
          ) : activeTab === 'active-pool' ? (
            <ActivePoolTab applicationId={id} application={application} />
          ) : null}
          {/* Decision Actions */}
          <div className="flex flex-wrap gap-4 mt-12 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            {user.role === 'KAM' && (application.workflowStep === 'KAM_REVIEW' || application.creditLineStatus === 'Expired' || application.creditLineStatus === 'Approved') && (
              <>
                <button onClick={() => handleDecision('forward-to-cad')} className="btn-brand flex items-center gap-2 flex-1">
                  <ArrowUpRight className="w-5 h-5" /> Forward to CAD
                </button>
                <button onClick={() => handleDecision('request-info')} className="btn-secondary flex items-center gap-2 flex-1">
                  <Clock className="w-5 h-5" /> Request Info
                </button>
              </>
            )}

            {/* {user.role === 'CAD' && (application.workflowStep === 'TERM_SHEET_STAGE' || application.workflowStep === 'CRO_REVIEW' || application.creditLineStatus === 'Expired' || application.creditLineStatus === 'Approved') && ( */}
            {user.role === 'CAD' && (application.workflowStep === 'TERM_SHEET_STAGE' || application.workflowStep === 'CRO_REVIEW') && (
              <>
                {/* <button onClick={() => handleDecision('forward-to-term-sheet')} className="btn-brand flex items-center gap-2 flex-1">
                  <ArrowUpRight className="w-5 h-5" /> Proceed to Term Sheet
                </button> */}
                <button onClick={() => handleDecision('request-info')} className="btn-secondary flex items-center gap-2 flex-1">
                  <Clock className="w-5 h-5" /> Request Info
                </button>
              </>
            )}

            {user.role === 'CRO' && (application.workflowStep === 'CRO_REVIEW' || application.creditLineStatus === 'Expired' || application.creditLineStatus === 'Approved') && (
              <>
                {application.workflowStep === 'CRO_REVIEW' && (
                  <button
                    onClick={() => handleDecision('cro-approve-to-legal')}
                    className="btn-brand flex items-center gap-2 flex-1"
                  >
                    <CheckCircle className="w-5 h-5" /> CRO Approve to Legal
                  </button>
                )}

                <button onClick={() => handleDecision('request-info')} className="btn-secondary flex items-center gap-2 flex-1">
                  <RotateCcw className="w-5 h-5" /> Request Info
                </button>
              </>
            )}

            {user.role === 'LEGAL_ADMIN' && (application.workflowStep === 'LEGAL_REVIEW' || application.creditLineStatus === 'Expired' || application.creditLineStatus === 'Approved') && (
              <button onClick={() => handleDecision('share-facility-agreement')} className="btn-brand flex items-center gap-2 flex-1">
                <Scale className="w-5 h-5" /> Share Facility Agreement
              </button>
            )}

            {/* {user.role === 'CAD' && (application.workflowStep === 'CAD_FINAL_APPROVAL' || application.creditLineStatus === 'Expired' || application.creditLineStatus === 'Approved') && ( */}
            {user.role === 'CAD' && application.workflowStep === 'CAD_FINAL_APPROVAL' && (
              <button onClick={() => handleDecision('forward-to-cro')} className="btn-brand flex items-center gap-2 flex-1">
                <CheckCircle className="w-5 h-5" /> Forward to CRO
              </button>
            )}

            {user.role === 'CRO' && application.workflowStep === 'CRO_FINAL_CONFIRMATION' && (
              <button onClick={() => handleDecision('approve')} className="btn-brand flex items-center gap-2 flex-1">
                <CheckCircle className="w-5 h-5" /> Final Approve & Deploy Pool
              </button>
            )}
          </div>

        </div>
      </main >

      {/* Decision Modal */}
      {showDecisionModal && (
        <DecisionModal
          decision={decision}
          application={application}
          decisionData={decisionData}
          setDecisionData={setDecisionData}
          submitting={submitting}
          error={error}
          onClose={() => {
            setShowDecisionModal(false);
            setError(null);
          }}
          onConfirm={submitDecision}
          onRequestOnDefa={handleRequestOnDefa}
          segments={segments}
        />
      )}
    </>
  );
};

// Decision Modal Component
const DecisionModal = ({ decision, application, decisionData, setDecisionData, submitting, error, onClose, onConfirm, onRequestOnDefa, segments }) => {
  const isCroFacilityReview = application.workflowStep === 'CRO_FACILITY_REVIEW';
  const isCroFinalStep = application.workflowStep === 'CRO_FINAL_CONFIRMATION';
  const isCadFinalStep = application.workflowStep === 'CAD_FINAL_APPROVAL';
  const isCadFacilityReview = application.workflowStep === 'CAD_FACILITY_REVIEW';
  const isKamFacilityReview = application.workflowStep === 'KAM_FACILITY_REVIEW';
  const isFacilityOrFinalStep = isCroFacilityReview || isCadFacilityReview || isKamFacilityReview || isCadFinalStep || isCroFinalStep;

  const modalConfig = {
    'approve': {
      title: isCroFacilityReview ? 'Approve Facility Agreement' :
        isCroFinalStep ? 'Final Approve & Deploy' :
          isCadFinalStep ? 'Approve to CRO' :
            isCadFacilityReview ? 'Approve Facility' :
              'Approve Application',
      icon: <CheckCircle className="w-8 h-8 text-green-600" />,
      bgColor: 'bg-green-100',
      message: isCroFacilityReview ? 'Approve the legal facility agreement and forward to CAD for technical review.' :
        isCroFinalStep ? 'Final review and authorization to deploy the credit pool.' :
          isCadFinalStep ? 'Finalize technical parameters and forward for CRO authorization.' :
            'You are about to approve this credit line application. Upon approval, a dedicated CreditLine Pool smart contract will be deployed.',
      buttonText: isCroFacilityReview ? 'Approve to CAD' :
        isCroFinalStep ? 'Final Approve & Deploy' :
          isCadFinalStep ? 'Approve to CRO' :
            'Confirm Approval',
      buttonClass: 'bg-green-600 hover:bg-green-700',
    },
    'request-info': {
      title: 'Request Additional Information',
      icon: <Clock className="w-8 h-8 text-amber-600" />,
      bgColor: 'bg-amber-100',
      message: 'Request more information from the applicant. They will be notified via email.',
      buttonText: 'Send Request',
      buttonClass: 'bg-amber-600 hover:bg-amber-700',
    },
    reject: {
      title: 'Reject Application',
      icon: <XCircle className="w-8 h-8 text-red-600" />,
      bgColor: 'bg-red-100',
      message: 'You are about to reject this credit line application. This action cannot be undone.',
      buttonText: 'Confirm Rejection',
      buttonClass: 'bg-red-600 hover:bg-red-700',
    },
    'forward-to-cad': {
      title: 'Forward to CAD',
      icon: <ArrowUpRight className="w-8 h-8 text-blue-600" />,
      bgColor: 'bg-blue-100',
      message: 'Initial review complete. Forward this application to the Credit Analyst Department for scoring.',
      buttonText: 'Forward to CAD',
      buttonClass: 'bg-blue-600 hover:bg-blue-700',
    },
    'forward-to-cro': {
      title: 'Draft Approval & Forward',
      icon: <ArrowUpRight className="w-8 h-8 text-indigo-600" />,
      bgColor: 'bg-indigo-100',
      message: 'Prepare the draft approval parameters for Chief Risk Officer review.',
      buttonText: 'Confirm Draft & Forward',
      buttonClass: 'bg-indigo-600 hover:bg-indigo-700',
    },
    'return-to-kam': {
      title: 'Return to KAM',
      icon: <RotateCcw className="w-8 h-8 text-orange-600" />,
      bgColor: 'bg-orange-100',
      message: 'Return this application to the Key Account Manager for more info or corrections.',
      buttonText: 'Return to KAM',
      buttonClass: 'bg-orange-600 hover:bg-orange-700',
    },
    'forward-to-term-sheet': {
      title: 'Proceed to Term Sheet',
      icon: <FileText className="w-8 h-8 text-blue-600" />,
      bgColor: 'bg-blue-100',
      message: 'Approve the credit score and proceed to the Term Sheet negotiation stage.',
      buttonText: 'Confirm & Proceed',
      buttonClass: 'bg-blue-600 hover:bg-blue-700',
    },
    'share-term-sheet': {
      title: 'Share Term Sheet',
      icon: <Upload className="w-8 h-8 text-blue-600" />,
      bgColor: 'bg-blue-100',
      message: 'Upload and share the Term Sheet PDF with the applicant.',
      buttonText: 'Share with PSP',
      buttonClass: 'bg-blue-600 hover:bg-blue-700',
      isUpload: true,
    },
    'share-tech-agreement': {
      title: 'Share Tech Agreement',
      icon: <Upload className="w-8 h-8 text-indigo-600" />,
      bgColor: 'bg-indigo-100',
      message: 'Upload and share the Technical Integration Agreement PDF.',
      buttonText: 'Share with PSP',
      buttonClass: 'bg-indigo-600 hover:bg-indigo-700',
      isUpload: true,
    },
    'share-facility-agreement': {
      title: 'Share Facility Agreement',
      icon: <Upload className="w-8 h-8 text-purple-600" />,
      bgColor: 'bg-purple-100',
      message: 'Finalize the legal framework by sharing the Facility Agreement.',
      buttonText: 'Share with CAD',
      buttonClass: 'bg-purple-600 hover:bg-purple-700',
      isUpload: true,
    },
    'cro-approve-to-legal': {
      title: 'Approve & Move to Legal',
      icon: <CheckCircle className="w-8 h-8 text-green-600" />,
      bgColor: 'bg-green-100',
      message: 'Approve the application as Chief Risk Officer and move it to the Legal Review stage.',
      buttonText: 'Approve & Move',
      buttonClass: 'bg-green-600 hover:bg-green-700',
      isUpload: true,
    },
    'approve-cad-to-kam': {
      title: 'Approve & Move to KAM',
      icon: <CheckCircle className="w-8 h-8 text-blue-600" />,
      bgColor: 'bg-blue-100',
      message: 'Forward this application to the KAM for final facility review before sharing with the PSP.',
      buttonText: 'Approve & Move',
      buttonClass: 'bg-blue-600 hover:bg-blue-700',
    },
    'kam-approve-to-psp': {
      title: 'Approve & Move to PSP',
      icon: <CheckCircle className="w-8 h-8 text-indigo-600" />,
      bgColor: 'bg-indigo-100',
      message: 'Approve the facility agreement and share it with the PSP for their digital signature.',
      buttonText: 'Approve & Share',
      buttonClass: 'bg-indigo-600 hover:bg-indigo-700',
    },
  };

  const config = modalConfig[decision];

  return (
    <div className="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="modal-content max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="p-6 overflow-y-auto max-h-[90vh]">          <div className={`w-16 h-16 ${config?.bgColor} rounded-full flex items-center justify-center mx-auto mb-4`}>
          {config.icon}
        </div>

          <h2 className="text-xl font-bold text-center mb-2">{config.title}</h2>
          <p className="text-center text-gray-600 mb-2">{application.companyName}</p>
          <p className="text-center text-sm text-gray-500 mb-6">{config.message}</p>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          {(decision === 'approve' || decision === 'forward-to-cro' || decision === 'approve-cad-to-kam' || decision === 'kam-approve-to-psp') && !isCroFacilityReview && !isCadFacilityReview && !isKamFacilityReview && (
            <div className="space-y-4 mb-6">
              {/* Requested — CAD can override during forward-to-cro
                  (CAD_FINAL_APPROVAL stage). Other decision flows leave
                  these read-only since the PSP-supplied value is final. */}
              {(() => {
                const cadCanEdit = decision === 'forward-to-cro';
                return (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="input-label">
                        Requested Amount (USD) {cadCanEdit && <span className="text-xs text-brand-purple">(editable)</span>} *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={decisionData.requestedAmount}
                        onChange={(e) =>
                          setDecisionData({ ...decisionData, requestedAmount: e.target.value })
                        }
                        className="input-field"
                        disabled={!cadCanEdit}
                        required
                      />
                    </div>
                    <div>
                      <label className="input-label">
                        Requested Duration (Days) {cadCanEdit && <span className="text-xs text-brand-purple">(editable)</span>} *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={decisionData.requestedDuration}
                        onChange={(e) =>
                          setDecisionData({ ...decisionData, requestedDuration: e.target.value })
                        }
                        className="input-field"
                        disabled={!cadCanEdit}
                        required
                      />
                    </div>
                  </div>
                );
              })()}
              <hr />

              {/* to be approved */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Total Credit Line (USD) *</label>
                  <select
                    value={decisionData.creditLine}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, creditLine: e.target.value }))}
                    className="input-field"
                    required
                  >
                    <option value="">Select Amount Range</option>
                    <option value="100K to 1M">100K to 1M</option>
                    <option value="1M to 3M">1M to 3M</option>
                    <option value="3M to 5M">3M to 5M</option>
                    <option value="5M to 7M">5M to 7M</option>
                    <option value="7M to 10M">7M to 10M</option>
                  </select>
                </div>
                {/* <div>
                  <label className="input-label">Credit Reserve (USD) *</label>
                  <input
                    type="number"
                    value={decisionData.creditReserve}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, creditReserve: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div> */}
                <div>
                  <label className="input-label">Duration (Days) *</label>
                  <select
                    value={decisionData.approvedDuration}
                    onChange={(e) =>
                      setDecisionData((prev) => ({
                        ...prev,
                        approvedDuration: e.target.value,
                      }))
                    }
                    className="input-field"
                    required
                  >
                    <option value="">Select Duration</option>
                    <option value="2">2 Days</option>
                    <option value="7">7 Days</option>
                    <option value="10">10 Days</option>
                    <option value="15">15 Days</option>
                    <option value="30">30 Days</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Utilized Rate *</label>
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">bps</span>
                    <input
                      type="number"
                      value={decisionData.utilizedBips}
                      onChange={(e) => setDecisionData(prev => ({ ...prev, utilizedBips: e.target.value }))}
                      className="input-field pr-11"
                      required
                    />
                  </div>

                </div>
                <div>
                  <label className="input-label">Unutilized Rate *</label>
                  <div className='relative'>
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">bps</span>
                    <input
                      type="number"
                      value={decisionData.unutilizedBips}
                      onChange={(e) => setDecisionData(prev => ({ ...prev, unutilizedBips: e.target.value }))}
                      className="input-field pr-11"
                      required
                    />
                  </div>


                </div>
                <div>
                  <label className="input-label">Penalty Rate *</label>
                  <div className='relative'>
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">bps</span>

                    <input
                      type="number"
                      value={decisionData.penaltyBips}
                      onChange={(e) => setDecisionData(prev => ({ ...prev, penaltyBips: e.target.value }))}
                      className="input-field pr-11"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="input-label">Penalty Grace (Hours) *</label>
                  <input
                    type="number"
                    value={decisionData.penaltyGracePeriodHours}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, penaltyGracePeriodHours: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div>
                <div className="">
                  <label className="input-label">Pause After (Days) *</label>
                  <input
                    type="number"
                    value={decisionData.pauseAfterDays}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, pauseAfterDays: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <hr />
              <div className="grid grid-cols-2 gap-4">
                <div className="">
                  <label className="input-label">Drawdown Tenure (Days) *</label>
                  <input
                    type="number"
                    value={decisionData.drawdown_tenor}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, drawdown_tenor: e.target.value }))}
                    className="input-field"
                    placeholder="e.g. 2 Days"
                    required
                  />
                </div>
                <div className="">
                  <label className="input-label">Min Utilization (USD) *</label>
                  <input
                    type="number"
                    value={decisionData.minUtilizationRate}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, minUtilizationRate: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div>
                {/* <div>
                  <label className="input-label">APY *</label>
                  <input
                    type="number"
                    value={decisionData.requested_Apy}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, requested_Apy: e.target.value }))}
                    className="input-field"
                    placeholder="e.g. 12%"
                    required
                  />
                </div> */}
                <div className="col-span-2">
                  <label className="input-label">PSP Identifier *</label>
                  <input
                    type="text"
                    value={decisionData.psp_identifie}
                    onChange={(e) => setDecisionData(prev => ({ ...prev, psp_identifie: e.target.value }))}
                    className="input-field"
                    placeholder="e.g. PSP-001"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mb-6">
            <label className="input-label">Notes {decision !== 'approve' && decision !== 'forward-to-cro' && '*'}</label>
            <textarea
              value={decisionData.notes}
              onChange={(e) => setDecisionData(prev => ({ ...prev, notes: e.target.value }))}
              className="input-field min-h-[100px]"
              placeholder={decision === 'request-info' ? "Specify what information is needed..." : "Add internal notes..."}
              required={decision !== 'approve' && decision !== 'forward-to-cro'}
            />
          </div>

          {decision === 'share-tech-agreement' && (
            <div className="mb-6">
              <label className="input-label flex items-center gap-2">
                <Package className="w-4 h-4 text-brand-purple" />
                Select PSP Segment *
              </label>
              <select
                value={decisionData.segmentId || ""}
                onChange={(e) => setDecisionData(prev => ({ ...prev, segmentId: e.target.value }))}
                className="input-field mt-1"
                required
              >
                <option value="">Select Segment</option>
                {(segments || []).map(seg => (
                  <option key={seg._id} value={seg._id}>{seg.name} ({seg.key})</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-500 mt-1">This segment determines the operational flow and features available to the PSP.</p>
            </div>
          )}

          {(decision === 'approve' || decision === 'forward-to-cro' || config.isUpload) && (
            <div className="mb-6">
              <label className="input-label flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-purple" />
                {config.isUpload ? 'Upload Document (PDF)' : 'Credit Review Report / Contract (PDF)'}
              </label>
              <div className="mt-1 flex items-center gap-4">
                <label className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 p-3 border-2 border-dashed border-gray-200 rounded-lg hover:border-brand-purple hover:bg-gray-50 transition-all">
                    <Upload className="w-5 h-5 text-gray-400" />
                    <span className="text-sm text-gray-500">
                      {decisionData.reportFile ? decisionData.reportFile.name : 'Select Document (PDF)'}
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            toast.error('File size exceeds 5MB limit');
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            setDecisionData(prev => ({
                              ...prev,
                              agreementUrl: event.target.result, // Simulating URL for now, backend will handle actual storage if needed or just use base64
                              reportFile: {
                                name: file.name,
                                fileType: file.type,
                                fileSize: file.size,
                                fileContent: event.target.result
                              }
                            }));
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </div>
                </label>
                {decisionData.reportFile && (
                  <button
                    onClick={() => setDecisionData(prev => ({ ...prev, reportFile: null }))}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="sticky bottom-0 bg-white pt-4 flex flex-col gap-3">
            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={submitting || 
                  ((decision === 'approve' || decision === 'forward-to-cro') && !decisionData.creditLine) || 
                  (decision === 'share-tech-agreement' && !decisionData.segmentId) ||
                  (decision !== 'approve' && decision !== 'forward-to-cro' && !decisionData.notes)}
                className={`${config.buttonClass} text-white px-6 py-3 rounded-lg font-semibold transition-all flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  config.buttonText
                )}
              </button>
            </div>
            {decision === 'approve' && (
              <button
                onClick={onRequestOnDefa}
                disabled={submitting || !decisionData.drawdown_tenor || !decisionData.psp_identifie}
                className="w-full bg-purple-800 hover:bg-purple-900 text-white px-6 py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed border-t"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Requesting...
                  </>
                ) : (
                  'Request on Defa'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const CreditScoringTab = ({ application, onUpdate, isEditable }) => {
  console.log("🚀 ~ CreditScoringTab ~ application:", application)
  const [saving, setSaving] = useState(false);
  const [scores, setScores] = useState({});

  const [scanning, setScanning] = useState(false);
  const [downloadingAiReport, setDownloadingAiReport] = useState(false);
  const [scanDocuments, setScanDocuments] = useState([]);
  const [scanStartAt, setScanStartAt] = useState(null);
  const [scanReport, setScanReport] = useState(null);

  const currentScanReport = scanReport || application?.aiScanReport;

  useEffect(() => {
    if (application?.creditScoring?.criteriaScores) {
      setScores(application.creditScoring.criteriaScores);
    }
  }, [application?.creditScoring?.totalScore]);

  // Request browser notification permission on component mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Poll notifications while scan is active, but only complete when a matching scan completion notification arrives.
  useEffect(() => {
    let notificationPoll;

    if (scanning && application?._id && scanStartAt) {
      notificationPoll = setInterval(async () => {
        try {
          const response = await notificationAPI.getNotifications();
          const notifications = response.data || [];
          const lowerCompany = (application.companyName || '').toLowerCase();

          const scanNotification = notifications.find((notification) => {
            const title = notification.title?.toLowerCase() || '';
            const message = notification.message?.toLowerCase() || '';
            const isComplete = title.includes('ai scan completed') || message.includes('ai scan completed');
            const isFailed = title.includes('ai scan failed') || message.includes('ai scan failed');
            if (!isComplete && !isFailed) return false;

            if (lowerCompany && !message.includes(lowerCompany) && !title.includes(lowerCompany)) {
              return false;
            }

            if (!notification.createdAt) return true;
            const createdAt = new Date(notification.createdAt).getTime();
            return createdAt >= scanStartAt;
          });

          if (scanNotification) {
            clearInterval(notificationPoll);
            setScanning(false);

            try {
              const appResponse = await adminAPI.getApplication(application._id);
              const updatedApp = appResponse.data;
              setScanReport(updatedApp.aiScanReport || null);
            } catch (appError) {
              console.error('Failed to refresh AI scan report after notification:', appError);
            }

            if (scanNotification.type === 'success') {
              // Show prominent success notification
              toast.success('🎉 AI Scan Complete! Your credit report is ready to download.', {
                duration: 8000,
                style: {
                  background: '#10B981',
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  padding: '16px'
                },
                icon: '✅'
              });

              // Try to show browser notification if permission granted
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('AI Scan Complete', {
                  body: `Credit report for ${application.companyName} is ready to download.`,
                  icon: '/favicon.ico',
                  tag: 'ai-scan-complete'
                });
              }
            } else {
              // Show prominent error notification
              toast.error('❌ AI Scan Failed. Please try again or contact support.', {
                duration: 8000,
                style: {
                  background: '#EF4444',
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  padding: '16px'
                },
                icon: '⚠️'
              });

              // Try to show browser notification if permission granted
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('AI Scan Failed', {
                  body: `Credit scan for ${application.companyName} failed. Please try again.`,
                  icon: '/favicon.ico',
                  tag: 'ai-scan-failed'
                });
              }
            }
          }
        } catch (error) {
          console.error('Error polling notifications for scan completion:', error);
        }
      }, 10000);
    }

    return () => {
      if (notificationPoll) {
        clearInterval(notificationPoll);
      }
    };
  }, [scanning, application?._id, application?.companyName, scanStartAt]);

  const handleAIScan = async () => {
    try {
      setScanning(true);
      setScanReport(null);

      // Show initial notification
      toast('Document is scanning, you will be notified once done.', { duration: 5000 });

      // Call backend API which handles background processing
      const response = await adminAPI.startAIScan(application._id);

      if (response?.data?.aiScanReport) {
        setScanReport(response.data.aiScanReport);
      }
      if (response?.data?.aiScanReport?.startedAt) {
        setScanStartAt(new Date(response.data.aiScanReport.startedAt).getTime());
      } else {
        setScanStartAt(Date.now());
      }

      // The backend will handle the background processing and send notifications
      // Polling will handle completion detection and UI updates

    } catch (err) {
      console.error('AI Scan Error:', err);
      toast.error('Failed to start AI Scan: ' + (err.response?.data?.message || err.message));
      setScanning(false);
    }
  };

  const handleDownloadAiReport = async () => {
    const outputFileUrl = currentScanReport?.outputFile;

    if (!outputFileUrl) {
      toast.error('No AI report is available to download.');
      return;
    }

    try {
      setDownloadingAiReport(true);
      window.open(outputFileUrl, '_blank');
    } catch (err) {
      toast.error('Failed to download AI report: ' + (err.response?.data?.message || err.message));
    } finally {
      setDownloadingAiReport(false);
    }
  };

  const criteria = [
    {
      id: 1,
      name: 'Incorporation Type & Regulatory Standing',
      maxScore: 5,
      subCriteria: [
        'Licensed Money Exchange / Remittance Company (Central Bank licensed) (5)',
        'Licensed FinTech / PSP with remittance approval (4)',
        'Unlicensed but operating under agent model (2)',
        'No formal license / unregulated (0)'
      ]
    },
    {
      id: 2,
      name: 'Business Age & Track Record',
      maxScore: 5,
      subCriteria: [
        '5 Years > (5)',
        '3 to 5 Years (4)',
        '1 to 3 Years (2)',
        '< 1 Year (0)'
      ]
    },
    {
      id: 3,
      name: 'Transaction Volume & Velocity',
      maxScore: 10,
      subCriteria: [
        'Monthly transactions > AED 50M (10)',
        'AED 20M – 50M monthly (7)',
        'AED 5M – 20M monthly (4)',
        '< AED 5M monthly (1)'
      ]
    },
    {
      id: 4,
      name: 'Settlement Partner Quality',
      maxScore: 10,
      subCriteria: [
        'Tier 1: Licensed bank or top-5 exchange house (10)',
        'Tier 2: Mid-tier licensed exchange (7)',
        'Tier 3: Regional licensed player (4)',
        'Tier 4: Unlicensed / Small individual aggregator (0)'
      ]
    },
    {
      id: 5,
      name: 'Corridor & Remittance Risk',
      maxScore: 8,
      subCriteria: [
        'Low-risk (GCC, US, EU, UK, SG, AU) (8)',
        'Mixed portfolio (Medium-risk corridors) (6)',
        'High-risk / Emerging markets focus (3)',
        'Sanctioned / Gray list corridors (0)'
      ]
    },
    {
      id: 6,
      name: 'Prefunding Cycle & Liquidity Management',
      maxScore: 8,
      subCriteria: [
        'Settlement within < 24 hrs (8)',
        '24 to 48 hrs (6)',
        '48 to 72 hrs (3)',
        'Poor liquidity controls / No fixed cycle (0)'
      ]
    },
    {
      id: 7,
      name: 'Historical Transaction Data & Audit Trail',
      maxScore: 8,
      subCriteria: [
        '3+ Years audited / verified data (8)',
        '1 to 3 Years partially audited (5)',
        '< 1 Year or unaudited internal logs (2)',
        'No historical transaction logs (0)'
      ]
    },
    {
      id: 8,
      name: 'Bank Statement & Float Management',
      maxScore: 7,
      subCriteria: [
        'Excellent - Consistent float & no defaults (7)',
        'Good - Minor gaps in float (5)',
        'Average - High utilization (2)',
        'Poor - Frequent overdrafts / returns (0)'
      ]
    },
    {
      id: 9,
      name: 'Financial Statement Analysis',
      maxScore: 10,
      subCriteria: [
        'Excellent (High revenue + Healthy margins) (10)',
        'Good (Growth trend + Managed debt) (7)',
        'Average (Stable revenue + Thin margins) (4)',
        'Poor (Declining revenue / Heavy losses) (0)'
      ]
    },
    {
      id: 10,
      name: 'AML / Compliance & Regulatory Health',
      maxScore: 8,
      subCriteria: [
        'Robust framework (Audited annually) (8)',
        'Adequate internal controls (5)',
        'Weak / Manual monitoring (2)',
        'Sanctions/Legal flags (0)'
      ]
    },
    {
      id: 11,
      name: 'Technology & Integration Readiness',
      maxScore: 5,
      subCriteria: [
        'Real-time API integration (5)',
        'Semi-automated dashboard (3)',
        'Manual reporting / Excel (1)',
        'None (0)'
      ]
    },
    {
      id: 12,
      name: 'Guarantors / Collateral / Security',
      maxScore: 5,
      subCriteria: [
        'Strong corporate/bank guarantee (5)',
        'Personal guarantee + PDC (3)',
        'Partial collateral (1)',
        'None (0)'
      ]
    },
    {
      id: 13,
      name: 'Previous Financing Payback Trend',
      maxScore: 7,
      subCriteria: [
        'Excellent - Always on time (7)',
        'Good - Minor delays (< 3 days) (5)',
        'Average - Consistent late payments (2)',
        'Poor - Previous defaults (0)'
      ]
    },
    {
      id: 14,
      name: 'Credit Bureau / Banking Reference',
      maxScore: 4,
      subCriteria: [
        'Excellent Reference (4)',
        'Good Reference (3)',
        'Average / New relationship (1)',
        'Poor / Rejected by banks (0)'
      ]
    },
  ];

  const totalScore = criteria.reduce((sum, c) => sum + (Number(scores[c.id]) || 0), 0);

  const getRating = (score) => {
    if (score >= 85) return { label: 'AAA', desc: 'Excellent | Immediate Approval', color: 'text-green-600' };
    if (score >= 70) return { label: 'AA', desc: 'Good | Approval with Standard Terms', color: 'text-blue-600' };
    if (score >= 55) return { label: 'A', desc: 'Satisfactory | Approval with Enhanced Monitoring', color: 'text-yellow-600' };
    if (score >= 40) return { label: 'B', desc: 'Moderate Risk | Conditional Approval / Reduced Limit', color: 'text-orange-600' };
    return { label: 'C', desc: 'High Risk | Decline or Extensive Collateral Required', color: 'text-red-600' };
  };

  const currentRating = getRating(totalScore);

  const handleScoreChange = (id, value, max) => {
    if (!isEditable) return;
    const val = Math.min(max, Math.max(0, Number(value) || 0));
    setScores(prev => ({ ...prev, [id]: val }));
  };

  const handleSave = async () => {
    if (!isEditable) return;
    try {
      setSaving(true);
      await adminAPI.saveCreditScore(application._id, {
        criteriaScores: scores,
        totalScore,
        percentage: totalScore,
        rating: currentRating.label
      });
      toast.success('Credit score saved successfully!');
      onUpdate();
    } catch (err) {
      toast.error('Failed to save credit score: ' + (err.response?.data?.message || err.message));
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 border-b">#</th>
                <th className="px-4 py-3 border-b">Criteria</th>
                <th className="px-4 py-3 border-b">Max Score</th>
                <th className="px-4 py-3 border-b">Sub-Criteria / Rating Scale</th>
                <th className="px-4 py-3 border-b text-center">Achieved Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {criteria.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-400">{c.id}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-gray-900 w-48">{c.name}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{c.maxScore}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-600 font-medium">
                    <ul className="list-disc list-inside space-y-0.5">
                      {c.subCriteria.map((item, index) => (
                        <li key={index} className="leading-relaxed">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      min="0"
                      max={c.maxScore}
                      disabled={!isEditable}
                      value={scores[c.id] || ''}
                      onChange={(e) => handleScoreChange(c.id, e.target.value, c.maxScore)}
                      className="w-20 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-sm font-bold focus:ring-2 focus:ring-brand-purple outline-none text-center mx-auto disabled:opacity-70 disabled:cursor-not-allowed"
                      placeholder="0"
                    />
                  </td>
                </tr>
              ))}
              <tr className="bg-brand-purple/5 font-bold">
                <td colSpan="2" className="px-4 py-4 text-brand-purple text-xs">TOTAL CREDIT SCORE</td>
                <td className="px-4 py-4 text-brand-purple text-xs">100</td>
                <td className="px-4 py-4 border-none"></td>
                <td className="px-4 py-4 text-brand-purple text-base text-center bg-brand-purple/10 border-t-2 border-brand-purple">{totalScore}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card bg-brand-gradient text-white flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-semibold mb-2">Final Evaluation</h3>
            <div className="flex items-end gap-3 mb-4">
              <span className="text-4xl font-bold">{totalScore}%</span>
              <span className="text-xl mb-1 opacity-90">Score Matrix</span>
            </div>
          </div>
          <div className="p-4 bg-white/10 rounded-lg backdrop-blur-sm border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">Rating: {currentRating.label}</div>
                <p className="text-xs opacity-80 mt-1">{currentRating.desc}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center font-bold text-xl">
                {currentRating.label[0]}
              </div>
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4 text-brand-purple" />
            Rating Legend
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {[
              { range: '85 – 100', rank: 'AAA', desc: 'Immediate Approval', bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-700' },
              { range: '70 – 84', rank: 'AA', desc: 'Standard Terms', bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-700' },
              { range: '55 – 69', rank: 'A', desc: 'Enhanced Monitoring', bg: 'bg-yellow-50', border: 'border-yellow-100', text: 'text-yellow-700' },
              { range: '40 – 54', rank: 'B', desc: 'Conditional / Reduced', bg: 'bg-orange-50', border: 'border-orange-100', text: 'text-orange-700' },
              { range: '< 40', rank: 'C', desc: 'Decline / Collateral', bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-700' },
            ].map((item, i) => (
              <div key={i} className={`flex items-center justify-between p-2 ${item.bg} rounded border ${item.border} text-[10px]`}>
                <span className={`font-bold ${item.text} w-20`}>{item.range} ({item.rank})</span>
                <span className="text-gray-600 font-medium">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isEditable && (
        <div className="flex justify-end gap-4 mt-6">
          <button
            onClick={handleAIScan}
            disabled={scanning || saving}
            type="button"
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold flex items-center gap-2 hover:bg-indigo-700 transition-all disabled:opacity-50"
          >
            {scanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
            AI Scan
          </button>
          {currentScanReport?.outputFile && (
            <button
              onClick={handleDownloadAiReport}
              disabled={downloadingAiReport || scanning}
              type="button"
              className="px-6 py-3 border border-indigo-200 text-indigo-700 bg-white rounded-lg font-semibold flex items-center gap-2 hover:bg-indigo-50 transition-all disabled:opacity-50"
            >
              {downloadingAiReport ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              Download AI Report
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-brand px-10 py-3 flex items-center gap-2 shadow-lg shadow-brand-purple/20 transition-transform hover:scale-[1.02]"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
            {application.creditScoring?.updatedAt ? 'Update Credit Score' : 'Save Final Credit Score'}
          </button>
        </div>
      )}
    </div>
  );
};

const AuditLogTab = ({ logs, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-brand-purple" />
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl card italic text-gray-500">
        No activities logged yet for this application.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden mb-5">
      <h2 className="text-lg font-semibold mb-6 px-4 pt-2 flex items-center gap-2">
        <Clock className="w-5 h-5 text-brand-purple" />
        Activity History
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              <th className="px-6 py-3 border-b">Timestamp</th>
              <th className="px-6 py-3 border-b">User</th>
              <th className="px-6 py-3 border-b">Role</th>
              <th className="px-6 py-3 border-b">Action</th>
              <th className="px-6 py-3 border-b">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map((log) => (
              <tr key={log._id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4 text-xs text-gray-600">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td className="px-6 py-4 text-xs font-semibold text-gray-900">
                  {log.userId?.name || 'Unknown'}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${log.userId?.role === 'CRO' ? 'bg-purple-100 text-purple-700' :
                    log.userId?.role === 'CAD' ? 'bg-blue-100 text-blue-700' :
                      log.userId?.role === 'KAM' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-700'
                    }`}>
                    {log.userId?.role || 'System'}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs font-medium">
                  {log.action.replace(/_/g, ' ')}
                </td>
                <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate">
                  {log.details?.notes || (log.details?.totalScore ? `Score: ${log.details.totalScore}` : '-')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ApplicationReview;
