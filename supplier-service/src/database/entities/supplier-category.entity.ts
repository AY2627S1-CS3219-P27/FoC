import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Category } from './category.entity.js';
import { Supplier } from './supplier.entity.js';

/**
 * Which categories a supplier has (many-to-many). The composite primary key
 * rules out listing the same category twice (F1.2.3). Deleting a supplier
 * removes its links; a category that is still linked cannot be deleted
 * (categories are retired instead, F11.3).
 */
@Entity({ name: 'supplier_categories' })
@Index('IDX_supplier_categories_category_id', ['categoryId'])
export class SupplierCategory {
  @PrimaryColumn({
    name: 'supplier_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_supplier_categories',
  })
  supplierId: string;

  @PrimaryColumn({
    name: 'category_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_supplier_categories',
  })
  categoryId: string;

  @ManyToOne(() => Supplier, (supplier) => supplier.categoryLinks, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({
    name: 'supplier_id',
    foreignKeyConstraintName: 'FK_supplier_categories_supplier',
  })
  supplier?: Supplier;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'FK_supplier_categories_category',
  })
  category?: Category;
}
