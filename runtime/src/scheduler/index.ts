export type ScheduledJob = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
};

// Placeholder. Piclaw's scheduler concept will be adapted after Telegram and
// persistence are proven end-to-end.
