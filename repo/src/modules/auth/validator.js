import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1),
});

export const rotatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});
