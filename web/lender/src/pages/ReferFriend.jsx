import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import DataTable from "../components/ui/DataTable";
import InputField from "../components/ui/InputField";
import Button from "../components/ui/Button";
import giftImg from "../assets/multiChain-ui/gift-img.svg";
import leftCoin from "../assets/multiChain-ui/left-defa-coin.svg";
import rightCoin from "../assets/multiChain-ui/right-defa-coin.svg";
import { copyToClipboard } from "@/libs/utils/utils";

const columns = [
  { key: "createdAt", label: "Created At", info: false },
  {
    key: "code",
    label: "Code",
    info: true,
    render: (row) => <CodeCell code={row.code} />,
  },
  { key: "used", label: "Used", info: true },
];

const CodeCell = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(code, "Referral code copied!", "Failed to copy code", () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      {code}
      <Button
        variant="icon"
        onClick={handleCopy}
        className="!p-1 text-white/50 hover:text-white transition-colors cursor-pointer"
        title="Copy code"
      >
        {copied ? (
          <Check size={14} className="text-green-400" />
        ) : (
          <Copy size={14} />
        )}
      </Button>
    </span>
  );
};

const ReferFriend = () => {
  const [referralCode, setReferralCode] = useState("");
  const [tableData, setTableData] = useState([
    { createdAt: "29/01/2026", code: "512022", used: "Yes" },
    { createdAt: "29/01/2026", code: "512022", used: "Yes" },
    { createdAt: "29/01/2026", code: "512022", used: "Yes" },
    { createdAt: "29/01/2026", code: "512022", used: "Yes" },
  ]);

  const handleGenerate = () => {
    try {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const today = new Date();
      const date = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
      setReferralCode(code);
      setTableData((prev) => [{ createdAt: date, code, used: "No" }, ...prev]);
    } catch (error) {
      console.log("🚀 ~ handleGenerate ~ error:", error);
    }
  };

  const headerSection = (
    <div
      className="relative w-full rounded-2xl mb-8 overflow-hidden flex flex-col lg:flex-row bg-blue-700/30"
      style={{
        // background:
        //   "linear-gradient(135deg, #3a5bd9 0%, #5b7ff5 50%, #8aaaf7 100%)",
        minHeight: "260px",
      }}
    >
      {/* Left text content */}
      <div className="relative z-10 p-8 md:p-12 flex flex-col justify-center w-full lg:w-1/2">
        <h1 className="text-3xl md:text-4xl font-semibold text-white mb-2">
          Refer a Friend
        </h1>
        <p className="text-white/70  text-sm mb-8">
          Share your referral code with your friend and unlock perks together
        </p>

        {/* Referral code input */}
        <div className="mb-4 max-w-sm">
          <InputField
            readOnly
            value={referralCode}
            placeholder="Your referral code will appear here"
            className="bg-white/30! placeholder:text-white!"
          />
        </div>

        {/* Generate button */}
        <Button
          variant="solid"
          color="default"
          onClick={handleGenerate}
          className="px-6! py-2.5! text-sm max-w-fit"
        >
          Generate Referral Code
        </Button>
      </div>

      {/* Right decorative section */}
      <div className="hidden lg:flex lg:w-1/2 relative items-end justify-center">
        {/* Gift image — full height, anchored to bottom center */}
        <img
          src={giftImg}
          alt="Gift"
          className="relative z-10 h-full w-auto max-h-[260px] xl:max-h-[300px] object-contain object-bottom"
        />
        {/* Left coin — floats mid-left */}
        <img
          src={leftCoin}
          alt=""
          className="absolute left-[6%] top-[30%] w-[72px] xl:w-[88px] h-auto z-20"
        />
        {/* Right coin — floats upper-right */}
        <img
          src={rightCoin}
          alt=""
          className="absolute right-[4%] top-[8%] w-[82px] xl:w-[98px] h-auto z-20"
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col justify-center items-center p-12 w-full max-w-5xl mx-auto overflow-x-hidden overflow-y-auto no-scrollbar">
      {/* Hero Banner */}
      {headerSection}

      {/* Referrals Table */}
      <DataTable columns={columns} data={tableData} />
    </div>
  );
};

export default ReferFriend;
