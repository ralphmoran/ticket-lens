/**
 * Assembles a normalized ticket into a structured markdown TicketBrief.
 */

export function assembleBrief(ticket, codeRefs = null) {
  const sections = [];
  sections.push(`# ${ticket.key}: ${ticket.summary}`);

  const meta = [`**Type:** ${ticket.type}`, `**Status:** ${ticket.status}`, `**Priority:** ${ticket.priority}`, `**Assignee:** ${ticket.assignee ?? 'Unassigned'}`, `**Reporter:** ${ticket.reporter ?? 'Unknown'}`];
  sections.push(meta.join(' | '));

  if (ticket.description) {
    sections.push(`## Description\n\n${ticket.description}`);
  }

  if (ticket.comments?.length > 0) {
    const commentLines = ticket.comments.map(c => {
      const date = c.created ? c.created.split('T')[0] : 'unknown';
      return `### **${c.author}** (${date})\n\n${c.body}`;
    });
    sections.push(`## Comments\n\n${commentLines.join('\n\n---\n\n')}`);
  }

  if (ticket.linkedTicketDetails?.length > 0) {
    const linkedSections = ticket.linkedTicketDetails.map(lt => {
      const parts = [`### ${lt.key}: ${lt.summary}`, `**Type:** ${lt.type} | **Status:** ${lt.status}`];
      if (lt.description) parts.push(lt.description);
      if (lt.comments?.length > 0) {
        const cmts = lt.comments.map(c => {
          const date = c.created ? c.created.split('T')[0] : 'unknown';
          return `**${c.author}** (${date}): ${c.body}`;
        });
        parts.push(cmts.join('\n\n'));
      }
      return parts.join('\n\n');
    });
    sections.push(`## Linked Tickets\n\n${linkedSections.join('\n\n---\n\n')}`);
  }

  if (codeRefs) {
    const categories = [
      ['File Paths', codeRefs.filePaths],
      ['Methods', codeRefs.methods],
      ['Classes', codeRefs.classes],
      ['Git SHAs', codeRefs.shas],
      ['SVN Revisions', codeRefs.svnRevisions],
      ['Branches', codeRefs.branches],
      ['Namespaces', codeRefs.namespaces],
    ];
    const filled = categories
      .filter(([, items]) => items?.length > 0)
      .map(([label, items]) => `**${label}:** ${items.map(i => '`' + i + '`').join(', ')}`);
    if (filled.length > 0) {
      sections.push(`## Code References\n\n${filled.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}
