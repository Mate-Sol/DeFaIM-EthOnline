import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { pspAPI } from "../../services/api";
import OnboardingLayout from "../../layouts/OnboardingLayout";
import AccountInfo from "./onboarding/AccountInfo";
import PreQualification from "./onboarding/PreQualification";
import { ClipboardList } from "lucide-react";

const Register = () => {
  const navigate = useNavigate();
  const { register, user: authUser } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const isSubmittingRef = useRef(false);
  console.log("🚀 ~ Register ~ currentStep:", currentStep);

  useEffect(() => {
    if (authUser && authUser.onboardingStatus === "PRE_QUAL_NOT_SUBMITTED") {
      setCurrentStep(1);
    }
  }, [authUser]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [boundWallet, setBoundWallet] = useState("");

  // Re-fetch profile after wallet bind so the gate updates without a reload.
  useEffect(() => {
    if (!authUser) return;
    pspAPI.getProfile?.().then((res) => {
      if (res?.data?.walletAddress) setBoundWallet(res.data.walletAddress);
    }).catch(() => {});
  }, [authUser?.id]);
  const [formData, setFormData] = useState({
    // Auth credentials
    email: authUser?.email || "",
    password: "",
    confirmPassword: "",
    name: authUser?.name || "",

    // Company Info
    companyName: authUser?.companyName || "",
    registrationNo: "",
    country: "",
    yearEstablished: "",
    secondaryCompanies: [],
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
    products: [],
    customers: [],
    suppliers: [],

    // Financial Info
    annualRevenue: "",
    projectedRevenue: "",
    profitMargin: "",
    monthlyCashFlow: "",
    rolledOutCreditLines: "",
    primaryBank: "",
    currentAllocation: "",

    walletAddress: [],

    hasDefaultHistory: false,
    defaultDetails: "",

    // Enhanced Questionnaire Fields
    businessModels: [],
    monthlyTransactionVolumes: [],
    numberOfTransactions: [],
    top3Corridors: [],

    // Documents
    documents: [],
    isAgreedToNDA: false,
    docData: {},
  });

  const stepTitles = ["Your Account", "Business Details"];
  const totalSteps = stepTitles.length;

  const updateFormData = (stepData) => {
    setFormData((prev) => {
      const updated = { ...prev, ...stepData };
      // Deep merge documents to prevent overwriting previous selections
      if (stepData.documents) {
        updated.documents = { ...prev.documents, ...stepData.documents };
      }
      return updated;
    });
  };

  const uploadStepDocuments = async (docKeys) => {
    console.log("🚀 ~ uploadStepDocuments ~ docKeys:", formData.documents);

    for (const key of docKeys) {
      const filesArray = formData.documents[key];
      if (Array.isArray(filesArray) && filesArray.length > 0) {
        for (const doc of filesArray) {
          if (doc.fileContent && doc.name && doc.documentType && doc.category) {
            await pspAPI.uploadDocument(doc);
          }
        }
      } else if (filesArray && !Array.isArray(filesArray)) {
        // Handle single document case
        await pspAPI.uploadDocument(filesArray);
      }
    }
  };

  const handleNext = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError("");

    try {
      if (currentStep === 0) {
        // Step 0: Account Setup & Initial Registration
        if (formData.password !== formData.confirmPassword) {
          setError("Passwords do not match");
          return;
        }

        if (!authUser) {
            const result = await register({
              email: formData.email,
              password: formData.password,
              name: formData.name,
              companyName: formData.name,
            });

          if (!result.success) {
            throw new Error(result.error || "Registration failed");
          }
        }

        // After successful registration, move to Registration Details
        setCurrentStep(1);
      } else if (currentStep === 1) {
        // A wallet must be bound before pre-qualification submit; the
        // pool PDA is derived from this wallet at CRO approval time and is
        // immutable thereafter.
        if (!boundWallet) {
          throw new Error('Connect and bind your wallet before submitting.');
        }

        // Upload documents if any (from the 'documents' field)
        if (formData.documents) {
          const docKeys = Object.keys(formData.documents);
          for (const key of docKeys) {
            const files = formData.documents[key];
            if (Array.isArray(files)) {
              for (const fileData of files) {
                if (fileData.fileContent) {
                  // Standardize labels for better mapping
                  let docLabel = key;
                  if (key === 'organogram') docLabel = 'Organogram';
                  if (key === 'flowOfFunds') docLabel = 'Flow of funds';

                  await pspAPI.uploadDocument({
                    ...fileData,
                    documentType: docLabel,
                    category: key === 'organogram' ? 'Company Identity & Legal' : 'Financials & Banking'
                  });
                }
              }
            }
          }
        }

        // Split unified monthly stats from UI into schema-compliant fields
        const monthlyVolumes = (formData.monthlyTransactionVolumes || []).map(v => ({
          month: v.month,
          volume: parseFloat(v.volume.toString().replace(/,/g, "")) || 0
        }));
        
        const monthlyCounts = (formData.monthlyTransactionVolumes || []).map(v => ({
          month: v.month,
          count: parseInt(v.count.toString().replace(/,/g, "")) || 0
        }));

        await pspAPI.updateProfile({
          registeredName: formData.registeredName,
          jurisdiction: formData.jurisdiction,
          licenseType: formData.licenseType,
          businessModelDescription: formData.businessModelDescription,
          primaryCurrencyPairs: formData.primaryCurrencyPairs,
          preQualRemittanceCorridors: formData.preQualRemittanceCorridors,
          transactionVolume: formData.transactionVolume,
          preQualRequestedAmount: formData.preQualRequestedAmount,
          preQualRequestedDuration: formData.preQualRequestedDuration,
          preQualFundingCounterparties: formData.preQualFundingCounterparties,
          businessModels: formData.businessModels,
          monthlyTransactionVolumes: monthlyVolumes,
          numberOfTransactions: monthlyCounts,
          top3Corridors: (formData.top3Corridors || []).map(c => ({
            fromCountry: c.fromCountry,
            toCountry: c.toCountry,
            volume: parseFloat(c.volume.toString().replace(/,/g, "")) || 0,
            count: parseInt(c.count.toString().replace(/,/g, "")) || 0
          })),
          onboardingStatus: "PRE_QUAL_PENDING",
        });

        // Move to the "Submitted" screen (Step 2)
        setCurrentStep(2);
      } else if (currentStep === 2) {
        // This step is now the "Pending Review" screen or continue if allowed
        // Usually, the flow stops here until KAM approval.
        navigate("/psp/onboarding");
      }
    } catch (err) {
      console.error("Step processing failed:", err);
      setError(err.message || "Processing failed. Please try again.");
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <AccountInfo data={formData} onChange={updateFormData} />;
      case 1:
        return (
          <div className="space-y-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Wallet</h3>
              <p className="text-xs text-gray-700">
                You bind your wallet after signing in, from the <strong>Wallet</strong>
                page. It cannot be done here because binding is signed against your
                account, and the account does not exist until this form is submitted.
              </p>
              <p className="text-xs text-gray-700 mt-2">
                It is required before you can request a facility, and it is permanent —
                the wallet you bind is stamped into your on-chain credit pool as the
                borrower, and is the only wallet the pool will accept repayment from.
              </p>
            </div>
            <PreQualification data={formData} onChange={updateFormData} />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <OnboardingLayout
      currentStep={currentStep}
      totalSteps={totalSteps}
      stepTitles={stepTitles}
      onNext={handleNext}
      onBack={handleBack}
      isLastStep={currentStep === totalSteps - 1}
      isSubmitting={isSubmitting}
    >
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm flex items-center gap-2">
          <span>{error}</span>
        </div>
      )}
      {currentStep >= totalSteps ? (
        <div className="text-center py-12 px-6">
          <div className="w-20 h-20 bg-brand-purple/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <ClipboardList className="w-10 h-10 text-brand-purple animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            You're On Your Way to Faster Settlements!
          </h2>
          <p className="text-gray-600 max-w-md mx-auto mb-8">
            Your liquidity profile has been submitted. Our team will review your
            pre-funding application and be in touch shortly.{" "}
          </p>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg inline-block text-sm text-blue-700">
            We'll notify you by email as soon as your application moves to the
            next stage.
          </div>
          <button
            onClick={() => navigate("/psp/onboarding")}
            className="mt-8 block w-full text-center py-3 px-4 bg-brand-purple text-white rounded-xl font-bold hover:bg-brand-purple/90 transition-all"
          >
            Go to My Dashboard
          </button>
        </div>
      ) : (
        renderStep()
      )}
    </OnboardingLayout>
  );
};

export default Register;
