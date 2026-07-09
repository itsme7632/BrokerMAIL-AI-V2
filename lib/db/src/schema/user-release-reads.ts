import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { productReleasesTable } from "./product-releases";

export const userReleaseReadsTable = pgTable("user_release_reads", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  releaseId: integer("release_id").notNull().references(() => productReleasesTable.id, { onDelete: "cascade" }),
  readAt:    timestamp("read_at").notNull().defaultNow(),
}, (t) => ({
  uniqueRead: uniqueIndex("user_release_reads_unique").on(t.userId, t.releaseId),
}));
