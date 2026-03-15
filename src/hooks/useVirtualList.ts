import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface UseVirtualListOptions {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
}

export default function useVirtualList({ itemCount, itemHeight, overscan = 5 }: UseVirtualListOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);

    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(itemCount - 1, start + visibleCount + overscan * 2);
    return { startIndex: start, endIndex: end };
  }, [scrollTop, containerHeight, itemHeight, itemCount, overscan]);

  const totalHeight = itemCount * itemHeight;
  const offsetY = startIndex * itemHeight;

  const virtualItems = useMemo(() => {
    const items: number[] = [];
    for (let i = startIndex; i <= endIndex; i++) items.push(i);
    return items;
  }, [startIndex, endIndex]);

  const scrollToIndex = useCallback((index: number) => {
    containerRef.current?.scrollTo({ top: index * itemHeight, behavior: 'smooth' });
  }, [itemHeight]);

  return { containerRef, virtualItems, totalHeight, offsetY, scrollToIndex };
}
