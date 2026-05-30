import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  monthlyEmailLimit: integer("monthly_email_limit").notNull().default(100),
  smtpAccountsLimit: integer("smtp_accounts_limit").notNull().default(1),
  campaignsLimit: integer("campaigns_limit").notNull().default(5),
  batchSendLimit: integer("batch_send_limit").notNull().default(50),
  features: jsonb("features").$type<string[]>().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
  planId: integer("plan_id").notNull().references(() => plansTable.id),
  status: text("status").notNull().default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  billingStatus: text("billing_status").notNull().default("free"),
  currentPeriodStart: timestamp("current_period_start").notNull().defaultNow(),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const planRequestsTable = pgTable("plan_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  fromPlanId: integer("from_plan_id").references(() => plansTable.id),
  toPlanId: integer("to_plan_id").notNull().references(() => plansTable.id),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Plan = typeof plansTable.$inferSelect;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type PlanRequest = typeof planRequestsTable.$inferSelect;
