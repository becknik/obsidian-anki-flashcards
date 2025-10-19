export type FlashcardProcessingLog = {
  type: 'success' | 'info' | 'warning' | 'error';
  message: string;
};
