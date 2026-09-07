import {
  DollarSign,
  TrendingUp,
  Building,
  AlertCircle,
  Landmark,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import MultiFileUploadField from "../../../components/common/MultiFileUploadField";

const FinancialInfo = ({ data, onChange, onDelete }) => {
  const handleChange = (field) => (e) => {
    onChange({ ...data, [field]: e.target.value });
  };

  const handleCheckboxChange = (field) => (e) => {
    onChange({ ...data, [field]: e.target.checked });
  };

  const handleFileChange = (docName) => (filesArray) => {
    const updatedDocuments = {
      ...(data.documents || {}),
      [docName]: filesArray,
    };
    onChange({ ...data, documents: updatedDocuments });
  };

  const addWallet = () => {
    const wallets = Array.isArray(data.walletAddress)
      ? [...data.walletAddress]
      : [];
    onChange({
      ...data,
      walletAddress: [...wallets, { name: "", address: "" }],
    });
  };

  const removeWallet = (index) => {
    const wallets = [...(data.walletAddress || [])];
    wallets.splice(index, 1);
    onChange({ ...data, walletAddress: wallets });
  };

  const handleWalletChange = (index, field, value) => {
    const wallets = [...(data.walletAddress || [])];
    wallets[index] = { ...wallets[index], [field]: value };
    onChange({ ...data, walletAddress: wallets });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-brand-gradient rounded-lg flex items-center justify-center">
          <DollarSign className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tight">FINANCIAL DETAILS</h2>
          <p className="text-gray-500 text-sm">
            Provide your financial details
          </p>
        </div>
      </div>

      <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-brand-purple" />
        REVENUE STATISTICS
      </h3>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="input-label">Annual Revenue (Last Year) *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              value={data.annualRevenue || ""}
              onChange={handleChange("annualRevenue")}
              className="input-field pl-8"
              placeholder="1,000,000"
              required
            />
          </div>
        </div>

        <div>
          <label className="input-label">Projected Revenue (This Year) *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              value={data.projectedRevenue || ""}
              onChange={handleChange("projectedRevenue")}
              className="input-field pl-8"
              placeholder="1,500,000"
              required
            />
          </div>
        </div>

        <div>
          <label className="input-label">Net Profit Margin (%) *</label>
          <input
            type="number"
            value={data.profitMargin || ""}
            onChange={handleChange("profitMargin")}
            className="input-field"
            placeholder="15"
            min="0"
            max="100"
            required
          />
        </div>

        <div>
          <label className="input-label">Monthly Cash Flow *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              value={data.monthlyCashFlow || ""}
              onChange={handleChange("monthlyCashFlow")}
              className="input-field pl-8"
              placeholder="100,000"
              required
            />
          </div>
        </div>
      </div>

      <hr className="my-6" />

      <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-brand-purple" />
        MONTHLY TRANSACTION VOLUME (LAST 6 MONTHS) *
      </h3>
      <p className="text-sm text-gray-500 mb-4">Provide monthly volume for the last 6 months</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data.monthlyTransactionVolumes || []).map((v, index) => (
          <div key={index} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">{v.month}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
              <input
                type="number"
                value={v.volume || ""}
                onChange={(e) => {
                  const newVolumes = [...data.monthlyTransactionVolumes];
                  newVolumes[index] = { ...newVolumes[index], volume: e.target.value };
                  onChange({ ...data, monthlyTransactionVolumes: newVolumes });
                }}
                className="input-field pl-6 text-sm py-1.5"
                placeholder="0.00"
              />
            </div>
          </div>
        ))}
      </div>

      <hr className="my-6" />

      <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-brand-purple" />
        NUMBER OF TRANSACTIONS (LAST 6 MONTHS) *
      </h3>
      <p className="text-sm text-gray-500 mb-4">Provide number of transactions for the last 6 months</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data.numberOfTransactions || []).map((v, index) => (
          <div key={index} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">{v.month}</label>
            <input
              type="number"
              value={v.count || ""}
              onChange={(e) => {
                const newCounts = [...data.numberOfTransactions];
                newCounts[index] = { ...newCounts[index], count: e.target.value };
                onChange({ ...data, numberOfTransactions: newCounts });
              }}
              className="input-field text-sm py-1.5"
              placeholder="0"
            />
          </div>
        ))}
      </div>

      <hr className="my-6" />

      <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
        <Building className="w-5 h-5 text-brand-purple" />
        EXISTING PREFUNDING PROVIDERS (IF ANY)
      </h3>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="input-label">Current Prefunding Provider</label>
          <input
            type="text"
            value={data.primaryBank || ""}
            onChange={handleChange("primaryBank")}
            className="input-field"
            placeholder="XYZ"
          />
        </div>

        <div>
          <label className="input-label">Current Allocation</label>
          <input
            type="text"
            value={data.currentAllocation || ""}
            onChange={handleChange("currentAllocation")}
            className="input-field"
            placeholder="10,000"
          />
        </div>

        <div className="md:col-span-2">
          <label className="input-label">Current Prefunding Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              value={data.rolledOutCreditLines || ""}
              onChange={handleChange("rolledOutCreditLines")}
              className="input-field pl-8"
              placeholder="0"
            />
          </div>
        </div>
      </div>

      <hr className="my-6" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-brand-purple/10 rounded-lg flex items-center justify-center">
          <Wallet className="w-6 h-6 text-brand-purple" />
        </div>
        <div>
          <h3 className="text-lg font-bold uppercase tracking-tight">SETTLEMENT WALLETS</h3>
          <p className="text-gray-500 text-sm">
            Manage your destination wallets for drawdown liquidity
          </p>
        </div>
      </div>

      <div className="p-4 bg-brand-purple/5 border border-brand-purple/10 rounded-xl mb-6">
        <div className="flex gap-3">
          <div className="w-5 h-5 rounded-full bg-brand-purple text-white flex items-center justify-center flex-shrink-0 text-[10px] mt-0.5">
            !
          </div>
          <p className="text-sm text-brand-purple font-medium">
            These wallet addresses will be used to provide you with liquidity
            once your credit line application is approved. Please ensure
            accuracy for seamless fund settlement.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {(Array.isArray(data.walletAddress) ? data.walletAddress : []).map(
          (wallet, index) => (
            <div
              key={index}
              className="flex gap-3 items-start p-4 bg-white border border-gray-200 rounded-xl shadow-sm animate-fade-in group"
            >
              <div className="flex-1 grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">
                    Wallet Name
                  </label>
                  <input
                    type="text"
                    value={wallet.name || ""}
                    onChange={(e) =>
                      handleWalletChange(index, "name", e.target.value)
                    }
                    className="input-field bg-gray-50/50 border-gray-100 focus:bg-white"
                    placeholder="e.g. Primary, Operational"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">
                    Address
                  </label>
                  <input
                    type="text"
                    value={wallet.address || ""}
                    onChange={(e) =>
                      handleWalletChange(index, "address", e.target.value)
                    }
                    className="input-field bg-gray-50/50 border-gray-100 focus:bg-white font-mono text-sm"
                    placeholder="0x..."
                    required
                  />
                </div>
              </div>
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => removeWallet(index)}
                  className="mt-8 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  title="Remove Wallet"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>
          ),
        )}

        {(data.walletAddress?.length === 0 || !data.walletAddress) && (
          <div className="text-center p-8 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Wallet className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-gray-500 text-sm mb-4">
              No settlement wallets added yet.
            </p>
            <button
              type="button"
              onClick={addWallet}
              className="px-6 py-2 bg-brand-purple text-white rounded-lg font-semibold hover:bg-brand-purple/90 transition-all flex items-center gap-2 mx-auto"
            >
              <Plus className="w-4 h-4" /> Add First Wallet
            </button>
          </div>
        )}

        {data.walletAddress?.length > 0 && (
          <button
            type="button"
            onClick={addWallet}
            className="text-brand-purple hover:text-brand-purple/80 text-sm font-bold flex items-center gap-2 transition-all"
          >
            <div className="w-6 h-6 rounded-full bg-brand-purple/10 flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            Add Another Wallet
          </button>
        )}
      </div>

      <hr className="my-6" />

        <h3 className="font-bold uppercase tracking-tight flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-brand-purple" />
          DEFAULT HISTORY
        </h3>

      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div>
          <span className="font-medium text-gray-800 block">
            Previous Default or Restructuring?
          </span>
          <p className="text-sm text-gray-600 mt-1">
            Has your company had any loan defaults, restructurings, or
            bankruptcy proceedings?
          </p>
        </div>

        <div className="flex gap-3 mt-4">
          {/* NO (default) */}
          <button
            type="button"
            onClick={() => onChange({ ...data, hasDefaultHistory: false })}
            className={`px-4 py-2 rounded-md border text-sm font-medium transition
        ${
          data.hasDefaultHistory === false
            ? "bg-gray-900 text-white border-gray-900"
            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
        }`}
          >
            No
          </button>

          {/* YES */}
          <button
            type="button"
            onClick={() => onChange({ ...data, hasDefaultHistory: true })}
            className={`px-4 py-2 rounded-md border text-sm font-medium transition
        ${
          data.hasDefaultHistory === true
            ? "bg-red-600 text-white border-red-600"
            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
        }`}
          >
            Yes
          </button>
        </div>
      </div>

      {data.hasDefaultHistory && (
        <div className="animate-fade-in">
          <label className="input-label">Please provide details *</label>
          <textarea
            value={data.defaultDetails || ""}
            onChange={handleChange("defaultDetails")}
            className="input-field min-h-[100px]"
            placeholder="Describe the circumstances and resolution..."
            required
          />
        </div>
      )}

      <hr className="my-6" />

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-brand-purple/10 rounded-lg flex items-center justify-center">
          <Landmark className="w-6 h-6 text-brand-purple" />
        </div>
        <div>
          <h3 className="text-lg font-bold uppercase tracking-tight">
            FINANCIALS & BANKING DOCUMENTS
          </h3>
          <p className="text-gray-500 text-sm">
            Upload corporate financial records
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <MultiFileUploadField
          label="Latest 6 months bank statements *"
          category="Financials & Banking"
          onUpload={handleFileChange("bankStatements")}
          onDelete={onDelete}
          existingFiles={data.docData?.bankStatements || []}
        />
        <MultiFileUploadField
          label="Audited financial statements (last 2 years)"
          category="Financials & Banking"
          onUpload={handleFileChange("auditedFinancials")}
          onDelete={onDelete}
          existingFiles={data.docData?.auditedFinancials || []}
        />
        <MultiFileUploadField
          label="Management accounts (YTD) *"
          category="Financials & Banking"
          onUpload={handleFileChange("managementAccounts")}
          onDelete={onDelete}
          existingFiles={data.docData?.managementAccounts || []}
        />
        <MultiFileUploadField
          label="Cash flow statements (last 6 months) *"
          category="Financials & Banking"
          onUpload={handleFileChange("cashFlowStatements")}
          onDelete={onDelete}
          existingFiles={data.docData?.cashFlowStatements || []}
        />
        {/* <MultiFileUploadField
          label="Audited statement*"
          category="Financials & Banking"
          onUpload={handleFileChange('auditedStatement')}
          onDelete={onDelete}
          existingFiles={data.docData?.auditedStatement || []}
        /> */}
        <MultiFileUploadField
          label="Existing credit report *"
          category="Financials & Banking"
          onUpload={handleFileChange("creditReportEcib")}
          onDelete={onDelete}
          existingFiles={data.docData?.creditReportEcib || []}
        />

      </div>

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mt-6">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> All financial information provided will be
          verified during the credit assessment process. Please ensure accuracy
          to avoid delays in your application.
        </p>
      </div>
    </div>
  );
};
export default FinancialInfo;
