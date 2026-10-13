-- Invoice lines must keep the order in which they were entered.
alter table invoice_items add column position smallint not null default 0;
create index invoice_items_invoice_position_idx on invoice_items (invoice_id, position);
