export const toErrorMessage = (error: unknown): string => String(error instanceof Error ? error.message : error);

export const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return String(error).includes('AbortError');
};
