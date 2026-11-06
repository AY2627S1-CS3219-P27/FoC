import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export const CHAT_OUTCOMES = [
  'pending',
  'answered',
  'no_match',
  'refused',
  'error',
] as const;

export type ChatOutcome = (typeof CHAT_OUTCOMES)[number];

export interface RetrievedSection {
  id: string;
  score: number;
}

/**
 * One row per accepted question. Written before any paid call, because the
 * rate limit counts these rows, then filled in with what happened. Shows which
 * questions the help documents could not answer. Holds the user's id only,
 * never their email or token, and is deleted after the retention period.
 */
@Entity({ name: 'chat_log' })
@Check(
  'CHK_chat_log_outcome',
  `outcome IN ('pending', 'answered', 'no_match', 'refused', 'error')`,
)
@Index('IDX_chat_log_user_created', ['userId', 'createdAt'])
export class ChatLog {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_chat_log' })
  id: string;

  /** Only ever from the verified token. Not a foreign key: users live elsewhere. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text', default: 'pending' })
  outcome: ChatOutcome;

  /** Every section retrieved, with its score, including those below the cutoff. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  sections: RetrievedSection[];

  /** True when no section was relevant enough, so the model was skipped. */
  @Column({ name: 'cutoff_applied', type: 'boolean', default: false })
  cutoffApplied: boolean;

  @Column({ name: 'embed_ms', type: 'integer', nullable: true })
  embedMs: number | null;

  @Column({ name: 'search_ms', type: 'integer', nullable: true })
  searchMs: number | null;

  @Column({ name: 'generate_ms', type: 'integer', nullable: true })
  generateMs: number | null;

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens: number | null;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
