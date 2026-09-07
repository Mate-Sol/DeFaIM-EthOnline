import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  CreditCard,
  TrendingUp,
  Wallet,
  FileText,
  LogOut,
  UserPlus,
  Save,
  Loader2,
  AlertCircle,
  ArrowRight,
  CheckCircle,
  InfoIcon,
  Building,
  Package,
  ShieldCheck,
  ClipboardList,
  DollarSign,
} from "lucide-react";
import Sidebar from "../../components/Sidebar";
import CompanyInfo from "./onboarding/CompanyInfo";
import BusinessOperations from "./onboarding/BusinessOperations";
import FinancialInfo from "./onboarding/FinancialInfo";
import RiskLegalInfo from "./onboarding/RiskLegalInfo";
import FinancingLimitTab from "./onboarding/FinancingLimit";
import { pspAPI } from "../../services/api";
import ApplyFinancingLimit from "./ApplyFinancingLimit";
import FormNavigation from "./onboarding/FormNavigation";

const Onboarding = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isSavingRef = useRef(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);

  const steps = [
    {
      id: "profile",
      label: "COMPANY PROFILE",
      icon: Building,
      color: "text-blue-500",
    },
    {
      id: "business",
      label: "BUSINESS OPERATIONS",
      icon: Package,
      color: "text-purple-500",
    },
    {
      id: "financials",
      label: "FINANCIAL DETAILS",
      icon: TrendingUp,
      color: "text-green-500",
    },
    {
      id: "kyc",
      label: "KYC & COMPLIANCE",
      icon: ShieldCheck,
      color: "text-red-500",
    },
    {
      id: "financing",
      label: "FUNDING REQUEST",
      icon: DollarSign,
      color: "text-amber-500",
    },
    {
      id: "credit-facility",
      label: "LIQUIDITY FACILITY",
      icon: DollarSign,
      color: "text-amber-500",
    },
  ];

  const [formData, setFormData] = useState({
    // Company Info
    companyName: "",
    registrationNo: "",
    country: "",
    jurisdiction: "",
    yearEstablished: "",
    contactName: "",
    contactPosition: "",
    contactEmail: "",
    contactPhone: "",
    uboName: "",
    uboOwnership: "",
    isPEP: false,

    // Business Operations
    sector: "",
    transactionVolume: "",
    products: [""],
    customers: [""],
    suppliers: [""],

    // Financial Info
    annualRevenue: "",
    projectedRevenue: "",
    profitMargin: "",
    monthlyCashFlow: "",
    primaryBank: "",
    bankAccountNo: "",
    swiftCode: "",
    hasDefaultHistory: false,
    defaultDetails: "",
    currentAllocation: "",
    rolledOutCreditLines: "",
    walletAddress: "",

    // Documents (for upload)
    documents: {},
    // Existing documents (metadata)
    docData: {},
    secondaryCompanies: [],
    isAgreedToNDA: false,

    // Credit Limit Request Fields
    requestedAmount: "",
    duration: "60",
    fundingCounterparties: "",
    remittanceCorridors: "",
    desiredCurrencyType: "",
    desiredCurrencyValue: "",
    desiredBCNetwork: "",
    drawdown_tenor: "",
    purpose: "",

    // New Fields
    businessModels: [""],
    monthlyTransactionVolumes: [],
    numberOfTransactions: [],
    top3Corridors: [
      { fromCountry: "", toCountry: "", volume: "", count: "" },
      { fromCountry: "", toCountry: "", volume: "", count: "" },
      { fromCountry: "", toCountry: "", volume: "", count: "" }
    ],
  });

  // Helper to generate last 6 months
  const generateLast6Months = () => {
    const months = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthYear = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      months.push(monthYear);
    }
    return months;
  };

  useEffect(() => {
    const months = generateLast6Months();
    setFormData(prev => ({
      ...prev,
      monthlyTransactionVolumes: months.map(m => ({ month: m, volume: "" })),
      numberOfTransactions: months.map(m => ({ month: m, count: "" })),
    }));
  }, []);

  const mapDocumentsToState = (documents, secondaryCompanies) => {
    const docData = {
      secondaryDocuments: {},
    };

    if (!documents) return docData;

    const keyMap = {
      tradeLicense: "Trade license / commercial registration",
      corporateStructuringDocuments: "Corporate structuring documents",
      ubosSourceOfFunds: "UBOs source of funds",
      creditReportEcib: "Existing credit report",
      moaAoa: "MOA / AOA",
      uboPassports: "Passport/ID card of all UBOs",
      uboPassportsAlt: "Passport/ID card of all ubos",
      vatCert: "VAT certificate & filing",
      regulatoryLicense: "Regulatory license",
      settlementReports: "Daily settlement volume reports (last 6 months)",
      ageingAnalysis: "Ageing analysis of payables/receivables",
      bankStatements: "Latest 6 months bank statements",
      auditedFinancials: "Audited financial statements (last 2 years)",
      managementAccounts: "Management accounts (YTD)",
      cashFlowStatements: "Cash flow statements (last 6 months)",
      debtAgreements: "Existing debt/facility agreements",
      liensPledges: "Existing liens or pledges on receivables",
      flowOfFunds: "Flow of funds",
      organogram: "Organogram (Attach a picture of your holding and subsidiary companies)",
      organogramShort: "Organogram",
      organogramLegacy: "organogram"
    };

    documents.forEach((doc) => {
      const normalizedType = (doc.documentType || "")
        .replace(/\s*\*$/, "")
        .replace(" (if applicable)", "");
      
      let frontendKey = Object.keys(keyMap).find(
        (key) => keyMap[key].toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedType.toLowerCase().replace(/[^a-z0-9]/g, ''),
      );

      // Standardize organogram and passport keys
      if (frontendKey && frontendKey.startsWith('organogram')) {
        frontendKey = 'organogram';
      }
      if (frontendKey && frontendKey.startsWith('uboPassports')) {
        frontendKey = 'uboPassports';
      }

      // Fuzzy match for specific KYC documents to handle labeling variations
      const lowerType = normalizedType.toLowerCase();
      if (lowerType.includes('flow of funds')) frontendKey = 'flowOfFunds';
      if (lowerType.includes('corporate structuring')) frontendKey = 'corporateStructuringDocuments';
      if (lowerType.includes('ubos source of funds') || lowerType.includes('ubo source of funds')) frontendKey = 'ubosSourceOfFunds';

      if (frontendKey) {
        if (doc.secondaryCompanyId) {
          if (!docData.secondaryDocuments[doc.secondaryCompanyId]) {
            docData.secondaryDocuments[doc.secondaryCompanyId] = {};
          }
          if (!docData.secondaryDocuments[doc.secondaryCompanyId][frontendKey]) {
            docData.secondaryDocuments[doc.secondaryCompanyId][frontendKey] = [];
          }
          docData.secondaryDocuments[doc.secondaryCompanyId][frontendKey].push(doc);
        } else {
          if (!docData[frontendKey]) docData[frontendKey] = [];
          docData[frontendKey].push(doc);
        }
      }
    });

    return docData;
  };

  const fetchProfileData = async () => {
    try {
      setLoading(true);
      const response = await pspAPI.getProfile();
      const data = response.data;
      setProfile(data);

      const docData = mapDocumentsToState(data.documents, data.secondaryCompanies);
      console.log("🚀 ~ fetchProfileData ~ docData:", docData);


      setFormData({
        companyName: (data.companyName || "").replace(" (Pending Setup)", ""),
        registrationNo: data.registrationNo || "",
        country: data.country || "",
        jurisdiction: data.jurisdiction || data.country || "",
        yearEstablished: data.yearEstablished?.toString() || "",
        contactName: data.keyContact?.name || "",
        contactPosition: data.keyContact?.position || "",
        contactEmail: data.keyContact?.email || "",
        contactPhone: data.keyContact?.phone || "",
        uboName: data.uboDetails?.split(" - ")[0] || "",
        uboOwnership: data.uboDetails?.match(/\d+/)?.[0] || "",
        isPEP: data.pepExposure || false,
        sector: data.sector || "",
        transactionVolume: data.transactionVolume || "",
        products: data.keyProducts?.length > 0 ? data.keyProducts : [""],
        customers: data.topCustomers?.length > 0 ? data.topCustomers : [""],
        suppliers: data.topSuppliers?.length > 0 ? data.topSuppliers : [""],
        annualRevenue: data.annualRevenue?.toString() || "",
        projectedRevenue: data.projectedRevenue?.toString() || "",
        profitMargin: data.profitMargin?.toString() || "",
        monthlyCashFlow: data.monthlyCashFlow?.toString() || "",
        primaryBank: data.primaryBank || "",
        bankAccountNo: "",
        swiftCode: "",
        hasDefaultHistory:
          !!data.defaultHistory && data.defaultHistory !== "No default history",
        defaultDetails:
          data.defaultHistory === "No default history"
            ? ""
            : data.defaultHistory || "",
        currentAllocation: data.currentAllocation?.toString() || "",
        rolledOutCreditLines: data.rolledOutCreditLines?.toString() || "",
        walletAddress: data.walletAddress || "",
        documents: {}, // Only stores NEW files to be uploaded
        docData: docData, // Stores EXISTING files fetched from server
        secondaryCompanies: data.secondaryCompanies || [],
        isAgreedToNDA: data.isAgreedToNDA || false,
        requestedAmount: data.requestedAmount?.toString() || "",
        duration: (data.requestedDuration || 60).toString(),
        fundingCounterparties: data.fundingCounterparties || "",
        remittanceCorridors: data.remittanceCorridors || "",
        desiredCurrencyType: data.desiredCurrencyType || "",
        desiredCurrencyValue: data.desiredCurrencyValue || "",
        desiredBCNetwork: data.desiredBCNetwork || "",
        drawdown_tenor: data.drawdown_tenor || "",
        purpose: data.purpose || "",

        // New Fields
        businessModels: data.businessModels?.length > 0 ? data.businessModels : [""],
        monthlyTransactionVolumes: data.monthlyTransactionVolumes?.length > 0 
          ? data.monthlyTransactionVolumes 
          : generateLast6Months().map(m => ({ month: m, volume: "" })),
        numberOfTransactions: data.numberOfTransactions?.length > 0 
          ? data.numberOfTransactions 
          : generateLast6Months().map(m => ({ month: m, count: "" })),
        top3Corridors: (data.top3Corridors?.length === 3 
          ? data.top3Corridors 
          : (data.remittanceCorridors ? data.remittanceCorridors.split(", ").slice(0, 3).map(p => {
              const [from, to] = p.split(" to ");
              return { fromCountry: from || "", toCountry: to || "", volume: "", count: "" };
            }) : [])).concat(Array(3).fill({ fromCountry: "", toCountry: "", volume: "", count: "" })).slice(0, 3),
      });

      if (data.creditLineStatus === "Approved" || data.requestedAmount > 0) {
        setCurrentStep(5);
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
      setError("Failed to load profile data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfileData();
  }, []);

  const updateFormData = (stepData) => {
    setFormData((prev) => {
      const updated = { ...prev, ...stepData };
      // Deep merge documents to prevent overwriting previous uploads
      if (stepData.documents) {
        updated.documents = { ...prev.documents, ...stepData.documents };
      }
      return updated;
    });
  };

  const deleteExistingDocument = async (docId, frontendKey) => {
    // Restrict deletion if profile is Approved, UnderReview, or Pending
    const status = profile?.creditLineStatus;
    if (
      status === "Approved" ||
      status === "UnderReview" ||
      status === "Pending"
    ) {
      setError(`Cannot delete documents while profile is ${status}`);
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (!window.confirm("Are you sure you want to delete this document?"))
      return;

    try {
      await pspAPI.deleteDocument(docId);
      // Refresh full profile data to ensure UI sync
      await fetchProfileData();

      // Success feedback
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to delete document:", err);
      setError(err.response?.data?.message || "Failed to delete document");
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleSave = async (isAuto = false) => {
    // Prevent double saves/uploads using a synchronous ref lock
    if (isSavingRef.current) return false;
    isSavingRef.current = true;

    if (isAuto) setIsAutoSaving(true);
    else setIsSaving(true);

    setError(null);
    try {
      // Validation: Require NDA agreement for step 3 (KYC & Contracts)
      if (currentStep === 3 && !formData.isAgreedToNDA && !isAuto) {
        setError(
          "Please read and agree to the Non-Disclosure Agreement (NDA) before proceeding.",
        );
        setIsSaving(false);
        return false;
      }

      // 1. Upload any new documents first (Main Company)
      const docKeys = Object.keys(formData.documents);
      if (docKeys.length > 0) {
        for (const key of docKeys) {
          const filesArray = formData.documents[key];
          if (Array.isArray(filesArray) && filesArray.length > 0) {
            for (const doc of filesArray) {
              if (
                doc.fileContent &&
                doc.name &&
                doc.documentType &&
                doc.category
              ) {
                await pspAPI.uploadDocument(doc);
              }
            }
          } else if (filesArray && !Array.isArray(filesArray)) {
            await pspAPI.uploadDocument(filesArray);
          }
        }
      }

      // 2. Prepare payload for Profile update (cleansing secondary companies)
      const cleanedSecondaryCompanies = (formData.secondaryCompanies || []).map(
        (company) => {
          const c = { ...company };
          delete c.documents; // Not part of profile schema
          // If _id is a temporary frontend ID, remove it so Mongoose generates a real one
          if (c._id && c._id.toString().startsWith("temp_")) {
            delete c._id;
          }
          return c;
        },
      );

      const payload = {
        companyName: formData.companyName,
        registrationNo: formData.registrationNo,
        country: formData.country,
        jurisdiction: formData.jurisdiction,
        yearEstablished: parseInt(formData.yearEstablished),
        keyContact: {
          name: formData.contactName,
          position: formData.contactPosition,
          email: formData.contactEmail,
          phone: formData.contactPhone,
        },
        uboDetails: `${formData.uboName} - ${formData.uboOwnership}% ownership`,
        pepExposure: formData.isPEP,
        sector: formData.sector,
        transactionVolume: formData.transactionVolume,
        keyProducts: formData.products.filter((p) => p.trim() !== ""),
        topCustomers: formData.customers.filter((c) => c.trim() !== ""),
        topSuppliers: formData.suppliers.filter((s) => s.trim() !== ""),
        annualRevenue: parseFloat(formData.annualRevenue),
        projectedRevenue: parseFloat(formData.projectedRevenue),
        profitMargin: parseFloat(formData.profitMargin),
        monthlyCashFlow: parseFloat(formData.monthlyCashFlow),
        primaryBank: formData.primaryBank || "-",
        currentAllocation: parseFloat(formData.currentAllocation) || 0,
        walletAddress: formData.walletAddress,
        rolledOutCreditLines: parseFloat(formData.rolledOutCreditLines) || 0,
        defaultHistory: formData.hasDefaultHistory
          ? formData.defaultDetails
          : "No default history",
        secondaryCompanies: cleanedSecondaryCompanies,
        isAgreedToNDA: formData.isAgreedToNDA,

        // Credit Limit Request Fields
        requestedAmount: parseFloat(formData.requestedAmount) || 0,
        requestedDuration: parseInt(formData.duration) || 60,
        fundingCounterparties: formData.fundingCounterparties,
        remittanceCorridors: formData.remittanceCorridors,
        desiredCurrencyType: formData.desiredCurrencyType,
        desiredCurrencyValue: formData.desiredCurrencyValue,
        desiredBCNetwork: formData.desiredBCNetwork,
        drawdown_tenor: formData.drawdown_tenor,
        purpose: formData.purpose,

        // New Fields
        businessModels: formData.businessModels.filter(m => m.trim() !== ""),
        monthlyTransactionVolumes: formData.monthlyTransactionVolumes.map(v => ({
          month: v.month,
          volume: parseFloat(v.volume) || 0
        })),
        numberOfTransactions: formData.numberOfTransactions.map(v => ({
          month: v.month,
          count: parseInt(v.count) || 0
        })),
        top3Corridors: formData.top3Corridors.map(c => ({
          fromCountry: c.fromCountry,
          toCountry: c.toCountry,
          volume: parseFloat(c.volume) || 0,
          count: parseInt(c.count) || 0
        })),
      };

      // 3. Update Profile data FIRST to ensure secondary companies have real IDs
      const updateResponse = await pspAPI.updateProfile(payload);
      const updatedProfile = updateResponse.data;

      // 4. Upload any new documents for Secondary Companies using real IDs
      if (
        formData.secondaryCompanies &&
        formData.secondaryCompanies.length > 0
      ) {
        for (let i = 0; i < formData.secondaryCompanies.length; i++) {
          const originalCompany = formData.secondaryCompanies[i];
          // Match by index as backend preserves order
          const updatedCompany = updatedProfile.secondaryCompanies[i];

          if (originalCompany.documents && updatedCompany?._id) {
            const secDocKeys = Object.keys(originalCompany.documents);
            for (const key of secDocKeys) {
              const filesArray = originalCompany.documents[key];
              if (Array.isArray(filesArray) && filesArray.length > 0) {
                for (const doc of filesArray) {
                  if (
                    doc.fileContent &&
                    doc.name &&
                    doc.documentType &&
                    doc.category
                  ) {
                    // Inject the REAL ID from the saved profile
                    await pspAPI.uploadDocument({
                      ...doc,
                      secondaryCompanyId: updatedCompany._id,
                    });
                  }
                }
              }
            }
          }
        }
      }

      if (!isAuto) {
        setSaved(true);
        // Refresh docData after manual save to show updated names
        const response = await pspAPI.getProfile();
        const updatedData = response.data;
        const newDocData = mapDocumentsToState(updatedData.documents, updatedData.secondaryCompanies);

        // Also clear local documents from secondaryCompanies
        const cleanedSecondary = formData.secondaryCompanies.map((c, index) => ({
          ...c,
          _id: updatedData.secondaryCompanies?.[index]?._id || c._id,
          documents: {},
        }));
        setProfile(updatedData);
        setFormData((prev) => ({
          ...prev,
          documents: {},
          secondaryCompanies: cleanedSecondary,
          docData: newDocData,
        }));
        setTimeout(() => setSaved(false), 3000);
      } else {
        // For auto-save, we just clear the uploaded documents from local state if they were uploaded
        // We also need to refresh docData to show "Already Uploaded" status
        const response = await pspAPI.getProfile();
        const updatedData = response.data;
        const newDocData = mapDocumentsToState(updatedData.documents, updatedData.secondaryCompanies);
        const cleanedSecondary = formData.secondaryCompanies.map((c, index) => ({
          ...c,
          _id: updatedData.secondaryCompanies?.[index]?._id || c._id,
          documents: {},
        }));
        setProfile(updatedData);
        setFormData((prev) => ({
          ...prev,
          documents: {},
          secondaryCompanies: cleanedSecondary,
          docData: newDocData,
        }));
      }
      return true;
    } catch (err) {
      console.error("Failed to save profile:", err);
      if (!isAuto)
        setError(err.response?.data?.message || "Failed to save changes");
      return false;
    } finally {
      if (isAuto) setIsAutoSaving(false);
      else setIsSaving(false);
      isSavingRef.current = false;
    }
  };

  // Debounced Auto-Save (10 seconds)
  useEffect(() => {
    if (
      !loading &&
      profile?.onboardingStatus === "PRE_QUAL_APPROVED" &&
      profile?.creditLineStatus !== "Approved"
    ) {
      const timer = setTimeout(() => {
        handleSave(true);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [formData, loading, profile?.onboardingStatus]);

  const handleNext = async () => {
    const success = await handleSave();
    if (success && currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="max-w-4xl mx-auto">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {profile?.onboardingStatus === "PRE_QUAL_APPROVED" && (
            <div className="mb-10">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">
                    PSP Onboarding
                  </h1>
                  <p className="text-gray-500 mt-1">
                    Complete your profile to access the credit facility
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {isAutoSaving && (
                    <div className="flex items-center gap-2 text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Auto-saving...
                    </div>
                  )}
                  {saved && (
                    <div className="flex items-center gap-2 text-xs font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">
                      <CheckCircle className="w-3 h-3" />
                      Changes saved
                    </div>
                  )}
                </div>
              </div>

              {/* Stepper */}
              <div className="relative pb-4">
                <div className="absolute top-5 left-0 w-full h-0.5 bg-gray-200 -z-0" />
                <div
                  className="absolute top-5 left-0 h-0.5 bg-brand-purple transition-all duration-500 -z-0"
                  style={{
                    width: `${(currentStep / (steps.length - 1)) * 100}%`,
                  }}
                />

                <div className="flex justify-between relative z-10">
                  {steps.map((step, index) => {
                    const Icon = step.icon;
                    const isActive = currentStep === index;
                    const isCompleted = currentStep > index;

                    return (
                      <button
                        key={step.id}
                        onClick={async () => {
                          handleSave(); // Trigger save in background
                          setCurrentStep(index);
                        }}
                        className="flex flex-col items-center group focus:outline-none"
                      >
                        <div
                          className={`
                          w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-2
                          ${
                            isActive
                              ? "bg-brand-purple border-brand-purple text-white scale-110 shadow-lg shadow-brand-purple/20"
                              : isCompleted
                                ? "bg-white border-brand-purple text-brand-purple"
                                : "bg-white border-gray-200 text-gray-400 group-hover:border-gray-300"
                          }
                        `}
                        >
                          {isCompleted ? (
                            <CheckCircle className="w-6 h-6" />
                          ) : (
                            <Icon className="w-5 h-5" />
                          )}
                        </div>
                        <span
                          className={`
                          mt-3 text-[10px] uppercase tracking-wider font-bold transition-colors
                          ${isActive ? "text-brand-purple" : isCompleted ? "text-gray-900" : "text-gray-400"}
                        `}
                        >
                          {step.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Conditional Banners */}
          {profile?.onboardingStatus === "PRE_QUAL_NOT_SUBMITTED" && (
            <div className="mb-6 p-8 bg-white border border-brand-purple/20 rounded-2xl shadow-sm text-center">
              <div className="w-20 h-20 bg-brand-purple/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <ClipboardList className="w-10 h-10 text-brand-purple" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Finish Your Application
              </h2>
              <p className="text-gray-600 max-w-md mx-auto mb-8">
                You've created your account! Now please answer 7 quick business
                questions to submit your application for initial review.
              </p>
              <button
                onClick={() => navigate("/register")}
                className="px-8 py-3 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20"
              >
                Complete Registration Details
              </button>
            </div>
          )}

          {profile?.onboardingStatus === "PRE_QUAL_PENDING" && (
            <div className="mb-6 p-8 bg-white border border-brand-purple/20 rounded-2xl shadow-sm text-center">
              <div className="w-20 h-20 bg-brand-purple/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <ClipboardList className="w-10 h-10 text-brand-purple animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Initial Review in Progress
              </h2>
              <p className="text-gray-600 max-w-md mx-auto mb-8">
                Your Registration Details details have been submitted. Our team
                is reviewing your application. You will be notified via email
                once approved to proceed.
              </p>
            </div>
          )}
          {profile?.onboardingStatus === "PRE_QUAL_APPROVED" && (
            <FormNavigation
              handleBack={handleBack}
              handleNext={handleNext}
              handleSave={handleSave}
              currentStep={currentStep}
              stepsCount={steps.length}
              loading={loading}
              isSaving={isSaving}
              creditLineStatus={profile?.creditLineStatus}
              className="mt-12 mb-5"
            />
          )}

          {/* Main Form Content */}
          {profile?.onboardingStatus === "PRE_QUAL_APPROVED" && (
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleNext();
              }}
              className="card p-8 min-h-[500px] flex flex-col shadow-xl shadow-gray-200/50"
            >
              <div className="flex-grow">
                {currentStep === 0 && (
                  <CompanyInfo
                    data={formData}
                    onChange={updateFormData}
                    docData={formData.docData}
                    onDelete={deleteExistingDocument}
                  />
                )}
                {currentStep === 1 && (
                  <BusinessOperations
                    data={formData}
                    onChange={updateFormData}
                  />
                )}
                {currentStep === 2 && (
                  <FinancialInfo
                    data={formData}
                    onChange={updateFormData}
                    docData={formData.docData}
                    onDelete={deleteExistingDocument}
                  />
                )}
                {currentStep === 3 && (
                  <RiskLegalInfo
                    data={formData}
                    onChange={updateFormData}
                    docData={formData.docData}
                    onDelete={deleteExistingDocument}
                    showNDAError={!!error && error.includes("NDA")}
                  />
                )}
                {currentStep === 4 && (
                  <ApplyFinancingLimit
                    isTab={true}
                    formData={formData}
                    onChange={(stepData) =>
                      setFormData((prev) => ({ ...prev, ...stepData }))
                    }
                  />
                )}
                {currentStep === 5 && <FinancingLimitTab profile={profile} />}
              </div>

              <FormNavigation
                handleBack={handleBack}
                handleNext={handleNext}
                handleSave={handleSave}
                currentStep={currentStep}
                stepsCount={steps.length}
                loading={loading}
                isSaving={isSaving}
                creditLineStatus={profile?.creditLineStatus}
                className="mt-12"
              />
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default Onboarding;
