import { Building2, User, FileText, AlertTriangle, ShieldCheck, PlusCircleIcon } from 'lucide-react';
import MultiFileUploadField from '../../../components/common/MultiFileUploadField';
import { countries } from '../../../services/countries';

const CompanyInfo = ({ data, onChange, onDelete }) => {
  const handleChange = (field) => (e) => {
    onChange({ ...data, [field]: e.target.value });
  };

  const handleCheckboxChange = (field) => (e) => {
    onChange({ ...data, [field]: e.target.checked });
  };

  const handleFileChange = (docName) => (filesArray) => {
    const updatedDocuments = { ...(data.documents || {}), [docName]: filesArray };
    onChange({ ...data, documents: updatedDocuments });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-brand-gradient rounded-lg flex items-center justify-center">
          <Building2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight">COMPANY INFORMATION</h2>
          <p className="text-gray-500 text-sm">Tell us about your organization</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="input-label">Legal Name of the Entity *</label>
          <input
            type="text"
            value={data.companyName || ''}
            onChange={handleChange('companyName')}
            className="input-field"
            placeholder="Acme Payments Ltd"
            required
          />
        </div>

        <div>
          <label className="input-label">Company Registration Number *</label>
          <input
            type="text"
            value={data.registrationNo || ''}
            onChange={handleChange('registrationNo')}
            className="input-field"
            placeholder="12345678"
            required
          />
        </div>

        <div>
          <label className="input-label">Headquarter Jurisdiction *</label>
          <select
            value={data.jurisdiction || ''}
            onChange={handleChange('jurisdiction')}
            className="input-field"
            required
          >
            <option value="">Select Country</option>
            {countries.map(c => <option key={c.code} value={c.label}>{c.label}</option>)}
          </select>
        </div>

        <div>
          <label className="input-label">Year Established *</label>
          <input
            type="number"
            value={data.yearEstablished || ''}
            onChange={handleChange('yearEstablished')}
            className="input-field"
            placeholder="2020"
            min="1900"
            max="2026"
            required
          />
        </div>
      </div>
      <hr className="my-6" />

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-purple/10 rounded-lg flex items-center justify-center">
            <Building2 className="w-6 h-6 text-brand-purple" />
          </div>
          <div>
            <h3 className="text-lg font-bold uppercase tracking-tight">SECONDARY COMPANIES</h3>
            <p className="text-gray-500 text-sm">Add other companies associated with your organization</p>
          </div>
        </div>
        <button
          onClick={() => {
            const secondary = [...(data.secondaryCompanies || []), { _id: `temp_${Date.now()}`, name: '', registrationNo: '', country: '', yearEstablished: '' }];
            onChange({ ...data, secondaryCompanies: secondary });
          }}
          className="flex items-center gap-2 text-sm font-medium text-brand-purple hover:text-brand-purple/80 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-brand-purple/10 flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
          Add Secondary Company <PlusCircleIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        {(data.secondaryCompanies || []).length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No secondary companies added yet</p>
          </div>
        ) : (
          data.secondaryCompanies.map((company, index) => (
            <div key={index} className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm relative group">
              <button
                onClick={() => {
                  const secondary = data.secondaryCompanies.filter((_, i) => i !== index);
                  onChange({ ...data, secondaryCompanies: secondary });
                }}
                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
              >
                <AlertTriangle className="w-5 h-5" />
              </button>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="input-label">Company Name *</label>
                  <input
                    type="text"
                    value={company.name || ''}
                    onChange={(e) => {
                      const secondary = [...data.secondaryCompanies];
                      secondary[index].name = e.target.value;
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    className="input-field"
                    placeholder="Secondary Company Name"
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Registration Number *</label>
                  <input
                    type="text"
                    value={company.registrationNo || ''}
                    onChange={(e) => {
                      const secondary = [...data.secondaryCompanies];
                      secondary[index].registrationNo = e.target.value;
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    className="input-field"
                    placeholder="12345678"
                    required
                  />
                </div>
                <div>
                  <label className="input-label">Country *</label>
                  <select
                    value={company.country || ''}
                    onChange={(e) => {
                      const secondary = [...data.secondaryCompanies];
                      secondary[index].country = e.target.value;
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    className="input-field"
                    required
                  >
                    <option value="">Select Country</option>
                    {countries.map(c => <option key={c.code} value={c.label}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="input-label">Year Established *</label>
                  <input
                    type="number"
                    value={company.yearEstablished || ''}
                    onChange={(e) => {
                      const secondary = [...data.secondaryCompanies];
                      secondary[index].yearEstablished = e.target.value;
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    className="input-field"
                    placeholder="2020"
                    min="1900"
                    max="2026"
                    required
                  />
                </div>
              </div>

              <div className="mt-6">
                <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-brand-purple" />
                  Secondary Company Documents
                </h4>
                <div className="grid md:grid-cols-2 gap-6">
                  <MultiFileUploadField
                    label="Trade license / commercial registration *"
                    category="Company Identity & Legal"
                    onUpload={(files) => {
                      const secondary = [...data.secondaryCompanies];
                      // Inject secondaryCompanyId into each file object before passing to onUpload
                      const filesWithId = files.map(file => ({ ...file, secondaryCompanyId: company._id }));
                      secondary[index].documents = { ...(secondary[index].documents || {}), tradeLicense: filesWithId };
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    onDelete={onDelete}
                    existingFiles={data.docData?.secondaryDocuments?.[company._id]?.tradeLicense || []}
                  />
                  <MultiFileUploadField
                    label="MOA / AOA *"
                    category="Company Identity & Legal"
                    onUpload={(files) => {
                      const secondary = [...data.secondaryCompanies];
                      const filesWithId = files.map(file => ({ ...file, secondaryCompanyId: company._id }));
                      secondary[index].documents = { ...(secondary[index].documents || {}), moaAoa: filesWithId };
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    onDelete={onDelete}
                    existingFiles={data.docData?.secondaryDocuments?.[company._id]?.moaAoa || []}
                  />
                  <MultiFileUploadField
                    label="VAT certificate & filing (if applicable)"
                    category="Company Identity & Legal"
                    onUpload={(files) => {
                      const secondary = [...data.secondaryCompanies];
                      const filesWithId = files.map(file => ({ ...file, secondaryCompanyId: company._id }));
                      secondary[index].documents = { ...(secondary[index].documents || {}), vatCert: filesWithId };
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    onDelete={onDelete}
                    existingFiles={data.docData?.secondaryDocuments?.[company._id]?.vatCert || []}
                  />
                  <MultiFileUploadField
                    label="Regulatory license *"
                    category="Company Identity & Legal"
                    onUpload={(files) => {
                      const secondary = [...data.secondaryCompanies];
                      const filesWithId = files.map(file => ({ ...file, secondaryCompanyId: company._id }));
                      secondary[index].documents = { ...(secondary[index].documents || {}), regulatoryLicense: filesWithId };
                      onChange({ ...data, secondaryCompanies: secondary });
                    }}
                    onDelete={onDelete}
                    existingFiles={data.docData?.secondaryDocuments?.[company._id]?.regulatoryLicense || []}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <hr className="my-6" />

        <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
          <User className="w-5 h-5 text-brand-purple" />
          KEY CONTACT PERSON
        </h3>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="input-label">Full Name *</label>
          <input
            type="text"
            value={data.contactName || ''}
            onChange={handleChange('contactName')}
            className="input-field"
            placeholder="John Smith"
            required
          />
        </div>

        <div>
          <label className="input-label">Position *</label>
          <input
            type="text"
            value={data.contactPosition || ''}
            onChange={handleChange('contactPosition')}
            className="input-field"
            placeholder="CEO"
            required
          />
        </div>

        <div>
          <label className="input-label">Email *</label>
          <input
            type="email"
            value={data.contactEmail || ''}
            onChange={handleChange('contactEmail')}
            className="input-field"
            placeholder="john@example.com"
            required
          />
        </div>

        <div>
          <label className="input-label">Phone *</label>
          <input
            type="tel"
            value={data.contactPhone || ''}
            onChange={handleChange('contactPhone')}
            className="input-field"
            placeholder="+1 234 567 8900"
            required
          />
        </div>
      </div>

      <hr className="my-6" />

        <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
          <FileText className="w-5 h-5 text-brand-purple" />
          ULTIMATE BENEFICIAL OWNER (UBO) DETAILS
        </h3>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="input-label">UBO Full Name *</label>
          <input
            type="text"
            value={data.uboName || ''}
            onChange={handleChange('uboName')}
            className="input-field"
            placeholder="Full legal name"
            required
          />
        </div>

        <div>
          <label className="input-label">Ownership Percentage *</label>
          <input
            type="number"
            value={data.uboOwnership || ''}
            onChange={handleChange('uboOwnership')}
            className="input-field"
            placeholder="25"
            min="0"
            max="100"
            required
          />
        </div>
      </div>

      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mt-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data.isPEP || false}
            onChange={handleCheckboxChange('isPEP')}
            className="mt-1 w-5 h-5 rounded border-gray-300 text-brand-purple focus:ring-brand-purple"
          />
          <div>
            <span className="flex items-center gap-2 font-medium text-amber-800">
              <AlertTriangle className="w-4 h-4" />
              Politically Exposed Person (PEP) Declaration
            </span>
            <p className="text-sm text-amber-700 mt-1">
              Check this box if any UBO or key person is or has been a politically exposed person.
            </p>
          </div>
        </label>
      </div>

      <hr className="my-6" />

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-brand-purple/10 rounded-lg flex items-center justify-center">
          <ShieldCheck className="w-6 h-6 text-brand-purple" />
        </div>
        <div>
          <h3 className="text-lg font-bold uppercase tracking-tight">COMPANY IDENTITY & LEGAL DOCUMENTS</h3>
          <p className="text-gray-500 text-sm">Upload required legal documentation</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <MultiFileUploadField
          label="Trade license / commercial registration *"
          category="Company Identity & Legal"
          onUpload={handleFileChange('tradeLicense')}
          onDelete={onDelete}
          existingFiles={data.docData?.tradeLicense || []}
        />
        <MultiFileUploadField
          label="MOA / AOA *"
          category="Company Identity & Legal"
          onUpload={handleFileChange('moaAoa')}
          onDelete={onDelete}
          existingFiles={data.docData?.moaAoa || []}
        />
        <MultiFileUploadField
          label="Organogram (Attach a picture of your holding and subsidiary companies) *"
          category="Company Identity & Legal"
          onUpload={handleFileChange('organogram')}
          onDelete={onDelete}
          existingFiles={data.docData?.organogram || []}
        />
        <MultiFileUploadField
          label="Passport/ID card of all ubos *"
          category="Company Identity & Legal"
          onUpload={handleFileChange('uboPassports')}
          onDelete={onDelete}
          existingFiles={data.docData?.uboPassports || []}
        />
        <MultiFileUploadField
          label="VAT certificate & filing (if applicable)"
          category="Company Identity & Legal"
          onUpload={handleFileChange('vatCert')}
          onDelete={onDelete}
          existingFiles={data.docData?.vatCert || []}
        />
        <MultiFileUploadField
          label="Regulatory license *"
          category="Company Identity & Legal"
          onUpload={handleFileChange('regulatoryLicense')}
          onDelete={onDelete}
          existingFiles={data.docData?.regulatoryLicense || []}
        />
      </div>


    </div>
  );
};

export default CompanyInfo;
