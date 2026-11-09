import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { Chat } from './chat.entity.js';

@Entity({ name: 'messages' })
@Index('UQ_messages_chat_sequence', ['chatId', 'sequence'], { unique: true })
@Index(
  'UQ_messages_chat_sender_client',
  ['chatId', 'senderId', 'clientMessageId'],
  {
    unique: true,
  },
)
@Index(
  'IDX_messages_chat_sender_unread_sequence',
  ['chatId', 'senderId', 'sequence'],
  { where: 'read_at IS NULL' },
)
@Check('CHK_messages_sequence', 'sequence > 0')
@Check(
  'CHK_messages_content',
  'char_length(btrim(content)) > 0 AND char_length(content) <= 4000',
)
@Check('CHK_messages_read_at', 'read_at IS NULL OR read_at >= committed_at')
export class Message {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'chat_id', type: 'uuid' })
  chatId: string;

  @ManyToOne(() => Chat, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'chat_id', foreignKeyConstraintName: 'FK_messages_chat' })
  chat: Relation<Chat>;

  @Column({ type: 'bigint' })
  sequence: string;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @Column({ name: 'client_message_id', type: 'uuid' })
  clientMessageId: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'committed_at', type: 'timestamptz' })
  committedAt: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
