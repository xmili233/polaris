import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type TextNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: TextNode[] };
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
function streamingWords() {
  return (tree: TextNode) => {
    const visit = (node: TextNode) => {
      if (!node.children || ['pre', 'code'].includes(node.tagName ?? '')) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child]; }
        const words: string[] = [];
        for (const { segment, isWordLike } of segmenter.segment(child.value)) {
          if (!isWordLike && words.length) words[words.length - 1] += segment;
          else words.push(segment);
        }
        return words.map(segment => ({ type: 'element', tagName: 'span',
          properties: { className: ['agent-stream-word'] }, children: [{ type: 'text', value: segment }] }));
      });
    };
    visit(tree);
  };
}

const markdownPlugins = [remarkGfm];
const wordPlugins = [streamingWords];
export function Markdown({ source, inline = false, links = true, className = '', animateText = false }: { source: string; inline?: boolean; links?: boolean; className?: string; animateText?: boolean }) {
  const Wrapper = inline ? 'span' : 'div';
  return <Wrapper className={`${inline ? 'inline-markdown' : 'markdown'} ${className}`}>
    <ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={animateText ? wordPlugins : undefined} components={{
      a: ({ href, children }) => links && href
        ? <a href={href} onClick={event => { event.preventDefault(); void window.polaris.openLink(href); }}>{children}</a>
        : <span>{children}</span>,
      img: ({ alt }) => <span>{alt}</span>,
      ...(inline ? { p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span> } : {}),
      table: ({ children }) => <div className="table-overflow"><table>{children}</table></div>,
    }}>{source}</ReactMarkdown>
  </Wrapper>;
}
