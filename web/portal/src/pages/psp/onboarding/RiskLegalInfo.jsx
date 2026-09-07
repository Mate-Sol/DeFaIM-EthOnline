import { Gavel, Scale, Link2, ShieldAlert, ExternalLink, FileText } from 'lucide-react';
import MultiFileUploadField from '../../../components/common/MultiFileUploadField';

const RiskLegalInfo = ({ data, onChange, onDelete, showNDAError }) => {
    const handleFileChange = (docName) => (filesArray) => {
        const updatedDocuments = { ...(data.documents || {}), [docName]: filesArray };
        onChange({ ...data, documents: updatedDocuments });
    };

    const handleNDAChange = (e) => {
        onChange({ ...data, isAgreedToNDA: e.target.checked });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-brand-gradient rounded-lg flex items-center justify-center">
                    <ShieldAlert className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h2 className="text-xl font-bold uppercase tracking-tight">KYC & COMPLIANCE</h2>
                    <p className="text-gray-500 text-sm">Provide details on existing liabilities and legal structure</p>
                </div>
            </div>

            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg mb-6">
                <p className="text-sm text-indigo-800">
                    <strong>Transparency:</strong> Disclosing existing debt and legal structures helps us assess your creditworthiness accurately.
                </p>
            </div>

            <div className="space-y-8">
                <div>
                    <h3 className="font-bold uppercase tracking-tight flex items-center gap-2 mb-4">
                        <Gavel className="w-5 h-5 text-brand-purple" />
                        DEBT & FACILITIES
                    </h3>
                    <div className="grid md:grid-cols-2 gap-6">

                        <MultiFileUploadField
                            label="Existing debt/facility agreements"
                            category="Risk & Legal"
                            onUpload={handleFileChange('debtAgreements')}
                            onDelete={onDelete}
                            existingFiles={data.docData?.debtAgreements || []}
                        />
                        <MultiFileUploadField
                            label="Existing liens or pledges on receivables"
                            category="Risk & Legal"
                            onUpload={handleFileChange('liensPledges')}
                            onDelete={onDelete}
                            existingFiles={data.docData?.liensPledges || []}
                        />
                    </div>
                </div>

                <hr />

                <div>
                    <h3 className="font-bold uppercase tracking-tight flex items-center gap-2 mb-4">
                        <Link2 className="w-5 h-5 text-brand-purple" />
                        OPERATIONAL STRUCTURE
                    </h3>
                    <div className="grid md:grid-cols-2 gap-6">
                        <MultiFileUploadField
                            label="Flow of funds *"
                            category="Risk & Legal"
                            onUpload={handleFileChange('flowOfFunds')}
                            onDelete={onDelete}
                            existingFiles={data.docData?.flowOfFunds || []}
                        />

                        <MultiFileUploadField
                            label="Corporate structuring documents *"
                            category="Risk & Legal"
                            onUpload={handleFileChange('corporateStructuringDocuments')}
                            onDelete={onDelete}
                            existingFiles={data.docData?.corporateStructuringDocuments || []}
                        />
                        <MultiFileUploadField
                            label="Ubos source of funds *"
                            category="Risk & Legal"
                            onUpload={handleFileChange('ubosSourceOfFunds')}
                            onDelete={onDelete}
                            existingFiles={data.docData?.ubosSourceOfFunds || []}
                        />
                    </div>
                </div>
            </div>

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mt-8">
                <p className="text-sm text-amber-800">
                    <strong>Declaration:</strong> By proceeding, you certify that all uploaded documents are true, complete, and accurate representations of your company's status.
                </p>
            </div>

            <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg mt-4">
                <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                            <FileText className="w-5 h-5 text-brand-purple" />
                        </div>
                        <div>
                            <h4 className="font-semibold text-purple-900">Non-Disclosure Agreement (NDA)</h4>
                            <p className="text-sm text-purple-800 mt-1">
                                Please read and agree to the Non-Disclosure Agreement before completing your registration.
                            </p>
                            <a 
                                href="/NDA InvoiceMate.docx" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-brand-purple font-medium hover:underline mt-2"
                            >
                                <ExternalLink className="w-4 h-4" />
                                Review NDA Document
                            </a>
                        </div>
                    </div>
                    <label className="flex items-center gap-3 p-3 bg-white border border-purple-200 rounded-lg cursor-pointer hover:bg-purple-50 transition-colors">
                        <input
                            type="checkbox"
                            className="w-5 h-5 rounded border-gray-300 text-brand-purple focus:ring-brand-purple"
                            checked={data.isAgreedToNDA || false}
                            onChange={handleNDAChange}
                            required
                        />
                        <span className="text-sm font-medium text-gray-700">
                            I have read, understood, and agree to the terms of the Non-Disclosure Agreement.
                        </span>
                    </label>
                    {(showNDAError || (data.isAgreedToNDA === false && data.isAgreedToNDA !== undefined)) && !data.isAgreedToNDA && (
                        <p className="text-xs text-red-500 font-semibold mt-2 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                            <ShieldAlert className="w-3 h-3" />
                            * Please agree to the NDA to continue.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RiskLegalInfo;
