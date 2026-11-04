import { buildKotDocument, type KotTicketInput } from './kotDocument';
import { enqueuePrint, loadPrintConfig } from './printClient';

/**
 * Opt-in: print a paper KOT for a ticket that has just arrived on this computer's Kitchen board. Off unless the
 * operator enabled it in Settings, Printers. Safe to call for every new ticket: the ticket's duplicate-protection key
 * means a second call (another poll, a restart) is answered with DUPLICATE instead of a second slip.
 */
export const autoPrintKot = async (ticket: KotTicketInput): Promise<void> => {
  try {
    const cfg = await loadPrintConfig();
    if (!cfg || !cfg.autoPrint.kotOnNewTicket || cfg.kot.transport === 'none') return;
    const k = buildKotDocument(ticket);
    await enqueuePrint('kot', k.doc, {
      dedupeKey: k.dedupeKey,
      reference: { ticketId: k.ticketId, stallId: k.stallId, stallName: k.stallName, ticketNumber: k.ticketNumber, orderNumber: k.orderNumber },
    });
  } catch {
    // Printing problems are reported by the print queue and its failure banner; they must never break the Kitchen board
  }
};
