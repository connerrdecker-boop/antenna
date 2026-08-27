CREATE TABLE `candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`handle` text NOT NULL,
	`ig_url` text,
	`name` text,
	`follower_count` integer,
	`bio` text,
	`link_url` text,
	`link_domain` text,
	`link_contents` text,
	`link_fetch_status` text,
	`metro` text,
	`metro_confidence` real,
	`source` text NOT NULL,
	`source_detail` text,
	`first_seen` text NOT NULL,
	`last_enriched` text,
	`pre_score` integer,
	`score` integer,
	`tier` text,
	`score_prompt_version` text,
	`evidence` text,
	`hook_draft` text,
	`stack_signals` text,
	`extracted` text,
	`status` text DEFAULT 'sourced' NOT NULL,
	`followup_count` integer DEFAULT 0 NOT NULL,
	`loi_tier` text,
	`notes` text,
	`next_action_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_handle_unique` ON `candidates` (`handle`);--> statement-breakpoint
CREATE INDEX `candidates_status_idx` ON `candidates` (`status`);--> statement-breakpoint
CREATE INDEX `candidates_tier_idx` ON `candidates` (`tier`);--> statement-breakpoint
CREATE INDEX `candidates_metro_idx` ON `candidates` (`metro`);--> statement-breakpoint
CREATE INDEX `candidates_source_idx` ON `candidates` (`source`);--> statement-breakpoint
CREATE INDEX `candidates_link_url_idx` ON `candidates` (`link_url`);--> statement-breakpoint
CREATE TABLE `harvest_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adapter` text NOT NULL,
	`params` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`items_found` integer,
	`items_new` integer,
	`est_cost` real,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `harvest_runs_adapter_idx` ON `harvest_runs` (`adapter`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`handle` text NOT NULL,
	`observed_at` text NOT NULL,
	`follower_count` integer,
	`posts_30d` integer,
	`format_mix` text,
	`engagement_proxy` real,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `observations_handle_idx` ON `observations` (`handle`);--> statement-breakpoint
CREATE INDEX `observations_observed_at_idx` ON `observations` (`observed_at`);--> statement-breakpoint
CREATE TABLE `outreach_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`direction` text NOT NULL,
	`text` text,
	`at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outreach_log_candidate_idx` ON `outreach_log` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `outreach_log_at_idx` ON `outreach_log` (`at`);--> statement-breakpoint
CREATE TABLE `ratifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ratifications_candidate_idx` ON `ratifications` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `ratifications_at_idx` ON `ratifications` (`at`);--> statement-breakpoint
CREATE TABLE `spend` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`category` text NOT NULL,
	`amount` real NOT NULL,
	`run_ref` text,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `spend_category_idx` ON `spend` (`category`);--> statement-breakpoint
CREATE TABLE `status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `status_history_candidate_idx` ON `status_history` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `status_history_to_status_idx` ON `status_history` (`to_status`);