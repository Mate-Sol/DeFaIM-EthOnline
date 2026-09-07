const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const PSPProfile = require('../models/PSPProfile');
const { createNotification, notifyAdmins, notifyUserWithEmail } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const User = require('../models/User');
const { logAction } = require('../services/auditLogger');
const { processRepayment } = require('../workers/repaymentAgent');
const { uploadBase64Attachment } = require('../fileUpload');

// Apply authentication to all admin routes
router.use(authMiddleware);
// Generic admin check for initial route access
router.use(authorizeRoles('KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN', 'LEGAL_ADMIN', 'ONCHAIN_ADMIN'));

// --- SHARED ROUTES (All Admins) ---

// @route   GET /api/admin/applications
// @desc    Get applications based on role/stage with pagination and search
router.get('/applications', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    let query = {};

    // Pagination setup
    const skip = (parseInt(page) - 1) * parseInt(limit);

    if (status) {
      query.creditLineStatus = status;
    } else {
      // Search filter
      if (search) {
        query.$and = query.$and || [];
        query.$and.push({ companyName: { $regex: search, $options: 'i' } });
      }

      // Role-based filtering enhancements for shared visibility
      if (!status && !search) {
        if (req.user.role === 'KAM') {
          query = {
            $or: [
              { workflowStep: 'KAM_REVIEW' },
              { rolesInvolved: 'KAM' },
              { onboardingStatus: 'PRE_QUAL_PENDING' },
              { creditLineStatus: { $in: ['Expired', 'NeedMoreInfo', 'Approved', 'Rejected'] } }
            ]
          };
        } else if (req.user.role === 'CAD') {
          query = {
            $or: [
              { workflowStep: { $in: ['CAD_REVIEW', 'TERM_SHEET_STAGE'] } },
              { rolesInvolved: 'CAD' },
              { creditLineStatus: { $in: ['Expired', 'NeedMoreInfo', 'Approved', 'Rejected'] } }
            ]
          };
        } else if (req.user.role === 'CRO') {
          query = {
            $or: [
              { workflowStep: { $in: ['CRO_REVIEW', 'CRO_FACILITY_REVIEW'] } },
              { rolesInvolved: 'CRO' },
              { creditLineStatus: { $in: ['Expired', 'NeedMoreInfo', 'Approved', 'Rejected'] } }
            ]
          };
        } else if (req.user.role === 'LEGAL_ADMIN') {
          query = {
            $or: [
              { workflowStep: 'LEGAL_REVIEW' },
              { rolesInvolved: 'LEGAL_ADMIN' },
              { creditLineStatus: { $in: ['Expired', 'NeedMoreInfo', 'Approved', 'Rejected'] } }
            ]
          };
        } else if (['CFO', 'VIEW_ONLY_ADMIN'].includes(req.user.role)) {
          query = {}; // See all
        }
      }

      const total = await PSPProfile.countDocuments(query);
      const applications = await PSPProfile.find(query)
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      res.json({
        applications,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page)
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/applications/:id
// @desc    Get application by ID (Accessible by all admin roles)
router.get('/applications/:id', async (req, res) => {
  try {
    const application = await PSPProfile.findById(req.params.id)
      .populate('userId', 'name email');

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    const FinancingDocument = require('../models/FinancingDocument');
    const documents = await FinancingDocument.find({ pspId: application.userId._id })

    const appObj = application.toObject();
    appObj.documents = documents;

    res.json(appObj);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/documents/:id
// @desc    Get document metadata + URL (legacy)
router.get('/documents/:id', async (req, res) => {
  try {
    const FinancingDocument = require('../models/FinancingDocument');
    const document = await FinancingDocument.findById(req.params.id);
    if (!document) return res.status(404).json({ message: 'Document not found' });
    res.json({ name: document.name, fileType: document.fileType, fileContent: document.fileContent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/documents/:id/download
// @desc    Proxy-download document from Azure with correct filename
router.get('/documents/:id/download', async (req, res) => {
  try {
    const axios = require('axios');
    const FinancingDocument = require('../models/FinancingDocument');
    const document = await FinancingDocument.findById(req.params.id);
    if (!document) return res.status(404).json({ message: 'Document not found' });

    // Use the original user-provided name (e.g. "Report.xlsx"), NOT the Azure URL filename
    const cleanName = (document.name || 'download').replace(/[^\w.\-\s]/g, '_');

    // Stream the file from Azure
    const fileResponse = await axios.get(document.fileContent, { responseType: 'arraybuffer' });

    // Use RFC 5987 encoding so the browser preserves the exact filename and extension
    res.setHeader('Content-Disposition', `attachment; filename="${cleanName}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`);
    res.setHeader('Content-Type', document.fileType || 'application/octet-stream');
    res.setHeader('Content-Length', fileResponse.data.byteLength);
    res.send(Buffer.from(fileResponse.data));
  } catch (error) {
    console.error('Document download proxy error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/applications/:id/audit-log
// @desc    Get audit logs for a specific application
router.get('/applications/:id/audit-log', async (req, res) => {
  try {
    const AuditLog = require('../models/AuditLog');
    const logs = await AuditLog.find({ entityId: req.params.id })
      .populate('userId', 'name role')
      .sort({ timestamp: -1 });
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- KAM ACTIONS ---

// @route   POST /api/admin/applications/:id/approve-onboarding
// @desc    Approve initial Registration Details for onboarding
router.post('/applications/:id/approve-onboarding', authorizeRoles('KAM'), async (req, res) => {
  try {
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    profile.onboardingStatus = 'PRE_QUAL_APPROVED';
    if (!profile.workflowStep) {
      profile.workflowStep = 'KAM_REVIEW';
    }

    // Track action
    profile.lastAdminAction = {
      role: 'KAM',
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'APPROVE_ONBOARDING',
      timestamp: Date.now()
    };

    await profile.save();

    await notifyAdmins(req.user.userId, {
      type: 'success',
      title: 'PSP Approved for Onboarding',
      message: `KAM approved ${profile.companyName} to proceed with full profile completion.`
    });

    await logAction(req.user.userId, 'APPROVE_ONBOARDING', 'PSPProfile', profile._id, {});

    res.json({ message: 'Approved for onboarding', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


// @route   POST /api/admin/applications/:id/forward-to-cad
router.post('/applications/:id/forward-to-cad', authorizeRoles('KAM'), async (req, res) => {
  try {
    const { notes } = req.body;
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile || profile.workflowStep !== 'KAM_REVIEW') {
      return res.status(400).json({ message: 'Invalid application or stage' });
    }
    profile.workflowStep = 'TERM_SHEET_STAGE';
    profile.creditLineStatus = 'UnderReview';
    if (notes) profile.cadMessage = notes;

    // Track involvement
    if (!profile.rolesInvolved.includes('KAM')) profile.rolesInvolved.push('KAM');
    profile.lastAdminAction = {
      role: 'KAM',
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'FORWARD_TO_CAD',
      timestamp: Date.now()
    };

    await profile.save();
    await notifyAdmins(req.user.userId, {
      type: 'info',
      title: 'Application Forwarded to CAD',
      message: `KAM ${req.user.email} forwarded ${profile.companyName}'s application to CAD.`
    });
    await logAction(req.user.userId, 'FORWARD_TO_CAD', 'PSPProfile', profile._id, { notes });
    res.json({ message: 'Forwarded to CAD', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- CAD ACTIONS ---

// @route   POST /api/admin/applications/:id/score
router.post('/applications/:id/score', authorizeRoles('CAD'), async (req, res) => {
  try {
    const { criteriaScores, totalScore, percentage, rating } = req.body;
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Not found' });

    // Allow scoring if in CAD_REVIEW or if CRO is reviewing but wants CAD to revise
    if (!['CAD_REVIEW', 'CRO_REVIEW', 'CAD_FINAL_APPROVAL', 'CRO_FINAL_CONFIRMATION'].includes(profile.workflowStep)) {
      return res.status(400).json({ message: 'Scoring can only be performed during CAD or CRO review stages' });
    }
    profile.creditScoring = { criteriaScores, totalScore, percentage, rating, updatedAt: Date.now() };
    profile.markModified('creditScoring');

    // Track action
    profile.lastAdminAction = {
      role: req.user.role,
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'UPDATE_SCORE',
      timestamp: Date.now()
    };

    await profile.save();
    await notifyAdmins(req.user.userId, {
      type: 'success',
      title: 'Credit Score Updated',
      message: `CAD updated credit score for ${profile.companyName} to ${rating} (${totalScore} points).`
    });
    await logAction(req.user.userId, 'PERFORM_SCORING', 'PSPProfile', profile._id, { totalScore, rating });
    res.json({ message: 'Score updated', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/ai-scan-report
router.post('/applications/:id/ai-scan-report', authorizeRoles('CAD', 'CRO'), async (req, res) => {
  try {
    const { status, message, credit_score, output_file } = req.body;
    const profile = await PSPProfile.findById(req.params.id);

    if (!profile) {
      return res.status(404).json({ message: 'Not found' });
    }

    const baseUrl = (process.env.AI_REPORT_BLOB_BASE_URL || `${process.env.blobBaseUrl}/${process.env.containerName}`).replace(/\/+$/, '');
    const safeFileName = output_file ? encodeURIComponent(output_file) : '';

    profile.aiScanReport = {
      status: status || '',
      message: message || '',
      creditScore: Number(credit_score || 0),
      outputFile: output_file || '',
      downloadUrl: safeFileName ? `${baseUrl}/${safeFileName}` : '',
      requestedBy: req.user.name || req.user.email || req.user.role,
      requestedByEmail: req.user.email || '',
      startedAt: profile.aiScanReport?.startedAt || null,
      completedAt: Date.now(),
      updatedAt: Date.now()
    };
    profile.markModified('aiScanReport');

    await profile.save();
    await logAction(req.user.userId, 'SAVE_AI_SCAN_REPORT', 'PSPProfile', profile._id, {
      status,
      credit_score,
      output_file
    });

    res.json({ message: 'AI scan report saved', aiScanReport: profile.aiScanReport });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/ai-scan
router.post('/applications/:id/ai-scan', authorizeRoles('CAD', 'CRO'), async (req, res) => {
  try {
    const axios = require('axios');
    const FinancingDocument = require('../models/FinancingDocument');
    const profile = await PSPProfile.findById(req.params.id).populate('userId', 'name email');

    if (!profile) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (profile.aiScanReport?.status === 'SCANNING') {
      return res.status(409).json({ message: 'An AI scan is already running for this application.' });
    }

    const documents = await FinancingDocument.find({ pspId: profile.userId._id });
    const scanDocuments = documents
      .filter((doc) => !!doc.fileContent)
      .map((doc) => ({
        name: doc.name,
        fileContent: doc.fileContent,
        category: doc.category || 'Other'
      }));

    if (scanDocuments.length === 0) {
      return res.status(400).json({ message: 'No documents found for AI Scan' });
    }

    const requestedBy = req.user.name || req.user.email || req.user.role;
    const requestedByEmail = req.user.email || '';
    const requestedByUserId = req.user.userId;
    const requestedByRole = req.user.role;
    const applicationId = profile._id;
    const companyName = profile.companyName;
    const outputFilename = `${(profile.companyName || 'Report').replace(' (Pending Setup)', '').replace(/\s+/g, '_')}_AI_Report.docx`;

    profile.aiScanReport = {
      status: 'SCANNING',
      message: 'Documents are scanning in the background. Once done you will be notified.',
      creditScore: 0,
      outputFile: '',
      downloadUrl: '',
      requestedBy,
      requestedByEmail,
      startedAt: Date.now(),
      completedAt: null,
      updatedAt: Date.now()
    };
    profile.markModified('aiScanReport');

    profile.lastAdminAction = {
      role: req.user.role,
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'START_AI_SCAN',
      timestamp: Date.now()
    };

    await profile.save();
    await logAction(req.user.userId, 'START_AI_SCAN', 'PSPProfile', profile._id, {
      documents: scanDocuments.length
    });

    res.status(202).json({
      message: 'Document scan started. Once done you will be notified.',
      aiScanReport: profile.aiScanReport
    });

    setImmediate(async () => {
      try {
        const payload = {
          documents: scanDocuments,
          facility_size_usd: profile.requestedAmount || profile.preQualRequestedAmount || 1500000,
          apy_percent: parseFloat(profile.requested_Apy) || 10.5,
          tenure_days: profile.requestedDuration || profile.preQualRequestedDuration || 30,
          emergency_withdrawal_days: 7,
          company_name: (profile.companyName || 'N/A').replace(' (Pending Setup)', ''),
          borrower_uen: profile.registrationNo || 'N/A',
          company_description: profile.businessModelDescription || 'N/A',
          company_country: profile.country || 'N/A',
          company_industry: profile.sector || 'Payments',
          facility_type: 'PSP Pre-Funding Line - Revolving',
          group_name: '',
          governing_law: 'Singapore',
          currency: profile.desiredCurrencyValue || 'USD',
          report_date: new Date().toISOString().split('T')[0],
          output_filename: outputFilename
        };

        const aiResponse = await axios.post(
          'https://ai-beta.invoicemate.net/credit-score-auth/upload-docs-and-generate2',
          payload
        );

        const result = aiResponse.data || {};
        const refreshedProfile = await PSPProfile.findById(applicationId).populate('userId', 'name email');

        if (!refreshedProfile) {
          return;
        }

        const baseUrl = (process.env.AI_REPORT_BLOB_BASE_URL || `${process.env.blobBaseUrl}/${process.env.containerName}`).replace(/\/+$/, '');
        const safeFileName = result.output_file ? encodeURIComponent(result.output_file) : '';

        refreshedProfile.aiScanReport = {
          status: 'SUCCESS',
          message: result.message || 'AI scan completed successfully.',
          creditScore: Number(result.credit_score || 0),
          outputFile: result.output_file || '',
          downloadUrl: safeFileName ? `${baseUrl}/${safeFileName}` : '',
          requestedBy,
          requestedByEmail,
          startedAt: refreshedProfile.aiScanReport?.startedAt || Date.now(),
          completedAt: Date.now(),
          updatedAt: Date.now()
        };
        refreshedProfile.markModified('aiScanReport');

        await refreshedProfile.save();
        await createNotification(requestedByUserId, {
          type: 'success',
          title: 'AI Scan Completed',
          message: `AI scan completed for ${companyName}. The report is ready to download.`
        });
        await notifyAdmins(requestedByUserId, {
          type: 'success',
          title: 'AI Scan Completed',
          message: `${requestedByRole} completed the AI scan for ${companyName}.`
        });
        if (requestedByEmail) {
          await sendEmail({
            to: requestedByEmail,
            subject: `AI Scan Completed - ${companyName}`,
            title: 'AI Scan Completed',
            body: `<p>The AI document scan for <strong>${companyName}</strong> has completed successfully.</p>
                   <p>Credit score: <strong>${Number(result.credit_score || 0)}/100</strong></p>
                   <p>The generated report is now available in the application review screen.</p>`
          });
        }
        await logAction(requestedByUserId, 'COMPLETE_AI_SCAN', 'PSPProfile', applicationId, {
          credit_score: result.credit_score,
          output_file: result.output_file
        });
      } catch (scanError) {
        console.error('AI scan background job failed:', scanError);
        const refreshedProfile = await PSPProfile.findById(applicationId).populate('userId', 'name email');
        if (!refreshedProfile) {
          return;
        }

        refreshedProfile.aiScanReport = {
          status: 'FAILED',
          message: scanError.response?.data?.message || scanError.message || 'AI scan failed.',
          creditScore: 0,
          outputFile: '',
          downloadUrl: '',
          requestedBy,
          requestedByEmail,
          startedAt: refreshedProfile.aiScanReport?.startedAt || Date.now(),
          completedAt: Date.now(),
          updatedAt: Date.now()
        };
        refreshedProfile.markModified('aiScanReport');
        await refreshedProfile.save();

        await createNotification(requestedByUserId, {
          type: 'danger',
          title: 'AI Scan Failed',
          message: `AI scan failed for ${companyName}. ${refreshedProfile.aiScanReport.message}`
        });
        if (requestedByEmail) {
          await sendEmail({
            to: requestedByEmail,
            subject: `AI Scan Failed - ${companyName}`,
            title: 'AI Scan Failed',
            body: `<p>The AI document scan for <strong>${companyName}</strong> did not complete successfully.</p>
                   <p>${refreshedProfile.aiScanReport.message}</p>`
          });
        }
        await logAction(requestedByUserId, 'FAIL_AI_SCAN', 'PSPProfile', applicationId, {
          error: refreshedProfile.aiScanReport.message
        });
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/forward-to-cro
router.post('/applications/:id/forward-to-cro', authorizeRoles('CAD'), async (req, res) => {
  try {
    const { notes, draftApproval, requestedAmount, requestedDuration } = req.body;
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile || ['CRO_FINAL_CONFIRMATION', 'FINALIZED'].includes(profile.workflowStep)) {
      return res.status(400).json({ message: 'Invalid stage: Application is already with CRO or Finalized' });
    }
    profile.workflowStep = 'CRO_FINAL_CONFIRMATION';
    if (notes) profile.cadMessage = notes;

    // CAD can override the PSP-supplied requested amount / duration on
    // their final approval. We persist the new values on the profile so
    // CRO sees them and the downstream pool-init parameters use them.
    if (requestedAmount !== undefined && Number.isFinite(Number(requestedAmount))) {
      profile.requestedAmount = Number(requestedAmount);
    }
    if (requestedDuration !== undefined && Number.isFinite(Number(requestedDuration))) {
      profile.requestedDuration = Number(requestedDuration);
    }

    if (draftApproval) {
      profile.draftApproval = draftApproval;
      profile.markModified('draftApproval');
    }

    profile.isCollaborative = true; // Enter collaborative mode once it reaches CRO

    // Track involvement
    if (!profile.rolesInvolved.includes('CAD')) profile.rolesInvolved.push('CAD');
    profile.lastAdminAction = {
      role: 'CAD',
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'FORWARD_TO_CRO',
      timestamp: Date.now()
    };

    await profile.save();
    await notifyAdmins(req.user.userId, {
      type: 'info',
      title: 'Application Forwarded to CRO',
      message: `CAD forwarded ${profile.companyName}'s application to CRO for final approval.`
    });
    await logAction(req.user.userId, 'FORWARD_TO_CRO', 'PSPProfile', profile._id, { notes });
    res.json({ message: 'Application forwarded to CRO', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/forward-to-term-sheet
router.post('/applications/:id/forward-to-term-sheet', authorizeRoles('CAD'), async (req, res) => {
  try {
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile || profile.workflowStep !== 'CAD_REVIEW') return res.status(400).json({ message: 'Invalid stage' });
    profile.workflowStep = 'TERM_SHEET_STAGE';
    profile.lastAdminAction = {
      role: 'CAD',
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'FORWARD_TO_TERM_SHEET',
      timestamp: Date.now()
    };
    await profile.save();
    await logAction(req.user.userId, 'FORWARD_TO_TERM_SHEET', 'PSPProfile', profile._id, {});
    res.json({ message: 'Moved to Term Sheet stage', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/share-agreement
router.post('/applications/:id/share-agreement', authorizeRoles('CAD', 'LEGAL_ADMIN'), async (req, res) => {
  try {
    const { type, url, notes } = req.body;
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    let finalUrl = url;

    // If it's a base64 string, upload to Azure Blob Storage
    if (url && url.startsWith('data:')) {
      const [meta, base64String] = url.split(";base64,");
      const mimeType = meta.replace("data:", "");
      const extension = mimeType.split('/')[1] || 'pdf';
      const fileName = `${Date.now()}-${type}.${extension}`;

      await uploadBase64Attachment(
        process.env.containerName,
        `uploads/agreements/${fileName}`,
        base64String
      );

      finalUrl = `${process.env.blobBaseUrl}/${process.env.containerName}/uploads/agreements/${fileName}`;
    }

    if (type === 'termSheet') {
      profile.termSheet = { url: finalUrl, status: 'Shared', sharedAt: Date.now() };
    } else if (type === 'techAgreement') {
      profile.techAgreement = { url: finalUrl, status: 'Shared', sharedAt: Date.now() };

      // Update user segment if provided (moved from sign-up to tech integration point)
      if (req.body.segmentId) {
        const User = require('../models/User');
        await User.findByIdAndUpdate(profile.userId, { segment: req.body.segmentId });
      }
    } else if (type === 'facilityAgreement') {
      profile.facilityAgreement = { url: finalUrl, status: 'Shared', sharedAt: Date.now(), legalAdmin: req.user.name || req.user.email };
      profile.workflowStep = 'CAD_FACILITY_REVIEW'; // Move to CAD after Legal adds it
    } else {
      return res.status(400).json({ message: 'Invalid agreement type' });
    }

    profile.lastAdminAction = {
      role: req.user.role,
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: `SHARE_${type.toUpperCase()}`,
      timestamp: Date.now()
    };

    if (!profile.rolesInvolved.includes(req.user.role)) profile.rolesInvolved.push(req.user.role);
    await profile.save();

    // Notify PSP
    const agreementLabel = type === 'termSheet' ? 'Term Sheet' : (type === 'techAgreement' ? 'Technical Agreement' : 'Facility Agreement');
    await notifyUserWithEmail(profile.userId, {
      type: 'info',
      title: `${agreementLabel} Shared`,
      message: `The admin has shared the ${agreementLabel} for your review and approval.`,
      actionLink: `${process.env.FRONTEND_URL}/psp/agreement-onboarding`,
      actionText: 'View Agreement'
    });

    // If Legal shared Facility Agreement, notify CAD
    if (type === 'facilityAgreement') {
      const cadAdmins = await User.find({ role: 'CAD' });
      for (const cad of cadAdmins) {
        await notifyUserWithEmail(cad._id, {
          type: 'info',
          title: 'Facility Agreement Submitted by Legal',
          message: `Legal Admin ${req.user.name || req.user.email} has submitted the Facility Agreement for ${profile.companyName}. It has been shared with the PSP for approval.`,
          actionLink: `${process.env.FRONTEND_URL}/admin/applications/${profile._id}`,
          actionText: 'View Application'
        });
      }
    }

    await logAction(req.user.userId, `SHARE_${type.toUpperCase()}`, 'PSPProfile', profile._id, { url, notes });
    res.json({ message: `${type} shared successfully`, profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/negotiate
router.post('/applications/:id/negotiate', async (req, res) => {
  try {
    const { text, isHiddenFromPSP } = req.body;
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    profile.agreementNotes.push({
      role: req.user.role,
      adminName: req.user.name || req.user.email,
      text,
      isHiddenFromPSP: isHiddenFromPSP || false,
      timestamp: Date.now()
    });

    await profile.save();

    // Notify PSP if not hidden
    if (!isHiddenFromPSP) {
      await notifyUserWithEmail(profile.userId, {
        type: 'info',
        title: 'New Negotiation Note',
        message: `Admin ${req.user.name || req.user.email} has added a new note regarding your agreement.`,
        actionLink: `${process.env.FRONTEND_URL}/psp/agreement-onboarding`,
        actionText: 'View Note'
      });
    }

    res.json({ message: 'Note added', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/move-step
router.post('/applications/:id/move-step', authorizeRoles('CAD', 'CRO', 'KAM', 'LEGAL_ADMIN'), async (req, res) => {
  try {
    const { nextStep, notes } = req.body;
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    profile.workflowStep = nextStep;
    if (notes) profile.cadMessage = notes;
    if (req.body.facilityAgreementStatus && profile.facilityAgreement) {
      profile.facilityAgreement.status = req.body.facilityAgreementStatus;
    }

    profile.lastAdminAction = {
      role: req.user.role,
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: `MOVE_TO_${nextStep}`,
      timestamp: Date.now()
    };

    //Add user to roles Involved
    if (!profile.rolesInvolved.includes(req.user.role)) profile.rolesInvolved.push(req.user.role);

    await profile.save();

    // Trigger role-specific notifications based on the next step
    if (nextStep === 'LEGAL_REVIEW') {
      const legalAdmins = await User.find({ role: 'LEGAL_ADMIN' });
      for (const legal of legalAdmins) {
        await notifyUserWithEmail(legal._id, {
          type: 'info',
          title: 'Legal Review Required',
          message: `Application for ${profile.companyName} is now in Legal Review. Please submit the facility agreement.`,
          actionLink: `${process.env.FRONTEND_URL}/admin/applications/${profile._id}`,
          actionText: 'Start Review'
        });
      }
    } else if (nextStep === 'KAM_FACILITY_REVIEW') {
      const kamAdmins = await User.find({ role: 'KAM' });
      for (const kam of kamAdmins) {
        await notifyUserWithEmail(kam._id, {
          type: 'info',
          title: 'KAM Facility Review Required',
          message: `CAD has submitted the facility agreement for ${profile.companyName}. Please perform KAM review.`,
          actionLink: `${process.env.FRONTEND_URL}/admin/applications/${profile._id}`,
          actionText: 'Review Agreement'
        });
      }
    } else if (nextStep === 'CAD_FACILITY_REVIEW') {
      const cadAdmins = await User.find({ role: 'CAD' });
      for (const cad of cadAdmins) {
        await notifyUserWithEmail(cad._id, {
          type: 'info',
          title: 'CAD Facility Review Required',
          message: `Facility agreement for ${profile.companyName} has been submitted for CAD review.`,
          actionLink: `${process.env.FRONTEND_URL}/admin/applications/${profile._id}`,
          actionText: 'Review Agreement'
        });
      }
    }

    await logAction(req.user.userId, `MOVE_TO_${nextStep}`, 'PSPProfile', profile._id, { notes });
    res.json({ message: `Moved to ${nextStep}`, profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/upload-document
// @desc    Upload documents as an admin (e.g. CAD uploading Review Report)
router.post('/applications/:id/upload-document', async (req, res) => {
  try {
    const { category, documentType, name, fileType, fileSize, fileContent } = req.body;
    const FinancingDocument = require('../models/FinancingDocument');

    const profile = await PSPProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    const uploadedBy = req.user?.name || req.user?.email || 'Admin';
    const uploadedByRole = req.user?.role || 'ADMIN';

    let finalFileContent = fileContent;

    // Handle base64 upload to Azure
    if (fileContent && fileContent.startsWith('data:')) {
      const [meta, base64String] = fileContent.split(";base64,");
      const mimeType = meta.replace("data:", "");

      // Generate safe file name
      const safeName = (name || 'admin_doc').replace(/\s+/g, "_");
      const fileName = `${Date.now()}-${safeName}`;

      await uploadBase64Attachment(
        process.env.containerName,
        `uploads/documents/${fileName}`,
        base64String
      );

      finalFileContent = `${process.env.blobBaseUrl}/${process.env.containerName}/uploads/documents/${fileName}`;
    }

    const newDoc = new FinancingDocument({
      pspId: profile.userId,
      category: category || 'Credit Report',
      documentType: documentType || 'Other',
      name,
      fileType,
      fileSize,
      fileContent: finalFileContent,
      uploadedBy,
      uploadedByRole,
      isAdminUpload: true,
      uploadedAt: new Date()
    });

    await newDoc.save();

    // Track involvement & action
    if (!profile.rolesInvolved.includes(req.user.role)) {
      profile.rolesInvolved.push(req.user.role);
      await profile.save();
    }
    await logAction(req.user.userId, 'UPLOAD_ADMIN_DOC', 'PSPProfile', profile._id, {
      name,
      category: newDoc.category,
      uploadedBy,
      uploadedByRole
    });

    res.json({ message: 'Document uploaded successfully', document: newDoc });
  } catch (error) {
    console.error('Admin upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


// --- CRO ACTIONS ---

// @route   POST /api/admin/applications/:id/approve
router.post('/applications/:id/approve', authorizeRoles('CRO', 'CAD'), async (req, res) => {
  try {
    const {
      creditLine,          // Total approved credit (before reserve)
      creditReserve,       // Locked portion
      approvedDuration,    // Tenure in days
      utilizedBips,        // bps/day on utilized
      unutilizedBips,      // bps on TWA unutilized
      penaltyBips,         // bps/day after grace period
      penaltyGracePeriodHours, // hours (default 24)
      pauseAfterDays,      // days (default 3)
      notes,
      drawdown_limit,
      facility_tenure,
      drawdown_tenor,
      penalty_rate,
      requested_Apy,
      psp_identifie,
      minUtilizationRate
    } = req.body;

    const profile = await PSPProfile.findById(req.params.id).populate('userId');
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    // Handle workflow transitions before final deployment
    if (req.user.role === 'CRO' && profile.workflowStep === 'CRO_REVIEW') {
      profile.workflowStep = 'LEGAL_REVIEW';
      await profile.save();

      // Notify Legal
      const legalAdmins = await User.find({ role: 'LEGAL_ADMIN' });
      for (const legal of legalAdmins) {
        await notifyUserWithEmail(legal._id, {
          type: 'info',
          title: 'Legal Review Required',
          message: `CRO has approved ${profile.companyName}'s application. It is now in Legal Review stage.`,
          actionLink: `${process.env.FRONTEND_URL}/admin/applications/${profile._id}`,
          actionText: 'Start Review'
        });
      }

      return res.json({ message: 'Application approved by CRO. Moving to Legal Review.', profile });
    }

    if (req.user.role === 'CRO' && profile.workflowStep === 'CRO_FACILITY_REVIEW') {
      profile.workflowStep = 'CAD_FACILITY_REVIEW';
      await profile.save();
      return res.json({ message: 'Facility agreement approved by CRO. Moving to CAD Facility Review.', profile });
    }

    if (req.user.role === 'CAD' && profile.workflowStep === 'CAD_FACILITY_REVIEW') {
      profile.workflowStep = 'PSP_FACILITY_APPROVAL';
      await profile.save();
      return res.json({ message: 'Facility agreement approved by CAD. Moving to PSP Approval.', profile });
    }

    if (req.user.role === 'CRO' && profile.workflowStep === 'CRO_FINAL_CONFIRMATION') {
      // CRO performs final confirmation. Under the Solana model the on-chain
      // pool is initialized by an admin-signed `initialize_pool` tx from the
      // admin portal, not by the server. This handler captures all approval
      // parameters, derives the PDAs that the future pool will live at, and
      // transitions the workflow to AWAITING_POOL_INIT so the admin dashboard
      // surfaces a "Initialize Pool" action.

      // PSP must have bound a Solana wallet — that's what gets baked into the
      // pool PDA seed. Without it we can't even pre-derive addresses.
      if (!profile.solanaWallet) {
        return res.status(409).json({
          message: 'PSP has not bound a Solana wallet yet — cannot derive pool PDA',
        });
      }

      // Validate required form inputs upfront so missing fields surface as
      // 400 with a specific message instead of throwing on `save()` or
      // `new Date(NaN)` further down.
      const numericCreditLine = Number(creditLine);
      const numericDuration = Number(approvedDuration);
      if (!Number.isFinite(numericCreditLine) || numericCreditLine <= 0) {
        return res.status(400).json({
          message: 'creditLine is required and must be a positive number',
          received: creditLine,
        });
      }
      if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
        return res.status(400).json({
          message: 'approvedDuration is required and must be a positive number of days',
          received: approvedDuration,
        });
      }

      const drawableLimit = numericCreditLine - Number(creditReserve || 0);

      // The pool address is not known until the on-chain admin signs
      // factory.createPool(); evmIndexer matches the resulting PoolCreated
      // event back to this profile by facilityId.
      profile.facilityId = profile.facilityId || 1;

      profile.creditLineStatus = 'Approved';
      profile.workflowStep = 'AWAITING_POOL_INIT';
      profile.approvedAmount = drawableLimit;            // Backward compat: drawable limit
      profile.approvedCreditLine = numericCreditLine;    // Full credit before reserve
      profile.creditReserve = Number(creditReserve || 0);
      profile.approvedDuration = numericDuration;
      profile.utilizedBips = utilizedBips || 0;
      profile.unutilizedBips = unutilizedBips || 0;
      profile.penaltyBips = penaltyBips || 0;
      profile.penaltyGracePeriodHours = penaltyGracePeriodHours || 24;
      profile.pauseAfterDays = pauseAfterDays || 3;
      profile.creditLineStartDate = new Date();
      profile.creditLineEndDate = new Date(Date.now() + numericDuration * 86400000);
      profile.cadMessage = notes;

      // Defa specific fields
      profile.drawdown_limit = drawdown_limit;
      profile.facility_tenure = facility_tenure;
      profile.drawdown_tenor = drawdown_tenor;
      profile.penalty_rate = penalty_rate;
      profile.requested_Apy = requested_Apy;
      profile.psp_identifie = psp_identifie;
      profile.minUtilizationRate = minUtilizationRate;

      // Track involvement & action
      if (!profile.rolesInvolved.includes('CRO')) profile.rolesInvolved.push('CRO');
      profile.lastAdminAction = {
        role: 'CRO',
        adminName: req.user.name || req.user.email,
        adminEmail: req.user.email,
        action: 'APPROVE',
        timestamp: Date.now()
      };

      await profile.save();
      await notifyAdmins(req.user.userId, {
        type: 'success',
        title: 'Application Approved',
        message: `CRO approved ${profile.companyName}'s credit line: $${creditLine} (reserve: $${creditReserve || 0}, drawable: $${drawableLimit}).`
      });
      await createNotification(profile.userId._id, {
        type: 'success',
        title: 'Application Approved',
        message: `Your application for a Credit Line has been Approved.`
      });
      await logAction(req.user.userId, 'APPROVE_APPLICATION', 'PSPProfile', profile._id, {
        creditLine, creditReserve, drawableLimit, approvedDuration
      });

      // 4. Notify PSP via Email about Approval. The on-chain pool is created
      //    when the admin signs `initialize_pool`; the PSP can then watch the
      //    pool funding state from their dashboard.
      await sendEmail({
        to: profile.userId.email,
        subject: "Financing Limit Approved!",
        title: "Application Approved",
        body: `
        <p>Congratulations! Your application for a financing limit has been <strong>Approved</strong>.</p>
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0;"><strong>Approved Credit Line:</strong> $${creditLine.toLocaleString()}</p>
          <p style="margin: 0;"><strong>Drawable Limit:</strong> $${drawableLimit.toLocaleString()}</p>
          <p style="margin: 0;"><strong>Duration:</strong> ${approvedDuration} Days</p>
        </div>
        <p>Your on-chain pool will be initialized shortly and opened to lenders for funding. You'll receive another notification once the pool is active and you can start drawing.</p>
        ${notes ? `<div style="margin-top: 20px; padding: 15px; border-left: 4px solid #592764; background: #f8f9fa;"><strong>Admin Notes:</strong><p>${notes}</p></div>` : ""}
      `,
        actionText: "Go to Dashboard",
        actionLink: `${process.env.FRONTEND_URL}/psp/dashboard`,
      });

      res.json({ message: 'Final approval confirmed by CRO. Awaiting pool initialization.', profile });
    } else {
      return res.status(400).json({ message: 'Invalid stage for approval action or unauthorized role' });
    }


  } catch (error) {
    console.error('[admin/approve] error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? (error.message || String(error)) : undefined,
      });
    }
  }
});

// @route   POST /api/admin/applications/:id/reject
router.post('/applications/:id/reject', authorizeRoles('CRO'), async (req, res) => {
  try {
    const { notes } = req.body;
    const profile = await PSPProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Not found' });
    profile.creditLineStatus = 'Rejected';
    profile.workflowStep = 'FINALIZED';

    // Track involvement & action
    if (!profile.rolesInvolved.includes('CRO')) profile.rolesInvolved.push('CRO');
    profile.lastAdminAction = {
      role: 'CRO',
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'REJECT',
      timestamp: Date.now()
    };

    await profile.save();
    await notifyAdmins(req.user.userId, {
      type: 'danger',
      title: 'Application Rejected',
      message: `CRO rejected ${profile.companyName}'s application.`
    });
    await logAction(req.user.userId, 'REJECT_APPLICATION', 'PSPProfile', profile._id, { notes });

    // Send Rejection Email to PSP
    const userToNotify = await User.findById(profile.userId);
    if (userToNotify) {
      await sendEmail({
        to: userToNotify.email,
        subject: "Financing Limit Application Status",
        title: "Application Rejected",
        body: `
          <p>We regret to inform you that your financing limit application for <strong>${profile.companyName}</strong> has been rejected at this time.</p>
          ${notes ? `<div style="margin-top: 20px; padding: 15px; border-left: 4px solid #ef4444; background: #fef2f2; color: #991b1b;"><strong>Reason/Notes:</strong><p>${notes}</p></div>` : ""}
          <p>If you have any questions, please contact our support team.</p>
        `,
        actionText: "Contact Support",
        actionLink: "mailto:support@paymate.com",
      });
    }

    res.json({ message: 'Application rejected', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/applications/:id/request-info
router.post('/applications/:id/request-info', authorizeRoles('KAM', 'CAD', 'CRO'), async (req, res) => {
  try {
    const { notes } = req.body;
    const profile = await PSPProfile.findById(req.params.id).populate('userId');
    if (!profile) return res.status(404).json({ message: 'Not found' });
    profile.creditLineStatus = 'NeedMoreInfo';
    // DON'T change workflowStep - maintain shared state as per user request
    if (notes) profile.cadMessage = notes;

    // Track involvement & action
    if (!profile.rolesInvolved.includes(req.user.role)) profile.rolesInvolved.push(req.user.role);
    profile.lastAdminAction = {
      role: req.user.role,
      adminName: req.user.name || req.user.email,
      adminEmail: req.user.email,
      action: 'REQUEST_INFO',
      timestamp: Date.now()
    };

    await profile.save();

    // Notify PSP
    createNotification(profile.userId._id, {
      type: 'warning',
      title: 'Action Required: Application Review',
      message: `Admins have requested more information: ${notes}`
    });

    // Notify all Admins
    await notifyAdmins(req.user.userId, {
      type: 'warning',
      title: 'Information Requested (Revision)',
      message: `${req.user.role} requested more information/revision for ${profile.companyName}.`
    });

    await logAction(req.user.userId, 'REQUEST_INFO', 'PSPProfile', profile._id, { notes });

    // Send "More Info Needed" Email
    await sendEmail({
      to: profile.userId.email,
      subject: "Action Required: Financing Limit Application",
      title: "More Information Requested",
      body: `
        <p>Our review team requires additional information regarding your financing limit application for <strong>${profile.companyName}</strong>.</p>
        <div style="margin-top: 20px; padding: 15px; border-left: 4px solid #f59e0b; background: #fffbeb; color: #92400e;">
          <strong>Message from Review Team:</strong>
          <p>${notes}</p>
        </div>
        <p>Please log in to your dashboard and update the requested information to proceed with the review.</p>
      `,
      actionText: "Update Application",
      actionLink: `${process.env.FRONTEND_URL}/psp/apply-limit`,
    });

    res.json({ message: 'Info requested', profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


// @route   GET /api/admin/all-financings
// @desc    Get all financings across all PSPs with calculations
// @access  Private (Admins only)
router.get('/all-financings', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, pspId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {
      status: { $in: ['Validated', 'Disbursed', 'Overdue', 'PenaltyApplied', 'RepaymentPending', 'ProcessingRepayment'] }
    };

    if (pspId && pspId !== 'all') {
      query.pspId = pspId;
    }

    if (search) {
      // Find PSPs matching search to include them in filtering
      const matchingPSPs = await PSPProfile.find({ companyName: { $regex: search, $options: 'i' } }).select('_id');
      const pspIds = matchingPSPs.map(p => p._id);

      query.$or = [
        { orderReference: { $regex: search, $options: 'i' } },
        { pspId: { $in: pspIds } }
      ];
    }

    const total = await FinancingRequest.countDocuments(query);
    const financings = await FinancingRequest.find(query)
      .populate('pspId', 'companyName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get unique PSPs list for dropdown
    const psps = await PSPProfile.find({
      _id: { $in: await FinancingRequest.distinct('pspId', { status: { $in: ['Pending', 'Validated', 'Disbursed', 'Overdue', 'PenaltyApplied'] } }) }
    }).select('companyName');

    // Calculate exposure summary (on all matches, not just paginated)
    const allMatching = await FinancingRequest.find(query);
    const exposureResult = calculateTotalExposure(allMatching);
    const summary = {
      ...exposureResult,
      totalExposure: Math.round((exposureResult.totalAmount + exposureResult.totalInterest) * 100) / 100
    };

    res.json({
      financings,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      psps,
      summary
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/order-book
// @desc    Get all orderbook data from efficient deposits
// @access  Private (Admins only)
router.get('/order-book', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, pspId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {};

    if (pspId && pspId !== 'all') {
      query['metadata.partnerId'] = pspId;
    }

    if (search) {
      // Find PSPs matching search to include them in filtering
      const matchingPSPs = await PSPProfile.find({ companyName: { $regex: search, $options: 'i' } }).select('userId');
      const pspUserIds = matchingPSPs.map(p => p.userId);

      query.$or = [
        { 'payload.unique_id': { $regex: search, $options: 'i' } },
        { 'payload.user': { $regex: search, $options: 'i' } },
        { 'metadata.partnerId': { $in: pspUserIds } }
      ];
    }

    const total = await EfficientDeposit.countDocuments(query);
    const deposits = await EfficientDeposit.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Efficiently get partner names
    const partnerIds = [...new Set(deposits.map(d => d.metadata.partnerId))];
    const partners = await PSPProfile.find({ userId: { $in: partnerIds } }).select('userId companyName');
    const partnerMap = partners.reduce((acc, p) => {
      acc[p.userId.toString()] = p.companyName;
      return acc;
    }, {});

    const formattedDeposits = deposits.map(d => ({
      _id: d._id,
      referenceId: d.payload.unique_id,
      customerName: d.payload.user,
      amount: d.payload.total_amount,
      currency: d.payload.currency,
      type: d.payload.type,
      status: d.status,
      createdAt: d.payload.created_at || d.createdAt,
      companyName: partnerMap[d.metadata.partnerId?.toString()] || 'Unknown'
    }));

    res.json({
      orders: formattedDeposits,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/repayment-history
// @desc    Get repayment history with filters
// @access  Private (Admins only)
router.get('/repayment-history', async (req, res) => {
  try {
    const { startDate, endDate, pspId, search, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = { status: 'Completed' };

    // Apply date filters
    if (startDate || endDate) {
      query.repaymentDate = {};
      if (startDate) query.repaymentDate.$gte = new Date(startDate);
      if (endDate) query.repaymentDate.$lte = new Date(endDate);
    }

    // Apply PSP filter
    if (pspId && pspId !== 'all') {
      query.pspId = pspId;
    }

    if (search) {
      const matchingPSPs = await PSPProfile.find({ companyName: { $regex: search, $options: 'i' } }).select('_id');
      const pspIds = matchingPSPs.map(p => p._id);

      // We also need to search by order reference, but it's on the FinancingRequest model.
      // So we first find financing requests matching search.
      const matchingRequests = await FinancingRequest.find({ orderReference: { $regex: search, $options: 'i' } }).select('_id');
      const requestIds = matchingRequests.map(r => r._id);

      query.$or = [
        { pspId: { $in: pspIds } },
        { financingRequestId: { $in: requestIds } }
      ];
    }

    const total = await RepaymentRecord.countDocuments(query);
    const repayments = await RepaymentRecord.find(query)
      .populate('pspId', 'companyName')
      .populate('financingRequestId', 'orderReference receiptUrl disbursedAt dueDate')
      .sort({ repaymentDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get unique PSPs list for dropdown
    const psps = await PSPProfile.find({
      _id: { $in: await RepaymentRecord.distinct('pspId', { status: 'Completed' }) }
    }).select('companyName');

    // Calculate summary (on all matches)
    const allRepayments = await RepaymentRecord.find(query);
    const totalPrincipal = allRepayments.reduce((sum, r) => sum + (r.principalAmount || 0), 0);
    const totalInterestCollected = allRepayments.reduce((sum, r) => sum + (r.actualInterestPaid || 0), 0);

    const formattedRepayments = repayments.map(r => ({
      _id: r._id,
      psp: r.pspId?.companyName || 'Unknown',
      pspProfileId: r.pspId?._id,
      orderReference: r.financingRequestId?.orderReference || 'N/A',
      // FinancingRequest._id (= drawdown id). Needed by the FE so it can
      // ask for THIS specific drawdown's lifecycle when an orderReference
      // has multiple draws under it (revolving credit).
      disbursedAt: r.financingRequestId?.disbursedAt || 'N/A',
      dueDate: r.financingRequestId?.dueDate || 'N/A',
      financingRequestId: r.financingRequestId?._id || r.financingRequestId || null,
      principal: r.principalAmount,
      expectedInterest: r.expectedInterest,
      actualInterest: r.actualInterestPaid,
      variance: r.interestVariance,
      variancePercentage: r.variancePercentage,
      repaymentDate: r.repaymentDate,
      txHash: r.txHash,
      receiptUrl: r.financingRequestId?.receiptUrl || null
    }));

    res.json({
      repayments: formattedRepayments,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      psps,
      summary: {
        totalRepayments: total,
        totalPrincipal: Math.round(totalPrincipal * 100) / 100,
        totalInterestCollected: Math.round(totalInterestCollected * 100) / 100
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


// --- USER MANAGEMENT ---

// @route   GET /api/admin/users
// @desc    Get all PSP users with their profiles
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({ role: 'PSP' }).select('-passwordHash').sort({ createdAt: -1 });

    // Map profiles to users
    const userList = await Promise.all(users.map(async (u) => {
      const profile = await PSPProfile.findOne({ userId: u._id }).select('companyName creditLineStatus workflowStep approvedAmount');
      return {
        ...u.toObject(),
        profile: profile || null
      };
    }));

    res.json(userList);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/users/:id
// @desc    Get user detail with full profile
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const profile = await PSPProfile.findOne({ userId: user._id });
    const FinancingDocument = require('../models/FinancingDocument');
    const documents = profile ? await FinancingDocument.find({ pspId: profile._id }).select('-fileContent') : [];

    res.json({
      user,
      profile,
      documents
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- STATS ---
router.get('/stats', async (req, res) => {
  try {
    const pendingKAM = await PSPProfile.countDocuments({ workflowStep: 'KAM_REVIEW' });
    const pendingCAD = await PSPProfile.countDocuments({ workflowStep: 'CAD_REVIEW' });
    const pendingCRO = await PSPProfile.countDocuments({ workflowStep: 'CRO_REVIEW' });
    const activeLines = await PSPProfile.countDocuments({ creditLineStatus: 'Approved' });
    const rejectedCount = await PSPProfile.countDocuments({ creditLineStatus: 'Rejected' });

    res.json({
      pendingKAM,
      pendingCAD,
      pendingCRO,
      activeLines,
      rejectedApplications: rejectedCount,
      pendingApplications: pendingCRO // For CRO dashboard compatibility
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/alerts
// @desc    Get critical alerts (Overdue and Due Soon)
router.get('/alerts', async (req, res) => {
  try {
    const tomorrow = new Date();
    tomorrow.setHours(tomorrow.getHours() + 24);

    const overdue = await FinancingRequest.find({
      status: { $in: ['Overdue', 'PenaltyApplied'] }
    }).populate('pspId', 'companyName');

    const dueSoon = await FinancingRequest.find({
      status: 'Disbursed',
      dueDate: { $gte: new Date(), $lt: tomorrow }
    }).populate('pspId', 'companyName');

    res.json({
      overdueCount: overdue.length,
      overdueList: overdue.map(o => ({
        id: o._id,
        psp: o.pspId?.companyName,
        amount: o.amount,
        dueDate: o.dueDate,
        reference: o.orderReference
      })),
      dueSoonCount: dueSoon.length,
      dueSoonList: dueSoon.map(o => ({
        id: o._id,
        psp: o.pspId?.companyName,
        amount: o.amount,
        dueDate: o.dueDate,
        reference: o.orderReference
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POOL MANAGEMENT ROUTES (CRO / Admin)
// ═══════════════════════════════════════════════════════════════════════════

const RepaymentRecord = require('../models/RepaymentRecord');
const FinancingRequest = require('../models/FinancingRequest');
const EfficientDeposit = require('../models/EfficientDeposit');
const { calculateTotalExposure } = require('../services/interestCalculator');
const Segment = require('../models/Segment');
const { default: axios } = require('axios');

// ─── Pool management routes removed in Solana migration ────────────────
//
// The following endpoints existed for the EVM model where the admin pulled
// PSP repayments into the pool and recorded fees. In the Solana model:
//   - PSPs repay directly via `repay` (signs their own tx).
//   - Fees (util / commit / penalty) are computed automatically by the
//     program; there is no manual `recordFeeRepayment`.
//   - There is no `pausePool` instruction. Drawdowns are blocked
//     automatically when an existing drawdown is past tenor+grace+penalty.
//   - Time-weighted unutilized fee is replaced by per-day commitment fee
//     using peak-outstanding-during-day, accrued lazily on every event.
//
// Removed routes (any frontend caller should be updated to read on-chain
// state via the indexer or call new Solana endpoints once Phase 3 ships):
//   POST /pools/:id/replenish
//   POST /pools/:id/replenish-fees
//   POST /pools/:id/trigger-penalty
//   POST /pools/:id/pause
//   POST /pools/:id/unpause
//   GET  /pools/:id/compute-unutilized-fee

// @route   GET /api/admin/financing/pending
// @desc    Get all pending financing requests for CAD review
router.get('/financing/pending', authorizeRoles('CAD', 'CRO'), async (req, res) => {
  try {
    const pending = await FinancingRequest.find({ status: 'Pending' })
      .populate('pspId', 'companyName approvedAmount currentlyUtilized')
      .sort({ createdAt: -1 });
    res.json(pending);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/financing/:id/validate
// @desc    Perform validation checks for a financing request and return results
router.get('/financing/:id/validate', authorizeRoles('CAD'), async (req, res) => {
  try {
    const request = await FinancingRequest.findById(req.params.id)
      .populate({
        path: 'pspId',
        populate: { path: 'userId' }
      });

    if (!request) return res.status(404).json({ message: 'Request not found' });

    const psp = request.pspId;
    const validations = {
      hasCreditLine: psp.creditLineStatus === 'Approved' && psp.approvedAmount > 0,
      orderExists: false,
      sufficientCredit: false,
      notAlreadyFinanced: false,
      details: {
        availableCredit: (psp.approvedAmount || 0) - (psp.currentlyUtilized || 0),
        requestedAmount: request.amount,
        orderReference: request.orderReference
      }
    };

    // Check Order
    const order = await EfficientDeposit.findOne({
      "metadata.partnerId": psp.userId._id,
      "payload.unique_id": request.orderReference
    });

    const segment = await User.findOne({ _id: psp.userId }).populate('segment');

    if (segment?.segment?.features?.thirdPartyApi) {
      try {
        const authlogin = await axios.post(segment?.segment?.flowConfig?.authApi, {
          email: process.env.EFEICENT_USERNAME,
          password: process.env.EFEICENT_PASSWORD
        })
        const deposits = await axios.get(
          segment?.segment?.flowConfig.apiEndpoint,
          {
            params: { skip: 0, limit: 1000 },
            headers: {
              Authorization: `Bearer ${authlogin?.data?.data?.user?.access_token}`
            }
          }
        );
        validations.orderExists = deposits?.data?.data?.deposits.some((item) => item.unique_id === request.orderReference);
        validations.notAlreadyFinanced = order?.status !== 'Financed';
      } catch (error) {
        console.log("🚀 ~ error:", error.response.data)
        validations.orderExists = false;
        validations.notAlreadyFinanced = false;
      }
    } else {
      validations.orderExists = order?.payload?.unique_id === request?.orderReference;
      validations.notAlreadyFinanced = order?.status !== 'Financed';
    }

    // Check Credit
    validations.sufficientCredit = request.amount <= validations.details.availableCredit;

    res.json(validations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/financing/:id/confirm
// @desc    CAD confirms financing request manually (off-chain)
router.post('/financing/:id/confirm', authorizeRoles('CAD'), async (req, res) => {
  try {
    const request = await FinancingRequest.findById(req.params.id).populate('pspId');
    if (!request || request.status !== 'Pending') {
      return res.status(400).json({ message: 'Invalid request or already processed' });
    }

    const psp = request.pspId;

    // 1. Update PSP Utilization
    psp.currentlyUtilized = (psp.currentlyUtilized || 0) + request.amount;
    await psp.save();

    // 2. Update Financing Request Status
    const disburseDate = new Date();
    disburseDate.setHours(0, 0, 0, 0);
    const tenor = Number(request.drawdownTenor) || Number(psp.drawdown_tenor) || 30;
    
    request.status = 'Disbursed';
    request.disbursedAt = disburseDate;
    request.validatedAt = new Date();
    request.dueDate = new Date(disburseDate.getTime() + (tenor - 1) * 86400000);
    // Copy interest rates at time of disbursement
    request.utilizedBips = psp.utilizedBips;
    request.unutilizedBips = psp.unutilizedBips;
    request.approvedAmount = psp.approvedAmount;

    // Optional on-chain disbursement details from the CAD's confirm dialog.
    // If the CAD paste the Safe transaction's hash, we record it so the
    // SAFE-Observer can match the disbursement event by exact tx_hash instead
    // of the heuristic amount+timing fallback.
    const bodyTxHash = typeof req.body?.txHash === 'string' ? req.body.txHash.trim() : '';
    if (/^0x[0-9a-fA-F]+$/.test(bodyTxHash)) {
      request.txHash = bodyTxHash;
    }

    await request.save();

    // 3. Mark Order as Financed in EfficientDeposit
    await EfficientDeposit.findOneAndUpdate(
      { "payload.unique_id": request.orderReference },
      { status: 'Financed' }
    );

    // 4. Notify PSP
    await createNotification(psp.userId, {
      title: 'Financing Disbursed',
      message: `Your request for order ${request.orderReference} ($${request.amount.toLocaleString()}) has been approved and disbursed.`,
      type: 'success'
    });

    await logAction(req.user.userId, 'CONFIRM_DISBURSEMENT_OFFCHAIN', 'FinancingRequest', request._id, {
      amount: request.amount,
      orderReference: request.orderReference
    });

    res.json({ message: 'Financing confirmed and credit utilization updated.', request });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/repayments/pending
// @desc    Get all pending repayment confirmation requests
router.get('/repayments/pending', authorizeRoles('CAD'), async (req, res) => {
  try {
    const pending = await RepaymentRecord.find({ status: 'Pending Confirmation' })
      .populate('pspId', 'companyName')
      .populate('financingRequestId', 'orderReference amount status disbursedAt dueDate')
      .sort({ createdAt: -1 });

    res.json(pending);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/repayments/:id/confirm
// @desc    CAD confirms repayment receipt. Accepts the on-chain txHash so the
//          observer can do an exact tx_hash match instead of relying on the
//          fragile amount+timing heuristic. Body: { txHash?, blockNumber? }
router.post('/repayments/:id/confirm', authorizeRoles('CAD'), async (req, res) => {
  try {
    const repaymentRecord = await RepaymentRecord.findById(req.params.id)
      .populate('pspId');

    if (!repaymentRecord) {
      return res.status(404).json({ message: 'Repayment record not found' });
    }

    if (repaymentRecord.status !== 'Pending Confirmation') {
      return res.status(400).json({ message: `Invalid status for confirmation: ${repaymentRecord.status}` });
    }

    const financing = await FinancingRequest.findById(repaymentRecord.financingRequestId);
    if (!financing) {
      return res.status(404).json({ message: 'Financing request not found' });
    }

    const profile = repaymentRecord.pspId;
    if (!profile || !profile.assignedPoolAddress) {
      return res.status(400).json({ message: 'Pool address not assigned to this PSP' });
    }

    // Optional on-chain settlement details from the CAD's confirm dialog.
    // If a real 0x… hash is supplied we hand it to processRepayment so it
    // ends up on RepaymentRecord.txHash and FinancingRequest.repaymentTxHash —
    // this is what enables the SAFE-Observer to do an exact match instead of
    // its heuristic amount+timing fallback.
    const bodyTxHash = typeof req.body?.txHash === 'string' ? req.body.txHash.trim() : '';
    const isRealTxHash = /^0x[0-9a-fA-F]+$/.test(bodyTxHash);
    const txHash = isRealTxHash ? bodyTxHash : null;
    const blockNumber = Number.isFinite(Number(req.body?.blockNumber))
      ? Number(req.body.blockNumber)
      : null;

    // 1. Update status to Processing
    repaymentRecord.status = 'Processing';
    await repaymentRecord.save();

    financing.status = 'ProcessingRepayment';
    await financing.save();

    // 2. Process repayment off-chain (update financing status, restore credit)
    const result = await processRepayment(financing._id, {
      principalAmount: repaymentRecord.principalAmount,
      actualInterestPaid: repaymentRecord.actualInterestPaid,
      txHash, // null when CAD didn't paste one — better than fake OFFCHAIN-…
      blockNumber,
      repaymentRecordId: repaymentRecord._id,
      pspId: profile._id
    });

    if (!result.success) {
      // Revert status
      repaymentRecord.status = 'Pending Confirmation';
      await repaymentRecord.save();
      financing.status = 'RepaymentPending';
      await financing.save();
      return res.status(500).json({ message: 'Repayment record finalization failed', error: result.error });
    }

    await logAction(req.user.userId, 'CONFIRM_REPAYMENT_OFFCHAIN', 'RepaymentRecord', repaymentRecord._id, {
      principal: repaymentRecord.principalAmount,
      interest: repaymentRecord.actualInterestPaid
    });

    res.json({
      message: 'Repayment confirmed off-chain (credit restored)',
      financing: result.financing
    });

  } catch (error) {
    console.error('[Admin Repayment Confirm] Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/approve-onboarding/:pspId
// @desc    Approve PSP Registration Details for full onboarding
// @access  Private (KAM only)
router.post('/approve-onboarding/:pspId', authorizeRoles('KAM'), async (req, res) => {
  try {
    const profile = await PSPProfile.findById(req.params.pspId);

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    if (profile.onboardingStatus !== 'PRE_QUAL_PENDING') {
      return res.status(400).json({ message: 'Application is not in pending Registration Details state' });
    }

    // Update status
    profile.onboardingStatus = 'PRE_QUAL_APPROVED';
    // Initialize workflow step if it's the first time
    if (!profile.workflowStep) {
      profile.workflowStep = 'KAM_REVIEW';
    }

    await profile.save();

    // Log the action
    await logAction(req.user.userId, 'APPROVE_PRE_QUAL', 'PSPProfile', profile._id, {
      previousStatus: 'PRE_QUAL_PENDING',
      newStatus: 'PRE_QUAL_APPROVED'
    });

    // Notify the PSP
    createNotification(profile.userId, {
      type: 'success',
      title: 'Registration Details Approved!',
      message: 'Your initial application has been approved. You can now complete your full company profile.'
    });

    res.json({ message: 'Registration Details approved successfully', profile });
  } catch (error) {
    console.error('[Approve Onboarding] Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

