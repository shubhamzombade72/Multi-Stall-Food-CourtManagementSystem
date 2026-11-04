<?php

namespace Database\Seeders\Demo;

use Database\Seeders\Demo\Data\DemoCatalog;
use Illuminate\Support\Facades\DB;

/**
 * Read-only integrity checks for the Indian demo dataset. Returns a list of named checks, each with the number of offending
 * rows (0 = pass). Used by `foodcourt:seed-indian-demo --verify` and by the PHPUnit suite.
 */
final class DemoIntegrity
{
    /** @return array<string, int> check name => number of violations */
    public static function violations(): array
    {
        $p = DemoCatalog::STALL_PREFIX;
        $demoOrders = fn () => DB::table('orders')->where('idempotency_key', 'like', 'demo-order-%');
        $q = fn (string $sql) => (int) (DB::selectOne($sql)->n ?? 0);
        $dStalls = "(select id from stalls where code like '{$p}%')";
        $dOrders = "(select id from orders where idempotency_key like 'demo-order-%')";

        $v = [];
        // --- catalog
        $v['duplicate stall codes'] = $q("select count(*) n from (select code from stalls group by code having count(*) > 1) t");
        $v['duplicate stall names (demo)'] = $q("select count(*) n from (select name from stalls where code like '{$p}%' group by name having count(*) > 1) t");
        $v['duplicate dish name inside a stall'] = $q("select count(*) n from (select stall_id, name from menu_items where stall_id in {$dStalls} group by stall_id, name having count(*) > 1) t");
        $v['duplicate dish SKU'] = $q("select count(*) n from (select substring(description from 'SKU (DM[0-9]+-D[0-9]+)') sku from menu_items where stall_id in {$dStalls} group by 1 having count(*) > 1) t");
        $v['dish whose category belongs to another stall'] = $q("select count(*) n from menu_items m join menu_categories c on c.id = m.category_id where m.stall_id in {$dStalls} and c.stall_id <> m.stall_id");
        $v['stall without exactly 30 dishes'] = $q("select count(*) n from (select s.id from stalls s left join menu_items m on m.stall_id = s.id where s.code like '{$p}%' group by s.id having count(m.id) <> 30) t");
        // 15..800 INR; only family / feast / platter / pack meals (4-6 people) may go higher, up to 1,200
        $v['dish price outside 15..800 INR (family meals up to 1200)'] = $q("select count(*) n from menu_items where stall_id in {$dStalls} and (price < 15 or price > 1200 or (price > 800 and name !~* 'family|feast|platter|pack'))");
        $v['dish without description or prep time'] = $q("select count(*) n from menu_items where stall_id in {$dStalls} and (description is null or preparation_time_minutes < 1)");
        $v['duplicate table number'] = $q("select count(*) n from (select table_number from dining_tables group by table_number having count(*) > 1) t");
        $v['demo customer with duplicate phone'] = $q("select count(*) n from (select phone from customers group by phone having count(*) > 1) t");
        $v['demo staff with stall role but no stall'] = $q("select count(*) n from users where email like '%@demo.%' and role in ('stall_manager','kitchen_staff','store_staff') and stall_id is null");
        $v['demo staff with non-bcrypt password'] = $q("select count(*) n from users where email like '%@demo.%' and password not like '\$2y\$%'");
        $v['stall without a manager'] = $q("select count(*) n from stalls s where s.code like '{$p}%' and not exists (select 1 from users u where u.stall_id = s.id and u.role = 'stall_manager')");
        $v['supplier attached to a non-demo stall'] = $q("select count(*) n from suppliers where stall_id not in {$dStalls} and email like 'orders.supplier%'");

        // --- orders & money
        $v['order subtotal + tax <> total'] = $q("select count(*) n from orders where id in {$dOrders} and subtotal + tax_amount <> total_amount");
        $v['exclusive order: line items <> subtotal'] = $q("select count(*) n from orders o where o.id in {$dOrders} and o.tax_mode = 'exclusive' and o.subtotal <> (select coalesce(sum(subtotal),0) from order_items i where i.order_id = o.id)");
        $v['order line subtotal <> price x qty'] = $q("select count(*) n from order_items where order_id in {$dOrders} and subtotal <> unit_price * quantity");
        $v['paid order without exactly one matching payment'] = $q("select count(*) n from orders o where o.id in {$dOrders} and o.payment_status = 'paid' and (select count(*) from payments p where p.order_id = o.id) <> 1");
        $v['payment amount <> order total'] = $q("select count(*) n from payments p join orders o on o.id = p.order_id where o.id in {$dOrders} and p.amount <> o.total_amount");
        $v['unpaid or cancelled order with a payment'] = $q("select count(*) n from orders o where o.id in {$dOrders} and o.payment_status <> 'paid' and exists (select 1 from payments p where p.order_id = o.id)");
        $v['cash payment with tendered < amount or wrong change'] = $q("select count(*) n from payments p where p.order_id in {$dOrders} and p.payment_method = 'cash' and (p.cash_tendered < p.amount or p.change_returned <> p.cash_tendered - p.amount)");
        $v['completed order that is unpaid'] = $q("select count(*) n from orders where id in {$dOrders} and status = 'completed' and payment_status <> 'paid'");
        $v['cancelled order that is paid'] = $q("select count(*) n from orders where id in {$dOrders} and status = 'cancelled' and payment_status = 'paid'");
        $v['order item without a ticket item'] = $q("select count(*) n from order_items i where i.order_id in {$dOrders} and not exists (select 1 from stall_ticket_items t where t.order_item_id = i.id)");
        $v['ticket stall differs from its items stall'] = $q("select count(*) n from stall_ticket_items ti join stall_kitchen_tickets t on t.id = ti.ticket_id join order_items i on i.id = ti.order_item_id where t.order_id in {$dOrders} and t.stall_id <> i.stall_id");
        $v['two tickets for one order and stall'] = $q("select count(*) n from (select order_id, stall_id from stall_kitchen_tickets where order_id in {$dOrders} group by order_id, stall_id having count(*) > 1) t");
        $v['order with items in a non-demo stall'] = $q("select count(*) n from order_items where order_id in {$dOrders} and stall_id not in {$dStalls}");
        $v['dine-in order without table / takeaway with table'] = $q("select count(*) n from orders where id in {$dOrders} and ((order_type = 'dine_in' and table_id is null) or (order_type = 'takeaway' and table_id is not null))");
        $v['table with two live (unfinished) orders'] = $q("select count(*) n from (select table_id from orders where id in {$dOrders} and table_id is not null and status not in ('completed','cancelled') group by table_id having count(*) > 1) t");
        $v['occupied table without a live order'] = $q("select count(*) n from dining_tables d where d.status = 'occupied' and d.table_number ~ '^T-[0-9]{3}\$' and not exists (select 1 from orders o where o.table_id = d.id and o.status not in ('completed','cancelled'))");
        $v['order timestamps all identical'] = $q("select case when count(distinct created_at) < 1000 then 1 else 0 end n from orders where id in {$dOrders}");

        // --- stock ledger
        $v['inventory item without a ledger row'] = $q("select count(*) n from inventory_items i where i.stall_id in {$dStalls} and not exists (select 1 from stock_movements m where m.inventory_item_id = i.id)");
        $v['movement: previous + qty <> new (inward/adjust)'] = $q("select count(*) n from stock_movements where stall_id in {$dStalls} and movement_type in ('purchase_inward','manual_adjustment') and round(previous_stock + quantity, 3) <> new_stock");
        $v['movement: previous - qty <> new (outward)'] = $q("select count(*) n from stock_movements where stall_id in {$dStalls} and movement_type in ('consumption','waste_loss') and round(previous_stock - quantity, 3) <> new_stock");
        $v['movement chain broken (previous <> last new)'] = $q("select count(*) n from (select previous_stock, lag(new_stock) over (partition by inventory_item_id order by id) prev_new from stock_movements where stall_id in {$dStalls}) t where prev_new is not null and previous_stock <> prev_new");
        $v['current_stock <> last ledger row'] = $q("select count(*) n from inventory_items i where i.stall_id in {$dStalls} and i.current_stock <> (select new_stock from stock_movements m where m.inventory_item_id = i.id order by m.id desc limit 1)");
        $v['negative stock'] = $q("select count(*) n from inventory_items where stall_id in {$dStalls} and current_stock < 0");
        $v['received PO without inward movements'] = $q("select count(*) n from purchase_orders po where po.stall_id in {$dStalls} and po.status = 'received' and not exists (select 1 from stock_movements m where m.reference_id = po.purchase_number and m.movement_type = 'purchase_inward')");
        $v['non-received PO with inward movements'] = $q("select count(*) n from purchase_orders po where po.stall_id in {$dStalls} and po.status <> 'received' and exists (select 1 from stock_movements m where m.reference_id = po.purchase_number)");
        $v['PO total <> sum of lines'] = $q("select count(*) n from purchase_orders po where po.stall_id in {$dStalls} and po.total_amount <> (select coalesce(sum(total_price),0) from purchase_order_items i where i.purchase_order_id = po.id)");
        $v['PO supplier or items from another stall'] = $q("select count(*) n from purchase_orders po where po.stall_id in {$dStalls} and (exists (select 1 from suppliers s where s.id = po.supplier_id and s.stall_id <> po.stall_id) or exists (select 1 from purchase_order_items i join inventory_items ii on ii.id = i.inventory_item_id where i.purchase_order_id = po.id and ii.stall_id <> po.stall_id))");

        return $v;
    }
}
