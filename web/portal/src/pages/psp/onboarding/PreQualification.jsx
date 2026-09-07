import { ClipboardList, Building, Globe, BarChart3, TrendingUp, Users, Plus, X, Truck } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import MultiFileUploadField from '../../../components/common/MultiFileUploadField';

const commonCurrencies = [
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'HKD', 'NZD', 'SGD',
  'INR', 'PKR', 'AED', 'SAR', 'CNY', 'TRY', 'RUB', 'BRL', 'MXN', 'IDR'
];

import { countries } from '../../../services/countries';

const PreQualification = ({ data, onChange }) => {
  const [fromCurrency, setFromCurrency] = useState('');
  const [toCurrency, setToCurrency] = useState('');

  const handleChange = (field) => (e) => {
    onChange({ ...data, [field]: e.target.value });
  };

  const formatNumberWithCommas = (value) => {
    if (!value && value !== 0) return "";
    const stringValue = value.toString().replace(/,/g, "");
    if (isNaN(stringValue) || stringValue === "") return stringValue;
    const [integerPart, decimalPart] = stringValue.split('.');
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
  };

  const cleanNumericInput = (value) => {
    // Explicitly allow numbers, decimal points, and commas
    let val = value.replace(/[^0-9.,]/g, "");
    
    // Strip commas for the raw state (so the backend receives clean numbers)
    val = val.replace(/,/g, "");

    const parts = val.split('.');
    if (parts.length > 2) {
      val = parts[0] + '.' + parts.slice(1).join('');
    }
    return val;
  };

  const monthNames = ["April", "Mar", "Feb", "Jan", "Dec", "Nov", "Oct", "Sep", "Aug", "Jul", "Jun", "May"];
  const monthList = useMemo(() => {
    const list = [];
    const date = new Date();
    // Start from the previous month
    date.setMonth(date.getMonth() - 1);
    
    for (let i = 0; i < 7; i++) {
      const monthName = date.toLocaleString('default', { month: 'short' });
      const year = date.getFullYear();
      list.push(`${monthName}, ${year} *`);
      date.setMonth(date.getMonth() - 1);
    }
    return list;
  }, []);

  useEffect(() => {
    let changed = false;
    const updatedData = { ...data };

    if (!data.monthlyTransactionVolumes || data.monthlyTransactionVolumes.length === 0) {
      updatedData.monthlyTransactionVolumes = monthList.map(month => ({ month, volume: "", count: "" }));
      changed = true;
    }
    if (!data.top3Corridors || data.top3Corridors.length !== 3) {
      updatedData.top3Corridors = [
        { fromCountry: "", toCountry: "", volume: "", count: "" },
        { fromCountry: "", toCountry: "", volume: "", count: "" },
        { fromCountry: "", toCountry: "", volume: "", count: "" }
      ];
      changed = true;
    }
    if (!data.businessModels || data.businessModels.length === 0) {
      updatedData.businessModels = [""];
      changed = true;
    }

    if (changed) {
      onChange(updatedData);
    }
  }, [data, monthList, onChange]);

  const handleFileChange = (docName) => (filesArray) => {
    onChange({
      ...data,
      documents: {
        ...(data.documents || {}),
        [docName]: filesArray,
      }
    });
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-brand-gradient rounded-lg flex items-center justify-center">
          <ClipboardList className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Your Liquidity Profile</h2>
          <p className="text-gray-500 text-sm">Help us understand your payments business and funding needs</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Q1 */}
        <div>
          <label className="input-label">1. Legal Name of the Entity *</label>
          <div className="relative">
            <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={data.registeredName || ''}
              onChange={handleChange('registeredName')}
              className="input-field pl-10"
              placeholder="e.g. Acme Payments Ltd"
              required
            />
          </div>
        </div>

        {/* Q1.1 & Q1.2 */}
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="input-label">1.1. Headquarter Jurisdiction *</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
              <select
                value={data.jurisdiction || ''}
                onChange={handleChange('jurisdiction')}
                className="input-field pl-10"
                required
              >
                <option value="">Select Jurisdiction</option>
                {countries.map(c => <option key={c.code} value={c.label}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="input-label">1.2. Regulatory License *</label>
            <div className="relative">
              <ClipboardList className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={data.licenseType || ''}
                onChange={handleChange('licenseType')}
                className="input-field pl-10"
                placeholder="e.g. MSB License"
                required
              />
            </div>
          </div>
        </div>

        {/* Q2 - Dynamic Business Models */}
        <div>
          <label className="input-label">2. Your Payments Business Model *</label>
          <div className="space-y-3">
            {(data.businessModels || []).map((model, index) => (
              <div key={index} className="relative group">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => {
                    const newModels = [...data.businessModels];
                    newModels[index] = e.target.value;
                    onChange({ ...data, businessModels: newModels });
                  }}
                  className="input-field pr-10"
                  placeholder="e.g. Cross-border remittance, B2B payments, FX settlement..."
                  required
                />
                {(data.businessModels || []).length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const newModels = data.businessModels.filter((_, i) => i !== index);
                      onChange({ ...data, businessModels: newModels });
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={!(data.businessModels?.[data.businessModels.length - 1])}
              onClick={() => {
                onChange({ ...data, businessModels: [...(data.businessModels || []), ""] });
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                !(data.businessModels?.[data.businessModels.length - 1])
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-brand-purple/10 text-brand-purple hover:bg-brand-purple/20'
              }`}
            >
              <Plus className="w-4 h-4" />
              Add Another Business Model
            </button>
          </div>
        </div>

        {/* Q3 - Top 3 Corridors as shown in Screenshot 1 */}
        <div>
          <label className="input-label mb-4">3. Top 3 Corridors *</label>
          <div className="space-y-3">
            {(data.top3Corridors || []).map((corridor, index) => {
              const updateCorridor = (field, value) => {
                const newCorridors = [...data.top3Corridors];
                newCorridors[index] = { ...newCorridors[index], [field]: value };
                onChange({ ...data, top3Corridors: newCorridors });
              };
              const isMandatory = index === 0;
              return (
                <div key={index} className="flex flex-wrap md:flex-nowrap items-center gap-2">
                  <select
                    value={corridor.fromCountry || ""}
                    onChange={(e) => updateCorridor('fromCountry', e.target.value)}
                    className="input-field md:w-40 text-sm"
                    required={isMandatory}
                  >
                    <option value="">From {isMandatory ? '*' : ''}</option>
                    {countries.map(c => <option key={c.code} value={c.label}>{c.label}</option>)}
                  </select>
                  <span className="text-gray-400 font-bold">→</span>
                  <select
                    value={corridor.toCountry || ""}
                    onChange={(e) => updateCorridor('toCountry', e.target.value)}
                    className="input-field md:w-40 text-sm"
                    required={isMandatory}
                  >
                    <option value="">To {isMandatory ? '*' : ''}</option>
                    {countries.map(c => <option key={c.code} value={c.label}>{c.label}</option>)}
                  </select>
                  <input
                    type="text"
                    value={formatNumberWithCommas(corridor.count)}
                    onChange={(e) => updateCorridor('count', cleanNumericInput(e.target.value))}
                    className="input-field flex-1 text-sm"
                    placeholder={`No. of Transactions ${isMandatory ? '*' : ''}`}
                    required={isMandatory}
                  />
                  <input
                    type="text"
                    value={formatNumberWithCommas(corridor.volume)}
                    onChange={(e) => updateCorridor('volume', cleanNumericInput(e.target.value))}
                    className="input-field flex-1 text-sm"
                    placeholder={`Volume (USD) ${isMandatory ? '*' : ''}`}
                    required={isMandatory}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Q4 - Monthly Transaction Volume as shown in Screenshot 2 */}
        <div>
          <label className="input-label mb-4">4. Monthly Transaction Volume (USD) *</label>
          <div className="space-y-3">
            {(data.monthlyTransactionVolumes || []).map((v, index) => (
              <div key={index} className="flex flex-wrap md:flex-nowrap items-center gap-3">
                <div className="w-full md:w-40">
                  <select
                    value={v.month || ""}
                    disabled
                    className="input-field text-sm font-medium bg-gray-50 cursor-not-allowed"
                  >
                    <option value={v.month}>{v.month}</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={formatNumberWithCommas(v.count)}
                  onChange={(e) => {
                    const newVolumes = [...data.monthlyTransactionVolumes];
                    newVolumes[index] = { ...newVolumes[index], count: cleanNumericInput(e.target.value) };
                    onChange({ ...data, monthlyTransactionVolumes: newVolumes });
                  }}
                  className="input-field flex-1 text-sm"
                  placeholder="No. of Transactions *"
                  required
                />
                <input
                  type="text"
                  value={formatNumberWithCommas(v.volume)}
                  onChange={(e) => {
                    const newVolumes = [...data.monthlyTransactionVolumes];
                    newVolumes[index] = { ...newVolumes[index], volume: cleanNumericInput(e.target.value) };
                    onChange({ ...data, monthlyTransactionVolumes: newVolumes });
                  }}
                  className="input-field flex-1 text-sm"
                  placeholder="Volume of Transactions (In USD) *"
                  required
                />
              </div>
            ))}
          </div>
        </div>

        {/* Q5 & Q6 */}
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="input-label">5. Pre-Funding Facility Size (USD) *</label>
            <select
              value={data.preQualRequestedAmount || ''}
              onChange={handleChange('preQualRequestedAmount')}
              className="input-field"
              required
            >
              <option value="">Select Amount</option>
              <option value="100K to 1M">100K to 1M</option>
              <option value="1M to 3M">1M to 3M</option>
              <option value="3M to 5M">3M to 5M</option>
              <option value="5M to 7M">5M to 7M</option>
              <option value="7M to 10M">7M to 10M</option>
            </select>
          </div>
          <div>
            <label className="input-label">6. Funding Tenure (Days) *</label>
            <select
              value={data.preQualRequestedDuration || ''}
              onChange={handleChange('preQualRequestedDuration')}
              className="input-field"
              required
            >
              <option value="">Select Tenure</option>
              <option value="2 days">2 days</option>
              <option value="7 days">7 days</option>
              <option value="10 days">10 days</option>
              <option value="15 days">15 days</option>
              <option value="30 days">30 days</option>
            </select>
          </div>
        </div>

        {/* Q7 - Your Correspondent & Partner Network */}
        <div>
          <label className="input-label">7. Your Correspondent & Partner Network *</label>
          <div className="relative">
            <Users className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <textarea
              value={data.preQualFundingCounterparties || ''}
              onChange={handleChange('preQualFundingCounterparties')}
              className="input-field pl-10 min-h-[100px]"
              placeholder="e.g. Tier-1 banks, regional MTOs, licensed PSP partners..."
              required
            />
          </div>
        </div>

        {/* Documents as shown in Screenshot 3 */}
        <div className="grid md:grid-cols-2 gap-6 pt-6 border-t border-gray-100">
          <div>
            <label className="input-label font-bold text-gray-700">Flow of funds *</label>
            <MultiFileUploadField
              label=""
              category="Financials & Banking"
              onUpload={handleFileChange('flowOfFunds')}
              onDelete={() => {}}
              existingFiles={data.docData?.flowOfFunds || []}
              id="flowOfFunds"
            />
          </div>
          <div>
            <label className="input-label font-bold text-gray-700">Organogram *</label>
            <MultiFileUploadField
              label=""
              category="Company Identity & Legal"
              onUpload={handleFileChange('organogram')}
              onDelete={() => {}}
              existingFiles={data.docData?.organogram || []}
              id="organogram"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreQualification;
