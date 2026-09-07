import { Briefcase, Package, Users, Truck, Plus, X, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import FileUploadField from '../../../components/common/FileUploadField';
import MultiFileUploadField from '../../../components/common/MultiFileUploadField';
import { countries } from '../../../services/countries';

const BusinessOperations = ({ data, onChange, onDelete }) => {
  const handleChange = (field) => (e) => {
    onChange({ ...data, [field]: e.target.value });
  };

  const handleFileChange = (docName) => (fileData) => {
    const updatedDocuments = { ...(data.documents || {}), [docName]: fileData };
    onChange({ ...data, documents: updatedDocuments });
  };

  const addItem = (field) => {
    const currentItems = data[field] || [''];
    if (currentItems.length < 5) {
      onChange({ ...data, [field]: [...currentItems, ''] });
    }
  };

  const removeItem = (field, index) => {
    const currentItems = data[field] || [];
    if (currentItems.length > 1) {
      onChange({ ...data, [field]: currentItems.filter((_, i) => i !== index) });
    }
  };

  const updateItem = (field, index, value) => {
    const currentItems = data[field] || [];
    const newItems = [...currentItems];
    newItems[index] = value;
    onChange({ ...data, [field]: newItems });
  };

  const sectors = [
    'Payment Processing',
    'E-commerce',
    'Remittance',
    'Digital Banking',
    'Cryptocurrency',
    'Travel & Hospitality',
    'Retail',
    'B2B Payments',
    'Other'
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-brand-gradient rounded-lg flex items-center justify-center">
          <Briefcase className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight">BUSINESS OPERATIONS</h2>
          <p className="text-gray-500 text-sm">Tell us about your business activities</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="input-label">Business Model *</label>
          <div className="space-y-3">
            {(data.businessModels || ['']).map((model, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => updateItem('businessModels', index, e.target.value)}
                  className="input-field flex-1"
                  placeholder={`Business Model ${index + 1}`}
                  required
                />
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => removeItem('businessModels', index)}
                    className="p-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
            {(data.businessModels || []).length < 5 && (
              <button
                type="button"
                onClick={() => addItem('businessModels')}
                className="flex items-center gap-2 text-brand-purple hover:underline text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Add Another Business Model
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="input-label">Monthly Transaction Volume *</label>
          <select
            value={data.transactionVolume || ''}
            onChange={handleChange('transactionVolume')}
            className="input-field"
            required
          >
            <option value="">Select Volume</option>
            <option value="<100k">Less than $100,000</option>
            <option value="100k-500k">$100,000 - $500,000</option>
            <option value="500k-1m">$500,000 - $1,000,000</option>
            <option value="1m-5m">$1,000,000 - $5,000,000</option>
            <option value=">5m">More than $5,000,000</option>
          </select>
        </div>
      </div>

      <hr className="my-6" />

      <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
        <Package className="w-5 h-5 text-brand-purple" />
        KEY PRODUCTS/SERVICES
      </h3>
      <p className="text-sm text-gray-500 mb-4">List your main products or services</p>

      <div className="space-y-3">
        {(data.products || ['']).map((product, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="text"
              value={product}
              onChange={(e) => updateItem('products', index, e.target.value)}
              className="input-field flex-1"
              placeholder={`Product/Service ${index + 1}`}
            />
            {index > 0 && (
              <button
                type="button"
                onClick={() => removeItem('products', index)}
                className="p-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        ))}
        {(data.products || []).length < 5 && (
          <button
            type="button"
            onClick={() => addItem('products')}
            className="flex items-center gap-2 text-brand-purple hover:underline text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Product/Service
          </button>
        )}
      </div>

      <hr className="my-6" />

      <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
        <Users className="w-5 h-5 text-brand-purple" />
        TOP 5 COUNTERPARTIES
      </h3>
      <p className="text-sm text-gray-500 mb-4">List your largest counterparties by volume</p>

      <div className="space-y-3">
        {(data.customers || ['']).map((customer, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="text"
              value={customer}
              onChange={(e) => updateItem('customers', index, e.target.value)}
              className="input-field flex-1"
              placeholder={`Counterparty ${index + 1}`}
            />
            {index > 0 && (
              <button
                type="button"
                onClick={() => removeItem('customers', index)}
                className="p-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        ))}
        {(data.customers || []).length < 5 && (
          <button
            type="button"
            onClick={() => addItem('customers')}
            className="flex items-center gap-2 text-brand-purple hover:underline text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Counterparty
          </button>
        )}
      </div>

      <hr className="my-6" />

      <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
        <Truck className="w-5 h-5 text-brand-purple" />
        TOP 3 CORRIDORS
      </h3>
      <p className="text-sm text-gray-500 mb-4">Please specify your top 3 remittance corridors with monthly stats</p>

      <div className="space-y-6">
        {[0, 1, 2].map((index) => {
          const corridor = (data.top3Corridors || [])[index] || { fromCountry: "", toCountry: "", volume: "", count: "" };
          const updateCorridor = (field, value) => {
            const newCorridors = [...(data.top3Corridors || [
              { fromCountry: "", toCountry: "", volume: "", count: "" },
              { fromCountry: "", toCountry: "", volume: "", count: "" },
              { fromCountry: "", toCountry: "", volume: "", count: "" }
            ])];
            newCorridors[index] = { ...newCorridors[index], [field]: value };
            onChange({ ...data, top3Corridors: newCorridors });
          };

          return (
            <div key={index} className="p-4 bg-gray-50 rounded-xl border border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">From Country</label>
                <select
                  value={corridor.fromCountry || ""}
                  onChange={(e) => updateCorridor('fromCountry', e.target.value)}
                  className="input-field text-sm"
                >
                  <option value="">Select Country</option>
                  {countries.map(c => <option key={c.code} value={c.label}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">To Country</label>
                <select
                  value={corridor.toCountry || ""}
                  onChange={(e) => updateCorridor('toCountry', e.target.value)}
                  className="input-field text-sm"
                >
                  <option value="">Select Country</option>
                  {countries.map(c => <option key={c.code} value={c.label}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Monthly Revenue Number</label>
                <input
                  type="number"
                  value={corridor.count || ""}
                  onChange={(e) => updateCorridor('count', e.target.value)}
                  className="input-field text-sm"
                  placeholder="e.g. 500"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Monthly Revenue Volume</label>
                <input
                  type="number"
                  value={corridor.volume || ""}
                  onChange={(e) => updateCorridor('volume', e.target.value)}
                  className="input-field text-sm"
                  placeholder="e.g. 50000"
                />
              </div>
            </div>
          );
        })}
      </div>

      <hr className="my-6" />

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-brand-purple/10 rounded-lg flex items-center justify-center">
          <BarChart3 className="w-6 h-6 text-brand-purple" />
        </div>
        <div>
          <h3 className="text-lg font-bold uppercase tracking-tight">OPERATIONAL SETTLEMENT DATA</h3>
          <p className="text-gray-500 text-sm">Upload documentation for business operations</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <MultiFileUploadField
          label="Daily settlement volume reports (last 6 months) *"
          category="Operational Settlement Data"
          onUpload={handleFileChange('settlementReports')}
          onDelete={onDelete}
          existingFiles={data.documents?.settlementReports || data.docData?.settlementReports || []}
        />
        <MultiFileUploadField
          label="Ageing analysis of payables/receivables *"
          category="Operational Settlement Data"
          onUpload={handleFileChange('ageingAnalysis')}
          onDelete={onDelete}
          existingFiles={data.documents?.ageingAnalysis || data.docData?.ageingAnalysis || []}
        />
      </div>
    </div>
  );
};

export default BusinessOperations;
