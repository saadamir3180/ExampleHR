import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('balances')
@Unique(['employeeId', 'locationId'])
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('decimal', { precision: 5, scale: 2 })
  availableDays: number;

  @UpdateDateColumn()
  lastSyncedAt: Date;

  @Column({ default: 1 })
  version: number;
}
