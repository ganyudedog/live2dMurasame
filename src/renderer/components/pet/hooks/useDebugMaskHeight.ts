import { useEffect, useState } from 'react';

export const useDebugMaskHeight = (): number => {
  const [debugMaskHeight, setDebugMaskHeight] = useState<number>(() => (
    typeof window !== 'undefined' ? window.innerHeight : 0
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncDebugMaskHeight = () => {
      setDebugMaskHeight(window.innerHeight);
    };
    syncDebugMaskHeight();
    window.addEventListener('resize', syncDebugMaskHeight);
    return () => {
      window.removeEventListener('resize', syncDebugMaskHeight);
    };
  }, []);

  return debugMaskHeight;
};
