const mongoose = require('mongoose');

const financingDocumentSchema = new mongoose.Schema({
    pspId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PSPProfile',
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: [
            'Company Identity & Legal',
            'Financials & Banking',
            'Operational Settlement Data',
            'Risk & Legal',
            'Credit Report'
        ]
    },
    secondaryCompanyId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    name: {
        type: String,
        required: true
    },
    documentType: {
        type: String,
        required: true
    },
    fileContent: {
        type: String, // Store as Base64 string OR Azure Blob URL
        required: true
    },
    fileType: String,
    fileSize: Number, // In bytes
    uploadedBy: {
        type: String,
        default: ''
    },
    uploadedByRole: {
        type: String,
        default: ''
    },
    isAdminUpload: {
        type: Boolean,
        default: false
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('FinancingDocument', financingDocumentSchema);
