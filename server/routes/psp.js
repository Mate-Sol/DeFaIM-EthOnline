const express = require("express");
const router = express.Router();
const { authMiddleware, authorizeRoles } = require("../middleware/auth");
const PSPProfile = require("../models/PSPProfile");
const FinancingRequest = require("../models/FinancingRequest");
const FinancingDocument = require("../models/FinancingDocument");
const User = require("../models/User");
const {
  financingValidationAgent,
} = require("../workers/financingValidationAgent");
const {
  getRepaymentQuote,
  processRepayment,
  requestRepayment,
} = require("../workers/repaymentAgent");
const OrderBook = require("../models/OrderBook");
const {
  createNotification,
  notifyAdmins,
} = require("../services/notificationService");
const { sendEmail } = require("../services/emailService");
const axios = require("axios");
const EfficientDeposit = require("../models/EfficientDeposit");
const { uploadBase64Attachment } = require("../fileUpload");
const { default: mongoose } = require("mongoose");
const bcrypt = require("bcryptjs");

// Apply authentication to all PSP routes
router.use(authMiddleware);
router.use(authorizeRoles("PSP"));

// @route   POST /api/psp/upload-document
// @desc    Upload a document (Base64)
// @access  Private (PSP)
// Allowed file types and max size
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_FILE_SIZE_MB = 5; // Max file size

router.post("/upload-document", async (req, res) => {
  try {
    const { category, documentType, name, fileContent, fileType, fileSize, secondaryCompanyId } = req.body;


    // Validate required fields
    if (!category || !name || !documentType || !fileContent) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Optional: You can still check for exact filename to avoid accidental duplicates
    // But we remove the strict restriction to allow multiple documents of same type.
    // just ensure the name is unique to avoid identical entries of same file

    if (documentType !== "Receipt") {
      const existingDocument = await FinancingDocument.findOne({
        pspId: req.user.userId,
        category,
        documentType,
        name,
        secondaryCompanyId
      })
      // .sort({ createdAt: -1 });

      if (existingDocument) {
        return res.status(200).json({ success: false, message: "This exact document already exists" });
      }
    }

    // Validate category enum
    const validCategories = [
      "Company Identity & Legal",
      "Financials & Banking",
      "Operational Settlement Data",
      "Risk & Legal",
    ];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: "Invalid category value" });
    }

    let mimeType = fileType;

    // Handle base64 file
    if (/^data:.*;base64,/.test(fileContent)) {
      const [meta, base64String] = fileContent.split(";base64,");
      mimeType = meta.replace("data:", "");

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ message: "File type not allowed" });
      }

      // Validate file size
      const bytes = Buffer.byteLength(base64String, "base64");
      const sizeMB = bytes / (1024 * 1024);
      if (sizeMB > MAX_FILE_SIZE_MB) {
        return res
          .status(400)
          .json({ message: `File size exceeds ${MAX_FILE_SIZE_MB}MB limit` });
      }

      // Generate safe file name
      const safeNameOrigin = name.replace(/\s+/g, "_");
      const lastDotIndex = safeNameOrigin.lastIndexOf(".");
      let baseName = safeNameOrigin;
      let originalExt = "";

      if (lastDotIndex !== -1) {
        baseName = safeNameOrigin.substring(0, lastDotIndex);
        originalExt = safeNameOrigin.substring(lastDotIndex + 1);
      }

      const mimeToExt = {
        "application/pdf": "pdf",
        "image/jpeg": "jpeg",
        "image/jpg": "jpg",
        "image/png": "png",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.ms-excel": "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
      };

      const ext = mimeToExt[mimeType] || originalExt || mimeType.split("/")[1] || "bin";
      const fileName = `${Date.now()}-${baseName}.${ext}`;
      const containerName = process.env.containerName;

      // Upload to Azure
      await uploadBase64Attachment(
        `${process.env.containerName}/uploads/documents`,
        fileName,
        base64String,
        mimeType,
      );

      fileURL = `${process.env.blobBaseUrl}/${process.env.containerName}/uploads/documents/${fileName}`;
    } else {
      return res.status(400).json({ message: "Invalid file content format" });
    }

    // Save document in MongoDB
    const document = new FinancingDocument({
      pspId: req.user.userId,
      category,
      secondaryCompanyId: secondaryCompanyId || null,
      name,
      documentType,
      fileContent: fileURL,
      fileType: mimeType,
      fileSize: fileSize || Math.round(fileContent.length * 0.75), // approximate bytes
    });

    await document.save();

    res.status(201).json({
      success: true,
      message: "Document uploaded successfully",
      document,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      message: "Something went wrong!",
      error: error.message,
    });
  }
});

// @route   GET /api/psp/profile
// @desc    Get PSP profile
// @access  Private (PSP only)
router.get("/profile", async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Convert to object to add isExpired and documents
    const profileData = profile.toObject();
    profileData.isExpired = false;

    // Fetch associated documents (metadata only)
    const documents = await FinancingDocument.find({
      pspId: req.user.userId,
    });
    profileData.documents = documents;

    // Off-chain expiry signal; indexer reconciles against on-chain pool.
    if (profile.creditLineEndDate && new Date(profile.creditLineEndDate) < new Date()) {
      profileData.isExpired = true;
    }

    // Hide facility agreement from PSP until it reaches PSP_FACILITY_APPROVAL stage
    const restrictedSteps = ['KAM_REVIEW', 'CAD_REVIEW', 'TERM_SHEET_STAGE', 'TECH_INTEGRATION_STAGE', 'CRO_REVIEW', 'LEGAL_REVIEW', 'CRO_FACILITY_REVIEW', 'CAD_FACILITY_REVIEW', 'KAM_FACILITY_REVIEW'];
    if (restrictedSteps.includes(profile.workflowStep)) {
      profileData.facilityAgreement = null;
    }

    res.json(profileData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/psp/credit-line-expiry
// @desc    Get credit line expiry status
// @access  Private (PSP only)
router.get("/credit-line-expiry", async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile || !profile.creditLineEndDate) {
      return res.status(404).json({ message: "No active credit line found" });
    }

    const now = new Date();
    const expiryDate = new Date(profile.creditLineEndDate);
    const msRemaining = expiryDate - now;
    const remainingDays = Math.max(0, Math.ceil(msRemaining / 86400000));
    const isExpired = msRemaining <= 0;

    if (isExpired && profile.creditLineStatus !== "Expired") {
      profile.creditLineStatus = "Expired";
      await profile.save();
    }

    res.json({
      success: true,
      poolAddress: profile.assignedPoolAddress || null,
      remainingDays,
      isExpired,
      expiryDate,
      creditLineDuration: profile.creditLineDuration,
      approvalDate: profile.approvalDate,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PUT /api/psp/profile
// @desc    Update PSP profile
// @access  Private (PSP only)
router.put("/profile", async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    if (profile.creditLineStatus === "Approved") {
      return res.status(400).json({ message: "Profile is already approved" });
    }

    // Update fields (excluding secondaryCompanies for special handling)
    const allowedUpdates = [
      "companyName",
      "registrationNo",
      "country",
      "yearEstablished",
      "keyContact",
      "uboDetails",
      "pepExposure",
      "sector",
      "keyProducts",
      "topCustomers",
      "topSuppliers",
      "transactionVolume",
      "annualRevenue",
      "outstandingLoans",
      "rolledOutCreditLines",
      "primaryBank",
      "currentAllocation",
      "walletAddress",
      "projectedRevenue",
      "profitMargin",
      "monthlyCashFlow",
      "defaultHistory",
      "licenseType",
      "registeredName",
      "jurisdiction",
      "businessModelDescription",
      "businessModels",
      "monthlyTransactionVolumes",
      "numberOfTransactions",
      "top3Corridors",
      "remittanceCorridors",
      "requestedAmount",
      "requestedDuration",
      "fundingCounterparties",
      "onboardingStatus",
      "isAgreedToNDA",
      "desiredCurrencyType",
      "desiredCurrencyValue",
      "desiredBCNetwork",
      "drawdown_tenor",
      "purpose",
      "preQualRequestedAmount",
      "preQualRequestedDuration",
      "preQualFundingCounterparties",
      "preQualRemittanceCorridors"
    ];

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        profile[field] = req.body[field];
      }
    });

    // Special handling for secondaryCompanies to preserve subdocument _ids
    if (req.body.secondaryCompanies !== undefined) {
      const incoming = req.body.secondaryCompanies;
      const existingMap = new Map();

      profile.secondaryCompanies.forEach(c => {
        if (c._id) existingMap.set(c._id.toString(), c);
      });

      // We'll rebuild the array to maintain order from request
      const updatedList = [];
      incoming.forEach(company => {
        if (company._id && existingMap.has(company._id.toString())) {
          const existing = existingMap.get(company._id.toString());
          existing.set(company);
          updatedList.push(existing);
        } else {
          // New company or temp ID
          const newCompany = { ...company };
          if (newCompany._id && newCompany._id.toString().startsWith('temp_')) {
            delete newCompany._id;
          }
          updatedList.push(newCompany);
        }
      });

      profile.secondaryCompanies = updatedList;
    }
    profile.creditLineStatus = "UnderReview";

    await profile.save();

    // await notifyAdmins(req.user.userId, {
    //   type: "info",
    //   title: "PSP Profile Updated",
    //   message: `${profile.companyName} has updated their profile information.`,
    // });

    res.json(profile);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/psp/apply-limit
// @desc    Apply for financing limit
// @access  Private (PSP only)
router.post("/apply-limit", async (req, res) => {
  try {
    const {
      requestedAmount,
      requestedDuration,
      fundingCounterparties,
      remittanceCorridors,
      desiredCurrencyType,
      desiredCurrencyValue,
      desiredBCNetwork,
      drawdown_tenor,
    } = req.body;

    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Update profile with application
    profile.requestedAmount = requestedAmount;
    profile.requestedDuration = requestedDuration;
    profile.fundingCounterparties = fundingCounterparties;
    profile.remittanceCorridors = remittanceCorridors;
    profile.desiredCurrencyType = desiredCurrencyType;
    profile.desiredCurrencyValue = desiredCurrencyValue;
    profile.desiredBCNetwork = desiredBCNetwork;
    profile.drawdown_tenor = drawdown_tenor;
    profile.creditLineStatus = "UnderReview";
    profile.workflowStep = "KAM_REVIEW"; // Reset to start of workflow if applicable

    await profile.save();

    // 1. Notify Admins via Internal Notifications
    await notifyAdmins(req.user.userId, {
      type: "info",
      title: "New Financing Limit Application",
      message: `${profile.companyName} has submitted a new financing limit application for $${requestedAmount.toLocaleString()}.`,
    });

    // 2. Send detailed Email to Admins (using a generic admin email or fetching from DB)
    // For now, we'll send to a set of predefined admin emails or use notifyAdmins logic if it supported emails
    const adminEmails = ["admins@paymate.com"]; // Placeholder, ideally fetch CAD/CRO emails
    for (const email of adminEmails) {
      await sendEmail({
        to: email,
        subject: `New Credit Line Request: ${profile.companyName}`,
        title: "Credit Line Application Submitted",
        body: `
          <p>A new financing limit application has been submitted by <strong>${profile.companyName}</strong>.</p>
          <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 0;"><strong>Requested Amount:</strong> $${requestedAmount.toLocaleString()}</p>
            <p style="margin: 0;"><strong>Desired Duration:</strong> ${requestedDuration} Days</p>
            <p style="margin: 0;"><strong>Drawdown Tenor:</strong> ${drawdown_tenor || "N/A"}</p>
            <p style="margin: 0;"><strong>Currency:</strong> ${desiredCurrencyType} (${desiredCurrencyValue})</p>
            <p style="margin: 0;"><strong>Blockchain Network:</strong> ${desiredBCNetwork}</p>
            <p style="margin: 0;"><strong>Remittance Corridors:</strong> ${remittanceCorridors || "N/A"}</p>
          </div>
          <p>Please log in to the admin portal to review the application and documents.</p>
        `,
        actionText: "Review Application",
        actionLink: `${process.env.FRONTEND_URL}/admin/applications`,
      });
    }

    // 3. Send confirmation Email to PSP
    await sendEmail({
      to: req.user.email,
      subject: "Financing Limit Application Received",
      title: "Application Received",
      body: `
        <p>Dear ${req.user.name || "Partner"},</p>
        <p>We have received your application for a financing limit of <strong>$${requestedAmount.toLocaleString()}</strong>.</p>
        <p>Our Credit Approval Department (CAD) will now review your profile and documents. You will be notified once a decision has been made or if more information is required.</p>
        <p>Current Status: <strong>Under Review</strong></p>
      `,
      actionText: "View Dashboard",
      actionLink: `${process.env.FRONTEND_URL}/psp/dashboard`,
    });

    res.json({ message: "Application submitted successfully", profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/psp/order-book
// @desc    Get PSP order book
// @access  Private (PSP only)
router.get("/order-book", async (req, res) => {
  try {
    const orders = await EfficientDeposit.aggregate([
      {
        $match: {
          "metadata.partnerId": new mongoose.Types.ObjectId(req.user.userId),
        },
      },
      {
        $lookup: {
          from: "financingrequests",
          localField: "payload.unique_id",
          foreignField: "orderReference",
          as: "financingInfo",
        },
      },
      {
        $addFields: {
          receiptUrl: { $arrayElemAt: ["$financingInfo.receiptUrl", 0] },
        },
      },
      {
        $project: {
          "metadata.headers": 0,
          financingInfo: 0,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});



// @route   DELETE /api/psp/documents/:id
// @desc    Delete a document
// @access  Private (PSP)
router.delete("/documents/:id", async (req, res) => {
  try {
    const document = await FinancingDocument.findOne({
      _id: req.params.id,
      pspId: req.user.userId,
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found or unauthorized" });
    }

    await FinancingDocument.deleteOne({ _id: req.params.id });

    res.json({
      success: true,
      message: "Document deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({
      message: "Something went wrong!",
      error: error.message,
    });
  }
});

// @route   PATCH /api/psp/financing-requests/receipt
// @desc    Update receipt for a financing request
// @access  Private (PSP only)
router.patch("/financing-requests/receipt", async (req, res) => {
  try {
    const { orderReference, receiptUrl } = req.body;

    if (!orderReference || !receiptUrl) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const profile = await PSPProfile.findOne({ userId: req.user.userId });
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const financing = await FinancingRequest.findOne({
      orderReference,
      pspId: profile._id,
    }).sort({ createdAt: -1 });

    if (!financing) {
      return res.status(404).json({ message: "Financing request not found" });
    }

    if (financing.receiptUrl) {
      return res.status(400).json({ message: "Receipt already uploaded" });
    }

    financing.receiptUrl = receiptUrl;
    await financing.save();

    res.json({
      success: true,
      message: "Receipt updated successfully",
      financing,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/psp/request-financing
// @desc    Request financing (drawdown) - ASYNC WORKFLOW
// @access  Private (PSP only)
router.post("/request-financing", async (req, res) => {
  try {
    const { amount, orderReference, drawdownTenor } = req.body;

    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Solana program has no admin pause concept — drawdowns are blocked
    // automatically when an existing drawdown is past tenor+grace+penalty.
    // The PSP's own `request_drawdown` tx will fail in that case.

    // Basic validation - don't check credit availability here (validation agent does that)
    if (!amount || !orderReference) {
      return res
        .status(400)
        .json({ message: "Amount and order reference are required" });
    }

    // Validate drawdownTenor
    if (drawdownTenor && profile.drawdown_tenor && drawdownTenor > profile.drawdown_tenor) {
      return res.status(400).json({ message: `Drawdown tenor cannot exceed ${profile.drawdown_tenor} days` });
    }

    // Check if already financing or financed
    const existingDeposit = await EfficientDeposit.findOne({
      "metadata.partnerId": req.user.userId,
      "payload.unique_id": orderReference
    });

    if (existingDeposit && (existingDeposit.status === 'Financing' || existingDeposit.status === 'Financed')) {
      return res.status(400).json({ message: "This order is already being financed or has been financed." });
    }

    // Create financing request with Pending status
    const financingRequest = new FinancingRequest({
      pspId: profile._id,
      amount,
      orderReference,
      drawdownTenor: drawdownTenor || profile.drawdown_tenor || 30,
      status: "Pending",
    });

    await financingRequest.save();

    // Mark Order as Financing in EfficientDeposit
    await EfficientDeposit.findOneAndUpdate(
      { "payload.unique_id": orderReference },
      { $set: { status: "Financing" } }
    );

    // Notify admins about the new request for CAD review
    await notifyAdmins(req.user.userId, {
      type: "info",
      title: "New Financing Request",
      message: `${profile.companyName} has requested financing for $${amount.toLocaleString()}.`,
    });

    // Return immediately with request ID
    res.json({
      message: "Financing request submitted successfully. Waiting for CAD review.",
      requestId: financingRequest._id,
      status: "Pending",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/psp/financing-requests/:id
// @desc    Get financing request status (polling endpoint)
// @access  Private (PSP only)
router.get("/financing-requests/:id", async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const request = await FinancingRequest.findOne({
      _id: req.params.id,
      pspId: profile._id,
    });

    if (!request) {
      return res.status(404).json({ message: "Financing request not found" });
    }

    // Return request with calculated interest
    res.json(request);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/psp/active-financings
// @desc    Get all active financings for PSP with interest calculations
// @access  Private (PSP only)
router.get("/active-financings", async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const financings = await FinancingRequest.find({
      pspId: profile._id,
      status: { $in: ["Pending", "Validated", "Disbursed", "Repaid", "Overdue", "PenaltyApplied", "RepaymentPending"] },
    }).sort({ createdAt: -1 });

    // Return with virtual fields (interest calculated)
    res.json(financings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/psp/pool-status
// @desc    Get credit pool status from blockchain (enriched with new fields)
// @access  Private (PSP only)
router.get("/pool-status", async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile || !profile.assignedPoolAddress) {
      return res.status(404).json({ message: "No credit pool assigned" });
    }

    // Pre-Solana-indexer: serve pool fields off-chain. Once the indexer ships
    // (Phase 3), this returns merged Mongo + on-chain Pool/Drawdown PDA state.
    const enrichedData = {
      pending: true,
      source: 'mongo',
      poolAddress: profile.assignedPoolAddress,
      // Off-chain fields
      companyName: profile.companyName,
      availableCredit: profile.approvedAmount - profile.currentlyUtilized,
      utilizedAmount: profile.currentlyUtilized,
      utilizedBips: profile.utilizedBips,
      unutilizedBips: profile.unutilizedBips,
      penaltyBips: profile.penaltyBips,
      penaltyGracePeriodHours: profile.penaltyGracePeriodHours,
      pauseAfterDays: profile.pauseAfterDays,
      creditLineStartDate: profile.creditLineStartDate,
      creditLineEndDate: profile.creditLineEndDate,
      creditLineRenewals: profile.creditLineRenewals || 0,
      currentlyUtilized: profile.currentlyUtilized || 0,
      drawdown_tenor: profile.drawdown_tenor || 30
    };

    res.json(enrichedData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/psp/repayment-quote/:requestId
// @desc    Get repayment quote for a financing request
// @access  Private (PSP only)
router.get("/repayment-quote/:requestId", async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const result = await getRepaymentQuote(req.params.requestId);

    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }

    // Verify the financing request belongs to this PSP
    const financing = await FinancingRequest.findById(req.params.requestId);
    if (!financing || financing.pspId.toString() !== profile._id.toString()) {
      return res
        .status(403)
        .json({ message: "Unauthorized access to this financing request" });
    }

    res.json(result.quote);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/psp/process-repayment
// @desc    Process a repayment record (after frontend calls smart contract)
// @access  Private (PSP only)
router.post("/process-repayment", async (req, res) => {
  try {
    const {
      requestId,
      principalAmount,
      actualInterestPaid,
      txHash,
      blockNumber,
    } = req.body;

    const profile = await PSPProfile.findOne({ userId: req.user.userId });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Verify the financing request belongs to this PSP
    const financing = await FinancingRequest.findById(requestId);
    if (!financing || financing.pspId.toString() !== profile._id.toString()) {
      return res
        .status(403)
        .json({ message: "Unauthorized access to this financing request" });
    }

    console.log(
      "[PSP Repayment] Recording repayment from frontend transaction",
    );
    console.log("Transaction Hash:", txHash);
    console.log("Principal:", principalAmount);
    console.log("Interest:", actualInterestPaid);

    // Process repayment in backend (update financing status, restore credit)
    const result = await processRepayment(requestId, {
      principalAmount,
      actualInterestPaid,
      txHash,
      blockNumber,
      pspId: profile._id,
    });

    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }

    res.json({
      message: "Repayment recorded successfully",
      financing: result.financing,
      repaymentRecord: result.repaymentRecord,
      creditRestored: result.creditRestored,
      variance: result.variance,
      variancePercentage: result.variancePercentage,
      txHash,
    });
  } catch (error) {
    console.error("[PSP Repayment] Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
// @route   POST /api/psp/request-repayment
// @desc    Request a repayment (mark as pending, no SC interaction)
// @access  Private (PSP only)
router.post("/request-repayment", async (req, res) => {
  try {
    const { requestId } = req.body;

    const profile = await PSPProfile.findOne({ userId: req.user.userId });
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Verify the financing request belongs to this PSP
    const financing = await FinancingRequest.findById(requestId);
    if (!financing || financing.pspId.toString() !== profile._id.toString()) {
      return res
        .status(403)
        .json({ message: "Unauthorized access to this financing request" });
    }

    console.log("[PSP Repayment] Requesting repayment for requestId:", requestId);

    const result = await requestRepayment(requestId, profile._id, {
      principalAmount: req.body.principalAmount,
      actualInterestPaid: req.body.actualInterestPaid
    });

    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }

    res.json({
      message: "Repayment request submitted. Waiting for CRO confirmation.",
      financing: result.financing,
      repaymentRecord: result.repaymentRecord,
    });
  } catch (error) {
    console.error("[PSP Repayment Request] Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// @route   PUT /api/psp/update-profile
// @desc    Update user profile (name) - Shared for all /client roles
// @access  Private
router.put("/update-profile", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.name = name;
    await user.save();

    res.json({ success: true, message: "Profile updated successfully", user: { name: user.name, email: user.email } });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/psp/change-password
// @desc    Change user password - Shared for all /client roles
// @access  Private
router.post("/change-password", async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ message: "All fields are required" });
    if (newPassword.length < 6) return res.status(400).json({ message: "New password too short" });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) return res.status(400).json({ message: "Incorrect old password" });

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/psp/documents/:id/download
// @desc    Proxy-download a PSP document from Azure with correct filename
// @access  Private (PSP only)
router.get("/documents/:id/download", async (req, res) => {
  try {
    const document = await FinancingDocument.findOne({
      _id: req.params.id,
      pspId: req.user.userId,
    });
    if (!document) return res.status(404).json({ message: "Document not found" });

    const cleanName = (document.name || "download").replace(/[^\w.\-\s]/g, "_");
    const fileResponse = await axios.get(document.fileContent, { responseType: "arraybuffer" });

    res.setHeader("Content-Disposition", `attachment; filename="${cleanName}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`);
    res.setHeader("Content-Type", document.fileType || "application/octet-stream");
    res.setHeader("Content-Length", fileResponse.data.byteLength);
    res.send(Buffer.from(fileResponse.data));
  } catch (error) {
    console.error("PSP document download proxy error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   POST /api/psp/cl-negotiate
router.post('/cl-negotiate', async (req, res) => {
  try {
    const { text } = req.body;
    const profile = await PSPProfile.findOne({ userId: req.user.userId });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    profile.agreementNotes.push({
      role: 'PSP',
      adminName: req.user.name || req.user.email,
      text,
      timestamp: Date.now()
    });

    await profile.save();
    res.json({ message: 'Note added', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/psp/cl-action
router.post('/cl-action', async (req, res) => {
  try {
    const { action, type, additionalDetails } = req.body;
    const profile = await PSPProfile.findOne({ userId: req.user.userId });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    if (action === 'ACCEPT') {
      if (type === 'termSheet') {
        profile.termSheet.status = 'Accepted';
        profile.workflowStep = 'TECH_INTEGRATION_STAGE'; // Move to next step automatically on acceptance
      } else if (type === 'techAgreement') {
        profile.techAgreement.status = 'Accepted';
        profile.workflowStep = 'CRO_REVIEW'; // Move to CRO Review after Tech Agreement accepted
      } else if (type === 'facilityAgreement') {
        if (profile.workflowStep !== 'PSP_FACILITY_APPROVAL') {
          return res.status(400).json({ message: 'Facility agreement cannot be accepted at this stage' });
        }
        profile.facilityAgreement.status = 'Accepted';
        profile.workflowStep = 'CAD_FINAL_APPROVAL'; // Move to final approval stage
      }
    } else if (action === 'NEGOTIATE') {
      if (type === 'termSheet') profile.termSheet.status = 'Negotiating';
      else if (type === 'techAgreement') profile.techAgreement.status = 'Negotiating';
      else if (type === 'facilityAgreement') {
        profile.facilityAgreement.status = 'Negotiating';
        profile.workflowStep = 'LEGAL_REVIEW';
      }

      if (additionalDetails) {
        profile.agreementNotes.push({
          role: 'PSP',
          adminName: req.user.name || req.user.email,
          text: `${additionalDetails}`,
          timestamp: Date.now()
        });
      }
    } else if (action === 'RESUBMIT') {
      profile.workflowStep = type === 'termSheet' ? 'TERM_SHEET_STAGE' : 'TECH_INTEGRATION_STAGE';
      profile.agreementNotes.push({
        role: 'PSP',
        adminName: req.user.name || req.user.email,
        text: `Profile resubmitted with additional details: ${additionalDetails}`,
        timestamp: Date.now()
      });
    }

    await profile.save();

    // Notify Admins
    if (action === 'ACCEPT') {
      await notifyAdmins(req.user.userId, {
        type: 'success',
        title: `PSP Accepted ${type}`,
        message: `PSP ${profile.companyName} has accepted the ${type === 'termSheet' ? 'Term Sheet' : (type === 'techAgreement' ? 'Technical Agreement' : 'Facility Agreement')}.`
      });
    } else if (action === 'NEGOTIATE') {
      await notifyAdmins(req.user.userId, {
        type: 'warning',
        title: `PSP Requested Revision: ${type}`,
        message: `PSP ${profile.companyName} has requested a revision for the ${type === 'termSheet' ? 'Term Sheet' : (type === 'techAgreement' ? 'Technical Agreement' : 'Facility Agreement')}. Note: ${additionalDetails || 'No details provided'}`
      });
    }

    res.json({ message: `Action ${action} processed`, profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
