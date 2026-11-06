// Inline markdown for lesson text: **bold**, *italic* and `code`. A code span is matched first, so asterisks and
// underscores inside it are left alone. Returns plain tokens; markdown.jsx turns them into elements.
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*?\*)/g;

export function tokenizeInline(text) {
  if (!text) return [];
  return String(text).split(INLINE).filter((part) => part !== '').map((part) => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { type: 'code', value: part.slice(1, -1) };
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return { type: 'bold', value: part.slice(2, -2) };
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return { type: 'italic', value: part.slice(1, -1) };
    return { type: 'text', value: part };
  });
}
