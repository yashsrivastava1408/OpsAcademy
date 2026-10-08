/**
 * A small Markdown renderer for course content: headings, paragraphs,
 * bullet lists, tables, fenced code blocks and **bold**. Lessons and case
 * studies are written in this subset, so no Markdown library is shipped.
 */
import { Link } from 'react-router-dom';
import { Terminal, Copy, Check } from 'lucide-react';

/**
 * Helper to parse inline bold markdown: **bold text**
 */
export function parseInline(text) {
  if (!text) return '';
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Advanced Markdown String Parser (Headings, Code Blocks, Tables, Lists)
 */
export function renderMarkdownString(markdownText, handleCopyCode, copiedIdx, unitId) {
  if (!markdownText) return null;

  const blocks = [];
  const lines = markdownText.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().replace('```', '');
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code',
        language: lang || 'bash',
        value: codeLines.join('\n'),
      });
      continue;
    }

    // 2. Markdown Table
    if (line.trim().startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      // Filter out separator line | :--- | :--- |
      const rows = tableLines
        .filter((l) => !l.match(/^\|[\s:-]+\|/))
        .map((l) =>
          l
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim())
        );

      if (rows.length > 0) {
        const header = rows[0];
        const body = rows.slice(1);
        blocks.push({
          type: 'table',
          header,
          body,
        });
      }
      continue;
    }

    // 3. Headings
    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', value: line.replace('### ', '').trim() });
      i++;
      continue;
    }
    if (line.startsWith('#### ')) {
      blocks.push({ type: 'h4', value: line.replace('#### ', '').trim() });
      i++;
      continue;
    }

    // 4. Bullet point lists
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const listItems = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))
      ) {
        listItems.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items: listItems });
      continue;
    }

    // 5. Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // 6. Regular Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].startsWith('###') &&
      !lines[i].trim().startsWith('- ') &&
      !lines[i].trim().startsWith('* ')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', value: paraLines.join(' ') });
  }

  return blocks.map((block, idx) => {
    const key = `md-block-${idx}`;
    switch (block.type) {
      case 'h3':
        return (
          <h3 key={key} className="learn-subheading-3">
            {parseInline(block.value)}
          </h3>
        );
      case 'h4':
        return (
          <h4 key={key} className="learn-subheading-4">
            {parseInline(block.value)}
          </h4>
        );
      case 'paragraph':
        return (
          <p key={key} className="learn-paragraph">
            {parseInline(block.value)}
          </p>
        );
      case 'list':
        return (
          <ul key={key} className="learn-bullet-list">
            {block.items.map((item, itemIdx) => (
              <li key={itemIdx}>{parseInline(item)}</li>
            ))}
          </ul>
        );
      case 'code':
        return (
          <div key={key} className="learn-code-block glass-card">
            <div className="code-header">
              <span>{block.language ? `${block.language.toUpperCase()} Script / Config` : 'Shell / Configuration'}</span>
              <div className="code-header-actions">
                <button
                  className="btn btn-ghost btn-sm code-copy-btn"
                  onClick={() => handleCopyCode(block.value, idx)}
                >
                  {copiedIdx === idx ? (
                    <>
                      <Check size={14} className="copied-icon" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copy
                    </>
                  )}
                </button>
                <Link to={`/unit/${unitId}/practice`} className="btn btn-secondary btn-sm code-run-btn">
                  <Terminal size={12} /> Run in Shell
                </Link>
              </div>
            </div>
            <pre>
              <code>{block.value}</code>
            </pre>
          </div>
        );
      case 'table':
        return (
          <div key={key} className="learn-table-wrapper glass-card">
            <table className="learn-table">
              <thead>
                <tr>
                  {block.header.map((col, cIdx) => (
                    <th key={cIdx}>{parseInline(col)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.body.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx}>{parseInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

