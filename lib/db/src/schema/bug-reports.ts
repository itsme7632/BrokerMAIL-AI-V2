import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const bugReportsTable = pgTable("bug_reports", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  title:            text("title").notNull(),
  description:      text("description").notNull(),
  stepsToReproduce: text("steps_to_reproduce").notNull(),
  expectedResult:   text("expected_result").notNull(),
  actualResult:     text("actual_result").notNull(),
  /** critical | high | medium | low */
  severity:         text("severity").notNull().default("medium"),
  /** open | fixed | duplicate | closed */
  status:           text("status").notNull().default("open"),
  // Auto-captured context
  currentUrl:       text("current_url"),
  browser:          text("browser"),
  os:               text("os"),
  screenResolution: text("screen_resolution"),
  platformVersion:  text("platform_version"),
  // Attachments
  screenshotUrl:    text("screenshot_url"),
  videoUrl:         text("video_url"),
  // Admin
  assignedTo:       text("assigned_to"),
  adminReply:       text("admin_reply"),
  adminReplyAt:     timestamp("admin_reply_at"),
  /** AI future use: group duplicate bug reports */
  embeddingText:    text("embedding_text"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});
