/**
 * Converts Atlassian Document Format (ADF) to plain text.
 * Used for Jira Cloud v3 API responses where description and
 * comment bodies are ADF objects instead of plain text strings.
 */

/**
 * Converts plain text to a minimal ADF document — one paragraph node per
 * blank-line-separated block, one text node per paragraph. Jira Cloud (API
 * v3) rejects a plain string comment body outright; Server/DC (v2) accepts
 * one directly. No rich-text/markdown conversion — deliberately minimal,
 * matching the narrow-schema scope of ticket_comment (no formatting inputs
 * accepted, so none need representing here).
 */
export function textToAdf(text) {
  const paragraphs = (text || '').split('\n\n').filter(Boolean);
  return {
    version: 1,
    type: 'doc',
    content: paragraphs.length > 0
      ? paragraphs.map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))
      : [{ type: 'paragraph', content: [] }],
  };
}

/**
 * Builds an ADF mediaSingle+media node embedding an already-uploaded Jira
 * attachment as a real inline image. `collection` does NOT need to be
 * Jira's actual internal Media Services collection — real-instance
 * verification against a live Jira Cloud site confirmed the image renders
 * correctly regardless of the collection value given (including the
 * ticket key, used here as a stable value requiring no extra lookup);
 * the content-scoped access token embedded when resolving `id` is what
 * actually grants read access, not this field.
 */
export function buildMediaNode(mediaId, collection) {
  return {
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [{ type: 'media', attrs: { type: 'file', id: mediaId, collection } }],
  };
}

/**
 * Appends block-level nodes (e.g. a media node) after an ADF doc's existing
 * content, without mutating the original doc.
 */
export function appendNodesToAdf(adfDoc, extraNodes) {
  return { ...adfDoc, content: [...adfDoc.content, ...extraNodes] };
}

export function adfToText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value.type !== 'doc') return '';

  return extractBlocks(value.content || []);
}

function extractBlocks(nodes) {
  return nodes.map(extractBlock).filter(Boolean).join('\n\n');
}

function extractBlock(node) {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'codeBlock':
      return extractInlines(node.content || []);
    case 'bulletList':
    case 'orderedList':
      return (node.content || []).map(li => extractBlock(li)).filter(Boolean).join('\n');
    case 'listItem':
      return extractBlocks(node.content || []);
    case 'blockquote':
    case 'panel':
    case 'expand':
    case 'nestedExpand':
    case 'layoutSection':
    case 'layoutColumn':
    case 'tableCell':
    case 'tableHeader':
    case 'tableRow':
    case 'table':
      return extractBlocks(node.content || []);
    default:
      if (node.content) return extractBlocks(node.content);
      return '';
  }
}

function extractInlines(nodes) {
  return nodes.map(extractInline).join('');
}

function extractInline(node) {
  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'mention':
      return node.attrs?.text || '';
    case 'inlineCard':
      return node.attrs?.url || '';
    case 'emoji':
      return node.attrs?.shortName || '';
    case 'hardBreak':
      return '\n';
    default:
      if (node.content) return extractInlines(node.content);
      return '';
  }
}
