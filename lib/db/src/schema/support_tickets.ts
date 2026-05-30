import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export interface TicketReply {
  id: string;
  author: "admin" | "user";
  authorName: string;
  message: string;
  createdAt: string;
}

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userEmail: text("user_email").notNull(),
  userName: text("user_name"),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  adminNote: text("admin_note"),
  replies: jsonb("replies").$type<TicketReply[]>().default([]),
  assignedTo: text("assigned_to"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
