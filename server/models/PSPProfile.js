const mongoose = require("mongoose");

const pspProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  // Company Information
  companyName: {
    type: String,
    required: true,
  },
  registrationNo: { type: String, default: "" },
  country: { type: String, default: "" },
  yearEstablished: { type: Number, default: 0 },
  keyContact: {
    name: { type: String, default: "" },
    position: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
  },
  uboDetails: { type: String, default: "" },
  pepExposure: { type: Boolean, default: false },
  isAgreedToNDA: { type: Boolean, default: false },
  licenseType: { type: String, default: "" },
  registeredName: { type: String, default: "" },
  jurisdiction: { type: String, default: "" },
  businessModelDescription: { type: String, default: "" },
  purpose: { type: String, default: "" },
  secondaryCompanies: [
    {
      name: { type: String, default: "" },
      registrationNo: { type: String, default: "" },
      country: { type: String, default: "" },
      yearEstablished: { type: Number, default: 0 },
    },
  ],

  // Business Operations
  sector: { type: String, default: "" },
  keyProducts: { type: [String], default: [] },
  topCustomers: { type: [String], default: [] },
  topSuppliers: { type: [String], default: [] },
  businessModels: { type: [String], default: [] },
  transactionVolume: { type: String, default: "" },

  // New Monthly Stats
  monthlyTransactionVolumes: [
    {
      month: { type: String, default: "" },
      volume: { type: Number, default: 0 },
    },
  ],
  numberOfTransactions: [
    {
      month: { type: String, default: "" },
      count: { type: Number, default: 0 },
    },
  ],

  // New Corridor Details
  top3Corridors: [
    {
      fromCountry: { type: String, default: "" },
      toCountry: { type: String, default: "" },
      volume: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
  ],

  // Registration Details Specific Fields
  preQualRequestedAmount: { type: String, default: "" },
  preQualRequestedDuration: { type: String, default: "" },
  preQualFundingCounterparties: { type: String, default: "" },
  preQualRemittanceCorridors: { type: String, default: "" },

  // Financial Information
  annualRevenue: { type: Number, default: 0 },
  outstandingLoans: { type: Number, default: 0 },
  rolledOutCreditLines: {
    type: String,
    default: ""
  },
  primaryBank: {
    type: String,
    default: ""
  },
  currentAllocation: {
    type: String,
    default: ""
  },
  projectedRevenue: { type: Number, default: 0 },
  profitMargin: { type: Number, default: 0 },
  monthlyCashFlow: { type: Number, default: 0 },
  defaultHistory: { type: String, default: "" },

  // KYC Documents
  kycDocuments: [
    {
      name: { type: String, default: "" },
      url: { type: String, default: "" },
      uploadedAt: { type: Date, default: Date.now },
    },
  ],

  // Approved credit line details
  approvedAmount: {
    type: Number,
    default: 0,
  },
  currentlyUtilized: {
    type: Number,
    default: 0,
    min: 0,
  },
  creditLineStatus: {
    type: String,
    enum: [
      "Pending",
      "Approved",
      "Rejected",
      "UnderReview",
      "NeedMoreInfo",
      "Expired",
      "Suspended",
      "None",
    ],
    default: "None",
  },
  requestedAmount: { type: Number, default: 0 },
  requestedDuration: { type: Number, default: 0 },

  // Approved Credit Line — raw credit (pre-reserve)
  approvedCreditLine: {
    type: Number,
    default: 0
  },
  creditReserve: {
    type: Number,
    default: 0
  },
  approvedDuration: { type: Number, default: 0 },
  utilizedBips: { type: Number, default: 0 },
  unutilizedBips: { type: Number, default: 0 },

  // Penalty & Pause thresholds
  penaltyBips: {
    type: Number,
    default: 0
  },
  penaltyGracePeriodHours: {
    type: Number,
    default: 24
  },
  pauseAfterDays: {
    type: Number,
    default: 3
  },

  // Defa specific fields
  drawdown_limit: { type: String, default: "" },
  facility_tenure: { type: String, default: "" },
  drawdown_tenor: { type: String, default: "" },
  penalty_rate: { type: String, default: "" },
  requested_Apy: { type: String, default: "" },
  psp_identifie: { type: String, default: "" },

  // Financing Limit Request Fields
  fundingCounterparties: { type: String, default: "" },
  remittanceCorridors: { type: String, default: "" },
  desiredCurrencyType: {
    type: String,
    enum: ["Stable", "Fiat", ""],
    default: "",
  },
  desiredCurrencyValue: { type: String, default: "" },
  desiredBCNetwork: {
    type: String,
    enum: [
      "stellar",
      "zigchain",
      "starknet",
      "arbitrum",
      "ethereum",
      "solana",
      "",
    ],
    default: "",
  },
  primaryCurrencyPairs: { type: String, default: "" },
  minUtilizationRate: {
    type: Number,
    default: 0
  },

  // Tenure tracking
  creditLineStartDate: {
    type: Date,
    default: null
  },
  creditLineEndDate: {
    type: Date,
    default: null
  },
  creditLineRenewals: {
    type: Number,
    default: 0
  },

  // CAD/CRO feedback
  cadMessage: {
    type: String,
    default: "",
  },
  draftApproval: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  // Blockchain Integration
  // `solanaWallet` is the canonical primary wallet bound during onboarding
  // and baked into the on-chain Pool PDA seed at initialize_pool. Once a
  // pool exists this field is effectively immutable — rebinding orphans
  // the pool. The legacy `walletAddress` array is preserved for code paths
  // that haven't migrated and for additional whitelisted recipient wallets.
  solanaWallet: { type: String, default: "" },
  walletAddress: {
    type: [
      {
        name: { type: String, default: "" },
        address: { type: String, default: "" }
      }
    ],
    default: []
  },
  // Per-facility on-chain artifacts now live on the Facility model.
  // Use Facility.find({ pspProfileId: ... }) to enumerate a PSP's facilities.

  // Per-PSP facility counter — incremented every time a facility is requested.
  // Combined with pspWallet to seed the on-chain pool PDA. Must be unique per PSP.
  nextFacilityId: { type: Number, default: 1 },

  // Credit Maintenance Charges (Weekly)
  lastMaintenanceChargeDate: {
    type: Date,
    default: null,
  },
  maintenanceChargeFrequency: {
    type: String,
    enum: ["weekly", "monthly"],
    default: "monthly",
  },
  accumulatedMaintenanceFee: {
    type: Number,
    default: 0,
  },
  nextMaintenanceDueDate: {
    type: Date,
    default: null,
  },
  // Credit Scoring
  creditScoring: {
    criteriaScores: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    totalScore: {
      type: Number,
      default: 0
    },
    percentage: {
      type: Number,
      default: 0
    },
    rating: {
      type: String,
      default: 'N/A'
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  aiScanReport: {
    status: {
      type: String,
      default: ''
    },
    message: {
      type: String,
      default: ''
    },
    creditScore: {
      type: Number,
      default: 0
    },
    outputFile: {
      type: String,
      default: ''
    },
    downloadUrl: {
      type: String,
      default: ''
    },
    updatedAt: {
      type: Date,
      default: null
    },
    startedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    requestedBy: {
      type: String,
      default: ''
    },
    requestedByEmail: {
      type: String,
      default: ''
    }
  },
  isCollaborative: {
    type: Boolean,
    default: false
  },
  rolesInvolved: {
    type: [String],
    enum: ['KAM', 'CAD', 'CRO', 'LEGAL_ADMIN'],
    default: []
  },
  lastAdminAction: {
    role: { type: String, default: "" },
    adminName: { type: String, default: "" },
    adminEmail: { type: String, default: "" },
    action: { type: String, default: "" },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  // PSP onboarding lifecycle (one-time entity approval).
  // Per-facility approval lives on the Facility model.
  workflowStep: {
    type: String,
    enum: [
      'KAM_REVIEW',
      'CAD_REVIEW',
      'TERM_SHEET_STAGE',
      'TECH_INTEGRATION_STAGE',
      'CRO_REVIEW',
      'LEGAL_REVIEW',
      'FINALIZED'
    ],
    default: 'KAM_REVIEW'
  },
  // CL Approval Documents & Negotiation
  agreementNotes: [
    {
      role: { type: String },
      adminName: { type: String },
      text: { type: String },
      isHiddenFromPSP: { type: Boolean, default: false },
      timestamp: { type: Date, default: Date.now }
    }
  ],
  termSheet: {
    url: { type: String, default: "" }, // Azure Blob URL
    status: { type: String, enum: ['Pending', 'Shared', 'Accepted', 'Negotiating'], default: 'Pending' },
    sharedAt: { type: Date }
  },
  techAgreement: {
    url: { type: String, default: "" }, // Azure Blob URL
    status: { type: String, enum: ['Pending', 'Shared', 'Accepted', 'Negotiating'], default: 'Pending' },
    sharedAt: { type: Date }
  },
  facilityAgreement: {
    url: { type: String, default: "" }, // Azure Blob URL
    status: { type: String, enum: ['Pending', 'Shared', 'Accepted', 'Negotiating'], default: 'Pending' },
    sharedAt: { type: Date },
    legalAdmin: { type: String, default: "" }
  },
  onboardingStatus: {
    type: String,
    enum: ['PRE_QUAL_NOT_SUBMITTED', 'PRE_QUAL_PENDING', 'PRE_QUAL_APPROVED', 'PRE_QUAL_REJECTED'],
    default: 'PRE_QUAL_NOT_SUBMITTED'
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
pspProfileSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();

});



module.exports = mongoose.model("PSPProfile", pspProfileSchema);
