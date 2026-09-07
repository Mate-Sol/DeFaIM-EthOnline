import { Copy } from "lucide-react";
import Chip from "./Chip";
import Typography from "./Typography";
import { copyToClipboard } from "@/libs/utils/utils";

const TicketCard = ({ ticket, isActive, onClick }) => {
  return (
    <>
      <div
        onClick={onClick}
        className={`cursor-pointer rounded-2xl p-4 border transition-all duration-200 mb-3
      ${
        isActive
          ? "bg-primary border-white/30"
          : "bg-primary border-white/10 hover:bg-white/10"
      }`}
      >
        <div className="flex items-center justify-between mb-1">
          <Typography
            variant="h6"
            className="text-white font-semibold text-base"
          >
            Ticket #{ticket.id}
          </Typography>
        </div>
        <div className="flex items-center gap-1 mb-1">
          <Typography variant="caption" className="text-white! text-xs">
            {ticket.url}
          </Typography>
          <Copy
            size={10}
            className="text-white/40 hover:text-white cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(ticket.url, "Ticket URL copied!");
            }}
          />
        </div>
        <div className="flex flex-row justify-between items-center">
          <Typography variant="caption" className="text-white/80 text-xs">
            {ticket.time}
          </Typography>
          {ticket.status === "open" && (
            <Chip
              variant="low"
              color="low"
              dot={false}
              className="!px-3 !py-1 text-xs "
            >
              Open
            </Chip>
          )}
        </div>
      </div>
    </>
  );
};

export default TicketCard;
