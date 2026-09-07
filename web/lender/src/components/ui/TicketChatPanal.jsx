import React, { useEffect, useRef, useState } from "react";
import Typography from "./Typography";
import { ArrowLeft, Bot, Copy, Send, SendHorizontal, X } from "lucide-react";
import Chip from "./Chip";
import Button from "./Button";
import InputField from "./InputField";
import chatBotAvatar from "@/assets/multiChain-ui/chat-avatar.svg";
import { copyToClipboard } from "@/libs/utils/utils";

const TicketChatPanal = ({
  activeTicket,
  activeIndex,
  setActiveIndex,
  tickets,
  setTickets,
}) => {
  const [inputValue, setInputValue] = useState("");

  const messagesEndRef = useRef(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeIndex, tickets]);
  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSend();
  };

  const handleClose = () => {
    setActiveIndex(null);
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    const now = new Date();
    const time = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const updated = tickets.map((t, i) =>
      i === activeIndex
        ? {
            ...t,
            messages: [
              ...t.messages,
              { from: "user", text: inputValue.trim(), time },
            ],
          }
        : t,
    );
    setTickets(updated);
    setInputValue("");
  };

  if (!activeTicket)
    return (
      <div className="flex-1 flex items-center justify-center rounded-2xl bg-primary-card/40 border border-white/10 backdrop-blur-md min-h-[300px] md:min-h-[500px] w-full">
        <Typography variant="body2" className="text-white">
          Select a ticket to view the conversation
        </Typography>
      </div>
    );
  return (
    <>
      <div className="flex-1 flex flex-col rounded-2xl bg-primary-card/40 border border-white/10 backdrop-blur-md overflow-hidden min-h-[300px] md:min-h-[500px] w-full">
        {/* Chat header */}
        <div className="flex items-center justify-between px-5 py-4 relative after:absolute after:bottom-0 after:left-5 after:right-5 after:h-px after:bg-white/50">
          {/* Left: back button (mobile) + Ticket title + URL */}
          <div className="flex flex-row gap-3 md:gap-6 items-center">
            {/* Back button — mobile only */}
            <button
              className="md:hidden text-white/70 hover:text-white transition-colors flex-shrink-0"
              onClick={handleClose}
            >
              <ArrowLeft size={18} />
            </button>

            <div className="flex flex-col gap-0.5">
              <Typography variant="h6" className="text-white font-semibold">
                Ticket #{activeTicket.id}
              </Typography>
              <div className="flex items-center gap-1">
                <Typography variant="caption" className="text-xs text-white/60">
                  {activeTicket.url}
                </Typography>
                <Copy
                  size={10}
                  className="text-white/60 hover:text-white cursor-pointer transition-colors"
                  onClick={() => copyToClipboard(activeTicket.url, "Ticket URL copied!")}
                />
              </div>
            </div>

            {/* Status chip */}
            {/* <div className="">
              {activeTicket.status === "open" && (
                <Chip
                  variant="low"
                  color="low"
                  dot={false}
                  className=" capitalize"
                >
                  {activeTicket.status}
                </Chip>
              )}
            </div> */}
          </div>

          {/* Right: Dates + divider + close button */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-3 text-white text-xs">
              <span>Created 07 April 2025</span>
              <span className="w-px h-4 bg-white/20" />
              <span className="text-white font-semibold">
                Updated: Just Now
              </span>
            </div>
            {/* Close button — desktop only (mobile uses back arrow) */}
            <Button
              variant="icon"
              color="default"
              className="!p-1.5 rounded-full border border-white/20 hidden md:inline-flex"
              onClick={handleClose}
            >
              <X size={14} />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar">
          {activeTicket.messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <Typography variant="body2" className="text-white/30">
                No messages yet. Start the conversation.
              </Typography>
            </div>
          )}
          {activeTicket.messages.map((msg, i) => (
            <ChatBubble key={i} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-4 border-t border-white/10 flex items-center gap-3">
          <InputField
            placeholder="Type a message"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="!rounded-full placeholder:text-white/90! bg-transparent!"
          />
          <Button
            variant="solid"
            color="primary"
            onClick={handleSend}
            className="p-3! flex-shrink-0 rounded-full!"
          >
            <SendHorizontal fill="white" size={16} />
          </Button>
        </div>
      </div>
    </>
  );
};

export default TicketChatPanal;

const ChatBubble = ({ message }) => {
  const isUser = message.from === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4 `}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center mr-2 flex-shrink-0 self-end">
          <img src={chatBotAvatar} alt="Chat-Bot" />
        </div>
      )}
      <div
        className={`max-w-[70%] ${isUser ? "items-end" : "items-start"} flex flex-col `}
      >
        {isUser ? (
          <div className="bg-blue-500/30 border border-blue-400/80 rounded-2xl rounded-br-none px-3 py-2 text-sm text-white/90 break-words w-full">
            {message.text}
          </div>
        ) : (
          <div className="bg-white/10 border border-white/30 rounded-2xl rounded-bl-none px-3 py-2 text-sm text-white/90 break-words w-full">
            {message.text}
          </div>
        )}

        <Typography
          variant="caption"
          className="text-white/80 text-xs mt-1 px-1"
        >
          {message.time}
        </Typography>
      </div>
    </div>
  );
};
