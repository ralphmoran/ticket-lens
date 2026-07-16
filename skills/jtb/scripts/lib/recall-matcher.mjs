/**
 * Decides which saved Recall notes are relevant to a given ticket.
 * Pure function — no file access, no network calls. Takes a ticket and a
 * list of notes already loaded into memory, and returns the relevant ones.
 */

const KEYWORD_RE = /[a-z0-9]{4,}/g;
const EXACT_TICKET_SCORE = 10;
const TAG_OVERLAP_SCORE = 3;
const TITLE_WORD_OVERLAP_SCORE = 1;

function extractKeywords(text) {
  return new Set((text ?? '').toLowerCase().match(KEYWORD_RE) ?? []);
}

/**
 * @param {{ key: string, summary?: string, description?: string }} ticket
 * @param {object[]} notes
 * @returns {{ note: object, score: number }[]} sorted strongest match first
 */
export function matchNotes(ticket, notes) {
  const ticketKeywords = extractKeywords(`${ticket.summary ?? ''} ${ticket.description ?? ''}`);

  return notes
    .map(note => {
      let score = 0;

      if (note.tickets?.includes(ticket.key)) score += EXACT_TICKET_SCORE;

      const tagOverlap = (note.tags ?? []).filter(tag => ticketKeywords.has(tag.toLowerCase())).length;
      score += tagOverlap * TAG_OVERLAP_SCORE;

      const titleKeywords = extractKeywords(note.title);
      const titleOverlap = [...titleKeywords].filter(word => ticketKeywords.has(word)).length;
      score += titleOverlap * TITLE_WORD_OVERLAP_SCORE;

      return { note, score };
    })
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score);
}
