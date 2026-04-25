import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum SyncSource {
  BATCH = 'batch',
  REALTIME = 'realtime',
}

@Entity('sync_log')
export class SyncLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  source: SyncSource;

  @Column({ type: 'text', nullable: true })
  employeeId: string;

  @Column({ default: 0 })
  rowsAffected: number;

  @CreateDateColumn()
  processedAt: Date;
}
