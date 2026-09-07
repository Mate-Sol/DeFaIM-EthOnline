import React, { useState } from "react";
import Typography from "./Typography";
import { CirclePlus, Plus, Send, SendHorizontal, X } from "lucide-react";
import InputField from "./InputField";
import Button from "./Button";

const NewTicketModal = ({ tickets, setTickets, setActiveIndex }) => {
  const [showModal, setShowModal] = useState(false);
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (!text.trim()) return;
    const message = text.trim();
    const now = new Date();
    const time = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const newTicket = {
      id: String(10030 + tickets.length),
      url: "support?ticket=...12345",
      time: "Just Now",
      status: "open",
      messages: [{ from: "user", text: message, time }],
    };
    setTickets((prev) => [newTicket, ...prev]);
    setActiveIndex(0);
    setShowModal(false);
    setText("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  const newModle = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md p-6">
        <div className="flex items-center justify-between mb-4">
          <Typography variant="h6" className="text-white font-semibold">
            Create New Ticket
          </Typography>
          <button
            onClick={() => setShowModal(false)}
            className="text-white/50 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <Typography variant="caption" className="text-white text-sm mb-3 block">
          Describe your issue and we'll get back to you shortly.
        </Typography>
        <InputField
          placeholder="Type your issue here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="mb-4 placeholder:text-white!"
        />
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            color="default"
            onClick={() => setShowModal(false)}
            className="!px-4 !py-2 text-sm"
          >
            Cancel
          </Button>
          <Button
            variant="gradient"
            color="primary"
            onClick={handleSubmit}
            className="!px-5 !py-2 text-sm gap-2"
          >
            Submit  <SendHorizontal fill="white" size={12} />
          </Button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <div className="flex items-center justify-between mb-6 gap-3">
        <Typography variant="h2" className="text-white font-semibold text-xl md:text-3xl">
          Customer Support
        </Typography>
        <Button
          variant="gradient"
          color="primary"
          onClick={() => setShowModal(true)}
          className="!px-4 md:!px-5 !py-2 md:!py-2.5 text-sm gap-2 flex-shrink-0"
        >
          <span className="hidden sm:inline">Create New Ticket</span>
          <span className="sm:hidden">New Ticket</span>
          <Plus size={16} />
        </Button>
      </div>
      {showModal ? newModle : null}
    </>
  );
};

export default NewTicketModal;
