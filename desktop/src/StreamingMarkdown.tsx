import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { markdownBlocks, StreamingTextBuffer } from './streaming-text';

const MarkdownBlock = memo(Markdown);

export function StreamingMarkdown({ source, streaming, smooth = true }: { source: string; streaming: boolean; smooth?: boolean }) {
  const buffer = useRef<StreamingTextBuffer>(undefined);
  buffer.current ??= new StreamingTextBuffer(source);
  const [displayed, setDisplayed] = useState(source);
  const [canAnimate, setCanAnimate] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setCanAnimate(!media.matches && !document.documentElement.classList.contains('reduce-motion') && document.visibilityState !== 'hidden');
    update(); media.addEventListener('change', update); document.addEventListener('visibilitychange', update);
    return () => { media.removeEventListener('change', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  const adaptive = streaming && smooth && canAnimate;
  useLayoutEffect(() => {
    const state = buffer.current!;
    state.update(source, adaptive, performance.now());
    setDisplayed(state.text);
  }, [source, adaptive]);
  useLayoutEffect(() => {
    if (!adaptive) return;
    let frame = 0;
    const tick = () => {
      const state = buffer.current!, previous = state.length;
      state.advance(performance.now());
      if (state.length !== previous && !frame) frame = requestAnimationFrame(() => { frame = 0; setDisplayed(buffer.current!.text); });
    };
    const timer = setInterval(tick, 50);
    return () => { clearInterval(timer); cancelAnimationFrame(frame); };
  }, [adaptive]);
  const text = adaptive ? displayed : source;
  const blocks = markdownBlocks(text);
  return <div className={`agent-streaming-markdown${streaming && canAnimate ? ' is-streaming' : ''}${adaptive ? ' is-adaptive' : ''}`}>
    {blocks.map((block, index) => <MarkdownBlock key={index} source={block} animateText={streaming && canAnimate && index === blocks.length - 1} />)}
  </div>;
}
