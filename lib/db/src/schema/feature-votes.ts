import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { roadmapItemsTable } from "./roadmap-items";
import { usersTable } from "./users";

export const featureVotesTable = pgTable("feature_votes", {
  id:           serial("id").primaryKey(),
  roadmapItemId: integer("roadmap_item_id").notNull().references(() => roadmapItemsTable.id, { onDelete: "cascade" }),
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueVote: uniqueIndex("feature_votes_unique").on(t.roadmapItemId, t.userId),
}));
