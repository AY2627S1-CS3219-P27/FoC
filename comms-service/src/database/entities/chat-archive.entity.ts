import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { Chat } from './chat.entity.js';

export interface ChatArchiveSnapshot {
  schemaVersion: 1;
  chatId: string;
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  archivedAt: string;
  messages: Array<{
    role: 'REQUESTER' | 'COURIER';
    content: string;
    timestamp: string;
  }>;
}

@Entity({ name: 'chat_archives' })
@Index('UQ_chat_archives_chat', ['chatId'], { unique: true })
@Index('IDX_chat_archives_requester_archived_id', [
  'requesterUserId',
  'archivedAt',
  'id',
])
@Index('IDX_chat_archives_courier_archived_id', [
  'courierUserId',
  'archivedAt',
  'id',
])
@Check('CHK_chat_archives_participants', 'requester_user_id <> courier_user_id')
@Check('CHK_chat_archives_schema_version', 'schema_version = 1')
@Check(
  'CHK_chat_archives_snapshot',
  `jsonb_typeof(snapshot) = 'object'
   AND (snapshot ->> 'schemaVersion') = schema_version::text`,
)
export class ChatArchive {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'chat_id', type: 'uuid' })
  chatId: string;

  @OneToOne(() => Chat, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'chat_id',
    foreignKeyConstraintName: 'FK_chat_archives_chat',
  })
  chat: Relation<Chat>;

  @Column({ name: 'errand_id', type: 'uuid' })
  errandId: string;

  @Column({ name: 'requester_user_id', type: 'uuid' })
  requesterUserId: string;

  @Column({ name: 'courier_user_id', type: 'uuid' })
  courierUserId: string;

  @CreateDateColumn({ name: 'archived_at', type: 'timestamptz' })
  archivedAt: Date;

  @Column({ name: 'schema_version', type: 'smallint', default: 1 })
  schemaVersion: 1;

  @Column({ type: 'jsonb' })
  snapshot: ChatArchiveSnapshot;
}
