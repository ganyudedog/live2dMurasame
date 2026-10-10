import toast from 'react-hot-toast';

export const notifyTtsError = (message: string): void => { toast.error(message); };
