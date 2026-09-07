import React, { useState } from "react";
import Typography from "../components/ui/Typography";
import TicketCard from "@/components/ui/TicketCard";
import TicketChatPanal from "@/components/ui/TicketChatPanal";
import NewTicketModal from "@/components/ui/NewTicketModal";

const mockTickets = [
  {
    id: "10023",
    url: "support?ticket=...12345",
    time: "Just Now",
    status: "open",
    messages: [
      { from: "user", text: "Hello!", time: "07:00pm" },
      {
        from: "bot",
        text: "Thank you for reaching out! We've received your request and our support team is reviewing it. One of our agents will get back to you within 24–48 hours.",
        time: "07:01pm",
      },
    ],
  },
  {
    id: "10028",
    url: "support?ticket=...12345",
    time: "Yesterday",
    status: "closed",
    messages: [
      { from: "user", text: "I need help with my deposit.", time: "10:00am" },
      {
        from: "bot",
        text: "Sure! Can you provide more details?",
        time: "10:01am",
      },
    ],
  },
  {
    id: "10028",
    url: "support?ticket=...12345",
    time: "26/01/2026",
    status: "open",
    messages: [
      { from: "user", text: "Transaction not showing. Transaction not showing Transaction not showing Transaction not showing Transaction not showing", time: "03:00pm" },
      {
        from: "bot",
        text: "We'll look into it right away. We'll look into it right away We'll look into it right away We'll look into it right away. We'll look into it right away We'll look into it right away We'll look into it right away. We'll look into it right away We'll look into it right away We'll look into it right away. We'll look into it right away We'll look into it right away",
        time: "03:02pm",
      },
    ],
  },
  {
    id: "10028",
    url: "support?ticket=...12345",
    time: "26/01/2026",
    status: "closed",
    messages: [
      { from: "user", text: "Pool rewards not credited.", time: "09:00am" },
      {
        from: "bot",
        text: "Please allow 24 hours for rewards to reflect.",
        time: "09:05am",
      },
    ],
  },
];

const SupportPage = () => {
  const [tickets, setTickets] = useState(mockTickets);
  const [activeIndex, setActiveIndex] = useState(null);

  const activeTicket = activeIndex !== null ? tickets[activeIndex] : null;

  return (
    <div className="flex flex-col w-full max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 h-full">
      {/* Header + new ticket modal */}
      <NewTicketModal
        tickets={tickets}
        setTickets={setTickets}
        setActiveIndex={setActiveIndex}
      />

      {/* Main layout */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Ticket list — hidden on mobile when a ticket is active */}
        <div
          className={`
            w-full md:w-72 md:flex-shrink-0 flex flex-col
            ${activeIndex !== null ? "hidden md:flex" : "flex"}
          `}
        >
          <Typography
            variant="caption"
            className="text-white mb-3 uppercase tracking-wider text-xl font-bold"
          >
            All Tickets
          </Typography>
          <div className="overflow-y-auto no-scrollbar flex-1">
            {tickets.map((ticket, i) => (
              <TicketCard
                key={i}
                ticket={ticket}
                isActive={i === activeIndex}
                onClick={() => setActiveIndex(i)}
              />
            ))}
          </div>
        </div>

        {/* Chat panel — full width on mobile when active */}
        <div
          className={`
            flex-1 min-h-0
            ${activeIndex !== null ? "flex" : "hidden md:flex"}
          `}
        >
          <TicketChatPanal
            activeTicket={activeTicket}
            activeIndex={activeIndex}
            setActiveIndex={setActiveIndex}
            tickets={tickets}
            setTickets={setTickets}
          />
        </div>
      </div>
    </div>
  );
};

export default SupportPage;
