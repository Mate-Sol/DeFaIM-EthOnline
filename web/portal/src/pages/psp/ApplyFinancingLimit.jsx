import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import moment from "moment";
import toast from "react-hot-toast";
import {
  CreditCard,
  TrendingUp,
  DollarSign,
  Calendar,
  Upload,
  FileText,
  CheckCircle,
  X,
  Loader2,
  AlertCircle,
  LogOut,
  UserPlus,
  Clock,
  ClipboardList,
  MessageSquare,
  Plus,
} from "lucide-react";
import { pspAPI } from "../../services/api";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import Sidebar from "../../components/Sidebar";

const ApplyFinancingLimit = ({
  isTab = false,
  formData: propsFormData,
  onChange,
}) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [internalFormData, setInternalFormData] = useState({
    requestedAmount: "",
    duration: "60",
    purpose: "",
    fundingCounterparties: "",
    remittanceCorridors: "",
    desiredCurrencyType: "",
    desiredCurrencyValue: "",
    desiredBCNetwork: "",
    drawdown_tenor: "",
  });

  const formData = isTab ? propsFormData : internalFormData;
  const setFormData = isTab ? onChange : setInternalFormData;

  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [corridorRows, setCorridorRows] = useState([{ from: "", to: "" }]);
  const [counterpartyRows, setCounterpartyRows] = useState([{ name: "" }]);

  // Initialize corridorRows from formData
  useEffect(() => {
    if (formData.remittanceCorridors) {
      const pairs = formData.remittanceCorridors.split(", ");
      const rows = pairs.map((p) => {
        const [from, to] = p.split(" to ");
        return { from: from || "", to: to || "" };
      });
      // Add an empty row at the top if it doesn't exist
      if (rows.length > 0) {
        setCorridorRows([{ from: "", to: "" }, ...rows]);
      }
    } else {
      setCorridorRows([{ from: "", to: "" }]);
    }

    if (formData.fundingCounterparties) {
      const counterparties = formData.fundingCounterparties.split(",");
      const rows = counterparties.map((c) => ({ name: c.trim() })).filter(c => c.name);
      if (rows.length > 0) {
        setCounterpartyRows([{ name: "" }, ...rows]);
      } else {
        setCounterpartyRows([{ name: "" }]);
      }
    } else {
      setCounterpartyRows([{ name: "" }]);
    }
  }, []);

  const syncCorridors = (rows) => {
    const corridorString = rows
      .filter((r) => r.from.trim() !== "" && r.to.trim() !== "")
      .map((r) => `${r.from} to ${r.to}`)
      .join(", ");

    if (isTab) {
      onChange({ remittanceCorridors: corridorString });
    } else {
      setInternalFormData((prev) => ({
        ...prev,
        remittanceCorridors: corridorString,
      }));
    }
  };

  const handleCorridorChange = (index, field, value) => {
    const newRows = [...corridorRows];
    newRows[index][field] = value;
    setCorridorRows(newRows);
    syncCorridors(newRows);
  };

  const addCorridorRow = () => {
    if (corridorRows[0].from && corridorRows[0].to) {
      const newRows = [{ from: "", to: "" }, ...corridorRows];
      setCorridorRows(newRows);
      syncCorridors(newRows);
    }
  };

  const removeCorridorRow = (index) => {
    const newRows = corridorRows.filter((_, i) => i !== index);
    if (newRows.length === 0) newRows.push({ from: "", to: "" });
    setCorridorRows(newRows);
    syncCorridors(newRows);
  };

  const syncCounterparties = (rows) => {
    const counterpartyString = rows
      .filter((r) => r.name.trim() !== "")
      .map((r) => r.name.trim())
      .join(", ");

    if (isTab) {
      onChange({ fundingCounterparties: counterpartyString });
    } else {
      setInternalFormData((prev) => ({
        ...prev,
        fundingCounterparties: counterpartyString,
      }));
    }
  };

  const handleCounterpartyChange = (index, value) => {
    const newRows = [...counterpartyRows];
    newRows[index].name = value;
    setCounterpartyRows(newRows);
    syncCounterparties(newRows);
  };

  const addCounterpartyRow = () => {
    if (counterpartyRows[0].name) {
      const newRows = [{ name: "" }, ...counterpartyRows];
      setCounterpartyRows(newRows);
      syncCounterparties(newRows);
    }
  };

  const removeCounterpartyRow = (index) => {
    const newRows = counterpartyRows.filter((_, i) => i !== index);
    if (newRows.length === 0) newRows.push({ name: "" });
    setCounterpartyRows(newRows);
    syncCounterparties(newRows);
  };

  useEffect(() => {
    const fetchProfile = async () => {
      if (isTab) {
        setLoading(false);
        return;
      }
      try {
        const response = await pspAPI.getProfile();
        setProfile(response.data);
        if (response.data.requestedAmount || response.data.drawdown_tenor) {
          setFormData((prev) => ({
            ...prev,
            requestedAmount: (response.data.requestedAmount || "").toString(),
            duration: (response.data.requestedDuration || 60).toString(),
            fundingCounterparties: response.data.fundingCounterparties || "",
            remittanceCorridors: response.data.remittanceCorridors || "",
            desiredCurrencyType: response.data.desiredCurrencyType || "",
            desiredCurrencyValue: response.data.desiredCurrencyValue || "",
            desiredBCNetwork: response.data.desiredBCNetwork || "",
            drawdown_tenor: response.data.drawdown_tenor || "",
            purpose: response.data.purpose || "",
          }));
        }
      } catch (err) {
        console.error("Failed to fetch profile:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleChange = (field) => (e) => {
    if (isTab) {
      onChange({ [field]: e.target.value });
      if (field === "desiredCurrencyType") {
        onChange({ desiredCurrencyValue: "Fiat", desiredBCNetwork: "" });
      }
    } else {
      setInternalFormData((prev) => ({ ...prev, [field]: e.target.value }));
    }
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    const newFiles = files.map((file) => ({
      name: file.name,
      size: (file.size / 1024).toFixed(1) + " KB",
      type: file.type,
      id: Date.now() + Math.random(),
    }));
    setUploadedFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (fileId) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      // Submit application to backend
      await pspAPI.applyForLimit({
        requestedAmount: parseFloat(formData.requestedAmount),
        requestedDuration: parseInt(formData.duration),
        fundingCounterparties: formData.fundingCounterparties,
        remittanceCorridors: formData.remittanceCorridors,
        desiredCurrencyType: formData.desiredCurrencyType,
        desiredCurrencyValue: formData.desiredCurrencyValue,
        desiredBCNetwork: formData.desiredBCNetwork,
        drawdown_tenor: formData.drawdown_tenor,
        purpose: formData.purpose,
      });

      setIsSubmitted(true);
    } catch (error) {
      console.error("Application failed:", error);
      setError(
        error.response?.data?.message ||
          "Application failed. Please try again.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen ">
      {/* Sidebar for logged in users */}
      {user && !isTab && <Sidebar />}

      <main
        className={`${user && !isTab ? "ml-64 p-8" : isTab ? "" : "max-w-4xl mx-auto px-6 py-8"}`}
      >
        <div className={user && !isTab ? "max-w-4xl mx-auto" : ""}>
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-brand-gradient rounded-lg flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold uppercase tracking-tight">
                  FUNDING REQUEST
                </h2>
                <p className="text-gray-500 text-sm">
                  Request your credit line amount and upload documents
                </p>
              </div>
            </div>

            {profile?.creditLineStatus === "NeedMoreInfo" &&
              profile.cadMessage && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
                  <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-amber-900">
                      Message from Credit Approval Department
                    </h3>
                    <p className="text-amber-800 text-sm mt-1">
                      {profile.cadMessage}
                    </p>
                    <p className="text-amber-700 text-xs mt-2 italic">
                      Please update the information below and re-submit your
                      application.
                    </p>
                  </div>
                </div>
              )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="input-label">
                    Facility Size Requested (USDC/USD) *
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <select
                      value={formData.requestedAmount}
                      onChange={handleChange("requestedAmount")}
                      className="input-field pl-11"
                      required
                    >
                      <option value="">Select Amount Range</option>
                      <option value="100K to 1M">100K to 1M</option>
                      <option value="1M to 3M">1M to 3M</option>
                      <option value="3M to 5M">3M to 5M</option>
                      <option value="5M to 7M">5M to 7M</option>
                      <option value="7M to 10M">7M to 10M</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="input-label">
                    Facility Tenure (Days) *
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <select
                      value={formData.duration}
                      onChange={handleChange("duration")}
                      className="input-field pl-11"
                      required
                    >
                      <option value="">Select Tenure</option>
                      <option value="2">2 Days</option>
                      <option value="7">7 Days</option>
                      <option value="10">10 Days</option>
                      <option value="15">15 Days</option>
                      <option value="30">30 Days</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="input-label">
                    Transaction Settlement Time (Days) *
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={formData.drawdown_tenor}
                      onChange={handleChange("drawdown_tenor")}
                      className="input-field pl-11"
                      placeholder="e.g. 60"
                      required
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="input-label">
                    Remittance Corridors (if applicable)
                  </label>
                  <div className="space-y-3">
                    {corridorRows.map((row, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 animate-fade-in"
                      >
                        <div className="relative flex-1">
                          <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={row.from}
                            onChange={(e) =>
                              handleCorridorChange(
                                index,
                                "from",
                                e.target.value,
                              )
                            }
                            className="input-field pl-10 text-sm"
                            placeholder="From (e.g. UAE)"
                          />
                        </div>
                        <span className="text-gray-400 font-bold">→</span>
                        <div className="relative flex-1">
                          <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={row.to}
                            onChange={(e) =>
                              handleCorridorChange(index, "to", e.target.value)
                            }
                            className="input-field pl-10 text-sm"
                            placeholder="To (e.g. India)"
                          />
                        </div>

                        {index === 0 ? (
                          <button
                            type="button"
                            onClick={addCorridorRow}
                            disabled={!row.from || !row.to}
                            className="flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-xl text-xs font-bold hover:bg-brand-purple/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            <Plus className="w-4 h-4" />
                            Add
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeCorridorRow(index)}
                            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px] text-gray-400 italic">
                      Add your main payment corridors. The list is automatically
                      saved as you add them.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="input-label">Desired Currency Type *</label>
                  <select
                    value={formData.desiredCurrencyType}
                    onChange={handleChange("desiredCurrencyType")}
                    className="input-field"
                    required
                  >
                    <option value="">Select Type</option>
                    <option value="Stable">Stable Coin</option>
                    <option value="Fiat">Fiat</option>
                  </select>
                </div>

                <div>
                  <label className="input-label">Desired Currency *</label>
                  <select
                    value={formData.desiredCurrencyValue}
                    onChange={handleChange("desiredCurrencyValue")}
                    className="input-field"
                    required
                  >
                    <option value="">Select Currency</option>
                    {formData.desiredCurrencyType === "Stable" && (
                      <>
                        <option value="USDC">USDC</option>
                        <option value="USDT">USDT</option>
                        <option value="USD1">USD1</option>
                      </>
                    )}
                    {formData.desiredCurrencyType === "Fiat" && (
                      <option value="USD (fiat)">USD (fiat)</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {formData.desiredCurrencyType === "Stable" && (
                  <div>
                    <label className="input-label">Desired BC Network *</label>
                    <select
                      value={formData.desiredBCNetwork}
                      onChange={handleChange("desiredBCNetwork")}
                      className="input-field"
                      disabled={formData.desiredCurrencyType === "Fiat"}
                      required
                    >
                      <option value="">Select Network</option>
                      {[
                        "stellar",
                        "zigchain",
                        "starknet",
                        "arbitrum",
                        "ethereum",
                        "solana",
                      ].map((net) => (
                        <option key={net} value={net}>
                          {net.charAt(0).toUpperCase() + net.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="md:col-span-2">
                  <label className="input-label">
                    Counterparties against funding
                  </label>
                  <div className="space-y-3">
                    {counterpartyRows.map((row, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 animate-fade-in"
                      >
                        <div className="relative flex-1">
                          <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) =>
                              handleCounterpartyChange(index, e.target.value)
                            }
                            className="input-field pl-10 text-sm"
                            placeholder="Counterparty Name (e.g. EFI ECOM Limited)"
                          />
                        </div>

                        {index === 0 ? (
                          <button
                            type="button"
                            onClick={addCounterpartyRow}
                            disabled={!row.name}
                            className="flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-xl text-xs font-bold hover:bg-brand-purple/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            <Plus className="w-4 h-4" />
                            Add
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeCounterpartyRow(index)}
                            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="input-label">Purpose of Financing</label>
                <textarea
                  value={formData.purpose}
                  onChange={handleChange("purpose")}
                  className="input-field min-h-[100px]"
                  placeholder="Describe how you plan to use the financing..."
                />
              </div>

              <hr className="my-6" />

              {/* <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg"> */}
              {/* <p className="text-sm text-blue-800">
                  <strong>What happens next?</strong> After submission, our CRO will review your application.
                  Upon approval, a dedicated Credit Line Pool will be deployed on-chain specifically for your company.
                </p> */}
              {/* </div> */}

              {!isTab && (
                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting || !formData.requestedAmount}
                    className="btn-brand flex items-center gap-2 min-w-[200px] justify-center"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      "Submit Application"
                    )}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ApplyFinancingLimit;
