import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z
  .string()
  .min(10, "密码至少需要 10 个字符。")
  .max(128)
  .regex(/[a-zA-Z]/, "密码需要包含字母。")
  .regex(/[0-9]/, "密码需要包含数字。");

export const registerSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(2).max(60),
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();

export const updateProfileSchema = z.object({ name: z.string().trim().min(2).max(60) }).strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "新密码不能与当前密码相同。",
  });

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) }).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
